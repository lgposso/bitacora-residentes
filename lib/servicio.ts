/**
 * Lógica de la aplicación: residentes, sesiones, bitácora, asistencia y subidas.
 * La base de datos es la fuente de verdad. El sincronizador (sync/sincronizar.py) lleva a Google Drive
 * los archivos y las hojas de Excel que estén pendientes (ver pendientesSync / confirmarSync).
 */
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ASISTENCIA_ENCABEZADOS, BITACORA_ENCABEZADOS, MAX_FILE_BYTES, PROGRAMAS, ZONA_HORARIA, type EstadoSesion
} from './config';
import type { Almacen } from './almacen';
import type { Db } from './db';
import { CARPETA_FOTOS, CARPETA_MATERIAL, conSufijo, rutaPrograma, rutaResidente, rutaSesion } from './rutas';
import {
  ErrorUsuario, formatDuracion, nombreSeguro, normalizarCorreo, normalizarDocumento, validarAsistencia, validarBitacora,
  validarPlan
} from './validaciones';

export interface Ctx {
  db: Db;
  almacen: Almacen;
  /** URL pública de la app (para el QR). */
  appUrl: string;
}

interface Residente {
  id: number;
  usuario: string;
  nombre: string;
  programa: string;
  carpeta: string;
  clave_hash: string;
  plan_subido: boolean;
}

interface Sesion {
  id: number;
  residente_id: number;
  numero: number;
  token: string;
  estado: EstadoSesion;
  fecha: string | null;
  hora_inicio: string | null;
  hora_final: string | null;
  duracion_min: number | null;
  escenario: string | null;
  poblacion: string | null;
  participantes: number | null;
  tema: string | null;
  estrategias: string[] | null;
  evaluaciones: string[] | null;
  modalidad: string;
  /** En la copia de una sesión grupal, la sesión original (de quien la registró). */
  origen_id: number | null;
  bitacora_en: Date | null;
}

export interface EstadoResidente {
  nombre: string;
  programa: string;
  planSubido: boolean;
  sesion: null | {
    numero: number;
    estado: EstadoSesion;
    urlAsistencia: string;
    asistentes: number;
    fotos: number;
    material: number;
  };
}

export type TipoSubida = 'plan' | 'foto' | 'material';

const esDuplicado = (e: unknown) => (e as { code?: string })?.code === '23505';

// ---------- Ajustes ----------

export async function leerAjuste(db: Db, clave: string) {
  const [f] = await db.query<{ valor: string }>('SELECT valor FROM ajustes WHERE clave = $1', [clave]);
  return f?.valor ?? null;
}

export async function guardarAjuste(db: Db, clave: string, valor: string) {
  await db.query(
    'INSERT INTO ajustes (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor',
    [clave, valor]
  );
}

// ---------- Intentos de login ----------

async function registrarIntento(db: Db, clave: string) {
  const [f] = await db.query<{ n: number }>(
    `INSERT INTO intentos (clave, n, desde) VALUES ($1, 1, now())
     ON CONFLICT (clave) DO UPDATE SET
       n = CASE WHEN intentos.desde < now() - interval '15 minutes' THEN 1 ELSE intentos.n + 1 END,
       desde = CASE WHEN intentos.desde < now() - interval '15 minutes' THEN now() ELSE intentos.desde END
     RETURNING n`,
    [clave]
  );
  if (f.n > 10) throw new ErrorUsuario('Demasiados intentos fallidos. Espere 15 minutos.', 429);
}

async function limpiarIntentos(db: Db, clave: string) {
  await db.query('DELETE FROM intentos WHERE clave = $1', [clave]);
}

/** Compara secretos en tiempo constante. */
export function secretoIgual(dado: unknown, real: string) {
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(String(dado ?? '')), h(real));
}

// ---------- Administradora ----------

export async function verificarClaveAdmin(db: Db, clave: string) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) throw new ErrorUsuario('Falta configurar ADMIN_PASSWORD.', 500);
  await registrarIntento(db, 'admin');
  if (!secretoIgual(clave, real)) throw new ErrorUsuario('Contraseña incorrecta.', 401);
  await limpiarIntentos(db, 'admin');
}

/** La contraseña de cada residente es su número de documento (la de la administradora no cambia). */
const validarClaveNueva = normalizarDocumento;

export async function crearResidente(ctx: Ctx, datos: { nombre?: string; programa?: string; usuario?: string; clave?: string }) {
  const nombre = nombreSeguro(datos.nombre);
  if (nombre.length < 3) throw new ErrorUsuario('Escriba el nombre completo del residente.');
  const programa = String(datos.programa ?? '');
  if (!(PROGRAMAS as readonly string[]).includes(programa)) throw new ErrorUsuario('Seleccione un programa.');
  // El residente ingresa con su correo (se guarda en la columna "usuario").
  const usuario = normalizarCorreo(datos.usuario);
  const clave = validarClaveNueva(datos.clave);

  const [existe] = await ctx.db.query('SELECT 1 FROM residentes WHERE usuario = $1', [usuario]);
  if (existe) throw new ErrorUsuario(`Ya existe un residente con el correo "${usuario}".`);
  // Si ya hay otra carpeta con el mismo nombre en el programa, se distingue con el correo.
  const [homonimo] = await ctx.db.query('SELECT 1 FROM residentes WHERE programa = $1 AND carpeta = $2', [programa, nombre]);
  try {
    await ctx.db.query(
      'INSERT INTO residentes (usuario, nombre, programa, carpeta, clave_hash) VALUES ($1, $2, $3, $4, $5)',
      [usuario, nombre, programa, homonimo ? `${nombre} (${usuario})` : nombre, await bcrypt.hash(clave, 10)]
    );
  } catch (e) {
    if (esDuplicado(e)) throw new ErrorUsuario(`Ya existe un residente con el correo "${usuario}".`);
    throw e;
  }
}

export async function listarResidentes(db: Db) {
  const filas = await db.query<{
    usuario: string; nombre: string; programa: string; carpeta: string; plan_subido: boolean; completas: number; en_curso: number | null;
  }>(
    `SELECT r.usuario, r.nombre, r.programa, r.carpeta, r.plan_subido,
            (COUNT(s.id) FILTER (WHERE s.estado = 'cerrada'))::int AS completas,
            MAX(s.numero) FILTER (WHERE s.estado <> 'cerrada') AS en_curso
       FROM residentes r LEFT JOIN sesiones s ON s.residente_id = r.id
      GROUP BY r.id ORDER BY r.programa, r.nombre`
  );
  return filas.map((f) => ({
    usuario: f.usuario,
    nombre: f.nombre,
    programa: f.programa,
    planSubido: f.plan_subido,
    sesionesCompletas: f.completas,
    sesionEnCurso: f.en_curso,
    carpeta: rutaResidente(f.programa, f.carpeta)
  }));
}

export async function restablecerClave(db: Db, usuario: string, clave: string) {
  const nueva = validarClaveNueva(clave);
  const filas = await db.query('UPDATE residentes SET clave_hash = $2 WHERE usuario = $1 RETURNING id', [
    String(usuario ?? '').toLowerCase(), await bcrypt.hash(nueva, 10)
  ]);
  if (!filas.length) throw new ErrorUsuario('Residente no encontrado.', 404);
}

/**
 * Elimina un residente con sus sesiones, asistencias y archivos (en una sola sentencia: todo o nada).
 * Las copias temporales aún no sincronizadas se borran del almacén. Su carpeta en Drive no se toca.
 */
export async function eliminarResidente(ctx: Ctx, usuario: string) {
  const u = String(usuario ?? '').trim().toLowerCase();
  const [r] = await ctx.db.query<{ id: number; nombre: string }>('SELECT id, nombre FROM residentes WHERE usuario = $1', [u]);
  if (!r) throw new ErrorUsuario('Residente no encontrado.', 404);
  const pendientes = await ctx.db.query<{ blob_url: string }>(
    `WITH ses AS (SELECT id FROM sesiones WHERE residente_id = $1),
          asi AS (DELETE FROM asistencias WHERE sesion_id IN (SELECT id FROM ses)),
          arc AS (DELETE FROM archivos WHERE residente_id = $1 RETURNING blob_url, blob_borrado),
          bor AS (DELETE FROM sesiones WHERE residente_id = $1),
          res AS (DELETE FROM residentes WHERE id = $1)
     SELECT blob_url FROM arc WHERE NOT blob_borrado`,
    [r.id]
  );
  await limpiarIntentos(ctx.db, 'r:' + u);
  try {
    await ctx.almacen.borrar(pendientes.map((p) => p.blob_url));
  } catch (e) {
    console.error('No se pudieron borrar copias temporales:', e);
  }
  return { nombre: r.nombre };
}

// ---------- Residente ----------

/** Residentes con los que puede registrar una sesión grupal: solo los de su mismo programa. */
export async function listarCompaneros(db: Db, residenteId: number) {
  return db.query<{ id: number; nombre: string }>(
    `SELECT id, nombre FROM residentes
      WHERE programa = (SELECT programa FROM residentes WHERE id = $1) AND id <> $1 ORDER BY nombre`,
    [residenteId]
  );
}

export async function autenticarResidente(db: Db, usuario: string, clave: string) {
  const u = String(usuario ?? '').trim().toLowerCase();
  await registrarIntento(db, 'r:' + u);
  const [r] = await db.query<Residente>('SELECT * FROM residentes WHERE usuario = $1', [u]);
  // Si escribe el documento con puntos o espacios ("1.144.123.456"), se compara sin ellos.
  const c = String(clave ?? '');
  const escrita = /^[\d\s.-]+$/.test(c) ? c.replace(/[\s.-]/g, '') : c;
  if (!r || !(await bcrypt.compare(escrita, r.clave_hash))) {
    throw new ErrorUsuario('Correo o contraseña incorrectos.', 401);
  }
  await limpiarIntentos(db, 'r:' + u);
  return r.id;
}

async function residente(db: Db, id: number) {
  const [r] = await db.query<Residente>('SELECT * FROM residentes WHERE id = $1', [id]);
  if (!r) throw new ErrorUsuario('SESION_EXPIRADA', 401);
  return r;
}

async function sesionAbierta(db: Db, residenteId: number) {
  const [s] = await db.query<Sesion>("SELECT * FROM sesiones WHERE residente_id = $1 AND estado <> 'cerrada'", [residenteId]);
  return s ?? null;
}

async function sesionEnEstado(db: Db, residenteId: number, esperado: EstadoSesion) {
  const s = await sesionAbierta(db, residenteId);
  if (!s) throw new ErrorUsuario('No hay una sesión abierta. Recargue la página.', 409);
  if (s.estado !== esperado) throw new ErrorUsuario('Este paso ya fue completado. Recargue la página para continuar.', 409);
  return s;
}

/** Reserva el número N+1. La restricción única evita dos sesiones abiertas o números repetidos. */
async function abrirSesion(db: Db, residenteId: number): Promise<Sesion> {
  for (let intento = 0; intento < 3; intento++) {
    try {
      const [s] = await db.query<Sesion>(
        `INSERT INTO sesiones (residente_id, numero, token)
         SELECT $1, COALESCE(MAX(numero), 0) + 1, $2 FROM sesiones WHERE residente_id = $1
         RETURNING *`,
        [residenteId, randomBytes(24).toString('base64url')]
      );
      return s;
    } catch (e) {
      if (!esDuplicado(e)) throw e;
      const abierta = await sesionAbierta(db, residenteId);
      if (abierta) return abierta;
    }
  }
  throw new ErrorUsuario('No se pudo abrir la sesión. Intente de nuevo.', 409);
}

async function contar(db: Db, sql: string, params: unknown[]) {
  const [f] = await db.query<{ n: number }>(sql, params);
  return Number(f?.n ?? 0);
}
const contarAsistentesSesion = (db: Db, sesionId: number) =>
  contar(db, 'SELECT count(*)::int AS n FROM asistencias WHERE sesion_id = $1', [sesionId]);
const contarArchivos = (db: Db, sesionId: number, tipo: TipoSubida) =>
  contar(db, 'SELECT count(*)::int AS n FROM archivos WHERE sesion_id = $1 AND tipo = $2', [sesionId, tipo]);

/**
 * Estado actual del residente. Si ya subió el plan y no tiene sesión abierta, abre la siguiente
 * (así el QR aparece apenas inicia sesión).
 */
export async function obtenerEstado(ctx: Ctx, residenteId: number): Promise<EstadoResidente> {
  const r = await residente(ctx.db, residenteId);
  const estado: EstadoResidente = { nombre: r.nombre, programa: r.programa, planSubido: r.plan_subido, sesion: null };
  if (!r.plan_subido) return estado;

  const s = (await sesionAbierta(ctx.db, r.id)) ?? (await abrirSesion(ctx.db, r.id));
  estado.sesion = {
    numero: s.numero,
    estado: s.estado,
    urlAsistencia: `${ctx.appUrl}/asistencia/${s.token}`,
    asistentes: await contarAsistentesSesion(ctx.db, s.id),
    fotos: await contarArchivos(ctx.db, s.id, 'foto'),
    material: await contarArchivos(ctx.db, s.id, 'material')
  };
  return estado;
}

export async function contarAsistentes(db: Db, residenteId: number) {
  const s = await sesionAbierta(db, residenteId);
  return s ? contarAsistentesSesion(db, s.id) : 0;
}

// ---------- Subidas ----------

/**
 * Prefijo que debe tener la ruta del archivo en el almacén para el paso actual.
 * Garantiza que un residente solo sube a su propio espacio y en el paso que corresponde.
 */
async function prefijoSubida(db: Db, r: Residente, tipo: TipoSubida) {
  if (tipo === 'plan') {
    if (r.plan_subido) throw new ErrorUsuario('El plan de clase ya fue cargado.', 409);
    return { prefijo: `r${r.id}/plan/`, sesion: null };
  }
  if (tipo === 'foto' || tipo === 'material') {
    const s = await sesionEnEstado(db, r.id, tipo === 'foto' ? 'fotos' : 'material');
    return { prefijo: `r${r.id}/s${s.id}/${tipo}/`, sesion: s };
  }
  throw new ErrorUsuario('Tipo de archivo desconocido.');
}

/** Valida el archivo antes de subirlo y devuelve la ruta que debe usar en el almacén. */
export async function prepararSubida(db: Db, residenteId: number, o: { tipo: TipoSubida; nombre: string; mime: string; bytes: number }) {
  const r = await residente(db, residenteId);
  const bytes = Number(o.bytes);
  if (!(bytes > 0)) throw new ErrorUsuario('El archivo está vacío.');
  if (bytes > MAX_FILE_BYTES) throw new ErrorUsuario(`"${o.nombre}" supera el límite de ${MAX_FILE_BYTES / 1048576} MB.`);
  if (o.tipo === 'plan') validarPlan(o.nombre);
  if (o.tipo === 'foto' && !String(o.mime).startsWith('image/')) throw new ErrorUsuario(`"${o.nombre}" no es una imagen.`);
  const { prefijo } = await prefijoSubida(db, r, o.tipo);
  // Nombre neutro en el almacén; el nombre real se usa en Drive.
  return { pathname: `${prefijo}${randomBytes(6).toString('hex')}.${o.nombre.split('.').pop()?.toLowerCase() || 'bin'}` };
}

/** Condiciones del token de subida directa a Vercel Blob (se llama desde /api/subidas). */
export async function autorizarSubida(db: Db, residenteId: number, tipo: TipoSubida, pathname: string) {
  const r = await residente(db, residenteId);
  const { prefijo } = await prefijoSubida(db, r, tipo);
  if (!pathname.startsWith(prefijo)) throw new ErrorUsuario('Subida no autorizada. Recargue la página.', 403);
  return {
    maximumSizeInBytes: MAX_FILE_BYTES,
    allowedContentTypes: tipo === 'foto' ? ['image/*'] : undefined,
    addRandomSuffix: true
  };
}

/** Inserta con el nombre dado; si ya existe en esa carpeta, prueba " (2)", " (3)"… */
async function insertarConNombreLibre<T>(nombre: string, insertar: (nombreFinal: string) => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await insertar(conSufijo(nombre, n));
    } catch (e) {
      if (!esDuplicado(e) || n > 50) throw e;
    }
  }
}

/** Registra un archivo ya subido al almacén con su ruta de destino en Drive. */
export async function confirmarSubida(ctx: Ctx, residenteId: number, o: { tipo: TipoSubida; url: string; nombre: string }) {
  const r = await residente(ctx.db, residenteId);
  const url = String(o.url ?? '');
  const [previo] = await ctx.db.query('SELECT 1 FROM archivos WHERE blob_url = $1', [url]);
  if (previo) {
    // Confirmación repetida (p. ej. reintento del navegador): no se registra dos veces.
    if (o.tipo === 'plan') return { estado: await obtenerEstado(ctx, r.id) };
    const s = await sesionAbierta(ctx.db, r.id);
    return { guardados: s ? await contarArchivos(ctx.db, s.id, o.tipo) : 0 };
  }

  const { prefijo, sesion } = await prefijoSubida(ctx.db, r, o.tipo);
  const info = await ctx.almacen.info(url);
  if (!info || !info.pathname.startsWith(prefijo)) throw new ErrorUsuario('El archivo no llegó correctamente. Intente subirlo de nuevo.');

  let carpetaDestino: string;
  let nombre: string;
  if (o.tipo === 'plan') {
    carpetaDestino = rutaResidente(r.programa, r.carpeta);
    nombre = `Plan de clase.${validarPlan(o.nombre)}`;
  } else {
    carpetaDestino = `${rutaSesion(r.programa, r.carpeta, sesion!.numero)}/${o.tipo === 'foto' ? CARPETA_FOTOS : CARPETA_MATERIAL}`;
    nombre = nombreSeguro(o.nombre) || 'archivo';
  }

  const archivo = await insertarConNombreLibre(nombre, async (n) => {
    const [f] = await ctx.db.query<{ id: number }>(
      'INSERT INTO archivos (residente_id, sesion_id, tipo, nombre, ruta, blob_url, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [r.id, sesion?.id ?? null, o.tipo, nombre, `${carpetaDestino}/${n}`, url, info.bytes]
    );
    return f.id;
  });

  // En una sesión grupal, el archivo también va a la carpeta de la sesión de cada compañero.
  if (sesion) {
    const subcarpeta = o.tipo === 'foto' ? CARPETA_FOTOS : CARPETA_MATERIAL;
    const copias = await ctx.db.query<{ id: number; numero: number; programa: string; carpeta: string }>(
      `SELECT s.id, s.numero, rr.programa, rr.carpeta FROM sesiones s JOIN residentes rr ON rr.id = s.residente_id
        WHERE s.origen_id = $1`, [sesion.id]
    );
    for (const c of copias) {
      await insertarConNombreLibre(nombre, (n) => ctx.db.query(
        'INSERT INTO archivo_copias (archivo_id, sesion_id, ruta) VALUES ($1, $2, $3)',
        [archivo, c.id, `${rutaSesion(c.programa, c.carpeta, c.numero)}/${subcarpeta}/${n}`]
      ));
    }
  }

  if (o.tipo === 'plan') {
    // Al cargar el plan se crea la bitácora (vacía, solo encabezados) en la carpeta del residente.
    await ctx.db.query('UPDATE residentes SET plan_subido = true, bitacora_version = bitacora_version + 1 WHERE id = $1', [r.id]);
    return { estado: await obtenerEstado(ctx, r.id) };
  }
  return { guardados: await contarArchivos(ctx.db, sesion!.id, o.tipo) };
}

// ---------- Bitácora y cierre ----------


/**
 * Guarda la bitácora. Si es grupal, en la misma sentencia (todo o nada) crea a cada compañero
 * su copia de la sesión, con su propio número siguiente, ya completa y apuntando a la original.
 */
export async function enviarBitacora(ctx: Ctx, residenteId: number, formulario: unknown) {
  const v = validarBitacora(formulario);
  if (v.errores.length) throw new ErrorUsuario(v.errores.join('\n'));
  const d = v.datos;
  const r = await residente(ctx.db, residenteId);
  if (d.companeros.length) {
    const validos = await ctx.db.query(
      'SELECT id FROM residentes WHERE id = ANY($1::int[]) AND programa = $2 AND id <> $3', [d.companeros, r.programa, r.id]
    );
    if (validos.length !== d.companeros.length) {
      throw new ErrorUsuario('Los compañeros deben ser residentes de su mismo programa. Recargue la página e inténtelo de nuevo.');
    }
  }
  let filas: { lider: number }[];
  try {
    filas = await ctx.db.query<{ lider: number }>(
      `WITH lider AS (
         UPDATE sesiones SET fecha = $2, hora_inicio = $3, hora_final = $4, duracion_min = $5, escenario = $6,
                poblacion = $7, participantes = $8, tema = $9, estrategias = $10, evaluaciones = $11,
                modalidad = $12, estado = 'fotos', bitacora_en = now()
          WHERE residente_id = $1 AND estado = 'qr' RETURNING *
       ), libres AS (
         -- Sesión reservada al ingresar y aún sin usar (sin asistentes): la copia toma su número.
         SELECT s.id, s.residente_id, s.numero FROM sesiones s
          WHERE s.residente_id = ANY($13::int[]) AND s.estado = 'qr' AND EXISTS (SELECT 1 FROM lider)
            AND NOT EXISTS (SELECT 1 FROM asistencias a WHERE a.sesion_id = s.id)
       ), corridas AS (
         -- ...y la sesión reservada pasa al número siguiente (carpeta y hoja de asistencia nuevas).
         UPDATE sesiones s SET numero = (SELECT MAX(x.numero) + 1 FROM sesiones x WHERE x.residente_id = s.residente_id),
                carpetas_sync = false, asistencia_version = s.asistencia_version + 1
           FROM libres l WHERE s.id = l.id RETURNING s.id
       ), copias AS (
         INSERT INTO sesiones (residente_id, numero, token, estado, fecha, hora_inicio, hora_final, duracion_min, escenario,
                               poblacion, participantes, tema, estrategias, evaluaciones, modalidad, origen_id,
                               bitacora_en, cerrada_en)
         SELECT c.id, COALESCE((SELECT l2.numero FROM libres l2 WHERE l2.residente_id = c.id),
                               (SELECT COALESCE(MAX(x.numero), 0) + 1 FROM sesiones x WHERE x.residente_id = c.id)),
                replace(gen_random_uuid()::text, '-', ''), 'cerrada', l.fecha, l.hora_inicio, l.hora_final, l.duracion_min,
                l.escenario, l.poblacion, l.participantes, l.tema, l.estrategias, l.evaluaciones, l.modalidad, l.id,
                now(), now()
           FROM lider l CROSS JOIN unnest($13::int[]) AS c(id)
         RETURNING id
       )
       SELECT (SELECT count(*) FROM lider)::int AS lider`,
      [residenteId, d.fecha, d.horaInicio, d.horaFinal, d.duracionMinutos, d.escenario, d.poblacion,
        d.participantes, d.tema, d.estrategias, d.evaluaciones, d.modalidad, d.companeros]
    );
  } catch (e) {
    // Otro registro tomó el mismo número de sesión de un compañero al mismo tiempo: nada quedó guardado.
    if (esDuplicado(e)) throw new ErrorUsuario('No se pudo guardar la bitácora. Intente enviarla de nuevo.', 409);
    throw e;
  }
  if (!filas[0]?.lider) throw new ErrorUsuario('Este paso ya fue completado. Recargue la página para continuar.', 409);
  await ctx.db.query('UPDATE residentes SET bitacora_version = bitacora_version + 1 WHERE id = ANY($1::int[])',
    [[residenteId, ...d.companeros]]);
  return obtenerEstado(ctx, residenteId);
}

export async function terminarFotos(ctx: Ctx, residenteId: number) {
  const s = await sesionEnEstado(ctx.db, residenteId, 'fotos');
  if (!(await contarArchivos(ctx.db, s.id, 'foto'))) throw new ErrorUsuario('Suba al menos una foto antes de continuar.');
  await ctx.db.query("UPDATE sesiones SET estado = 'material' WHERE id = $1 AND estado = 'fotos'", [s.id]);
  return obtenerEstado(ctx, residenteId);
}

/** Cierra la sesión: el QR deja de aceptar asistencia. */
export async function terminarSesion(ctx: Ctx, residenteId: number) {
  const s = await sesionEnEstado(ctx.db, residenteId, 'material');
  if (!(await contarArchivos(ctx.db, s.id, 'material'))) throw new ErrorUsuario('Suba al menos un archivo de material utilizado.');
  const filas = await ctx.db.query(
    "UPDATE sesiones SET estado = 'cerrada', cerrada_en = now() WHERE id = $1 AND estado = 'material' RETURNING id", [s.id]
  );
  if (!filas.length) throw new ErrorUsuario('Esta sesión ya fue cerrada. Recargue la página.', 409);
  return { sesionCerrada: s.numero };
}

// ---------- Asistencia de estudiantes (pública) ----------

export async function infoAsistencia(db: Db, token: string) {
  const [f] = await db.query<{ numero: number; estado: string; nombre: string; programa: string }>(
    `SELECT s.numero, s.estado, r.nombre, r.programa FROM sesiones s JOIN residentes r ON r.id = s.residente_id
      WHERE s.token = $1`,
    [String(token ?? '')]
  );
  if (!f) return null;
  return { numero: f.numero, residente: f.nombre, programa: f.programa, abierta: f.estado !== 'cerrada' };
}

export async function registrarAsistencia(ctx: Ctx, token: string, formulario: unknown) {
  const v = validarAsistencia(formulario);
  if (v.errores.length) throw new ErrorUsuario(v.errores.join('\n'));
  const [s] = await ctx.db.query<Sesion>('SELECT * FROM sesiones WHERE token = $1', [String(token ?? '')]);
  if (!s) throw new ErrorUsuario('El enlace de asistencia no es válido.', 404);
  if (s.estado === 'cerrada') throw new ErrorUsuario('Esta sesión ya fue cerrada y no recibe más registros.', 409);
  const d = v.datos;
  const [f] = await ctx.db.query<{ actualizado: boolean }>(
    `INSERT INTO asistencias (sesion_id, nombre, correo, universidad, semestre) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sesion_id, correo) DO UPDATE
       SET nombre = EXCLUDED.nombre, universidad = EXCLUDED.universidad, semestre = EXCLUDED.semestre, actualizado = now()
     RETURNING (creado <> actualizado) AS actualizado`,
    [s.id, d.nombre, d.correo, d.universidad, d.semestre]
  );
  // La asistencia también es la de las copias de los compañeros (sesión grupal).
  await ctx.db.query('UPDATE sesiones SET asistencia_version = asistencia_version + 1 WHERE id = $1 OR origen_id = $1', [s.id]);
  // La bitácora muestra el número de asistentes: si ya se envió, también cambia (la de cada participante).
  if (s.bitacora_en) {
    await ctx.db.query(
      `UPDATE residentes SET bitacora_version = bitacora_version + 1
        WHERE id IN (SELECT residente_id FROM sesiones WHERE id = $1 OR origen_id = $1)`, [s.id]
    );
  }
  return { actualizado: f.actualizado, numero: s.numero };
}

// ---------- Sincronización con Google Drive ----------

const fechaDMY = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');

function fechaHora(fecha: Date | string | null) {
  if (!fecha) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-CO', {
      timeZone: ZONA_HORARIA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(fecha)).map((x) => [x.type, x.value])
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export type Celda = string | number;

export interface Hoja {
  ruta: string;
  filas: Celda[][];
}

export interface Confirmacion {
  programas: boolean;
  residentes: number[];
  sesiones: number[];
  archivos: number[];
  copias: number[];
  bitacoras: { id: number; version: number }[];
  asistencias: { id: number; version: number }[];
}

export interface Pendientes {
  carpetas: string[];
  archivos: { ruta: string; url: string; bytes: number }[];
  hojas: Hoja[];
  /** El sincronizador la devuelve tal cual a confirmarSync cuando todo quedó en Drive. */
  confirmacion: Confirmacion;
}

async function filasBitacora(db: Db, residenteId: number): Promise<Celda[][]> {
  // En una copia grupal, asistentes y participantes se toman de la sesión original.
  const sesiones = await db.query<Sesion & { asistentes: number; otros: string | null }>(
    `SELECT s.*,
            (SELECT count(*) FROM asistencias a WHERE a.sesion_id = COALESCE(s.origen_id, s.id))::int AS asistentes,
            (SELECT string_agg(CASE WHEN x.id = COALESCE(s.origen_id, s.id) THEN rr.nombre || ' (registró)' ELSE rr.nombre END,
                               ', ' ORDER BY (x.id = COALESCE(s.origen_id, s.id)) DESC, rr.nombre)
               FROM sesiones x JOIN residentes rr ON rr.id = x.residente_id
              WHERE (x.id = COALESCE(s.origen_id, s.id) OR x.origen_id = COALESCE(s.origen_id, s.id)) AND x.id <> s.id) AS otros
       FROM sesiones s WHERE s.residente_id = $1 AND s.bitacora_en IS NOT NULL ORDER BY s.numero`,
    [residenteId]
  );
  return [
    BITACORA_ENCABEZADOS,
    ...sesiones.map((s) => [
      s.numero, s.modalidad, s.otros ?? '', fechaDMY(s.fecha), s.hora_inicio ?? '', s.hora_final ?? '', formatDuracion(s.duracion_min ?? 0),
      s.escenario ?? '', s.poblacion ?? '', s.participantes ?? '', s.tema ?? '',
      (s.estrategias ?? []).join(', '), (s.evaluaciones ?? []).join(', '), s.asistentes,
      `Evidencia Sesión ${s.numero}`, fechaHora(s.bitacora_en)
    ])
  ];
}

async function filasAsistencia(db: Db, sesionId: number): Promise<Celda[][]> {
  const filas = await db.query<{ nombre: string; correo: string; universidad: string; semestre: string; actualizado: Date }>(
    `SELECT nombre, correo, universidad, semestre, actualizado FROM asistencias
      WHERE sesion_id = (SELECT COALESCE(origen_id, id) FROM sesiones WHERE id = $1) ORDER BY id`, [sesionId]
  );
  return [
    ASISTENCIA_ENCABEZADOS,
    ...filas.map((a) => [fechaHora(a.actualizado), a.nombre, a.correo, a.universidad, a.semestre, 'Sí'])
  ];
}

/** Todo lo que falta llevar a Google Drive (por lotes). */
export async function pendientesSync(db: Db, limite = 200): Promise<Pendientes> {
  const carpetas: string[] = [];
  const confirmacion: Confirmacion = {
    programas: false, residentes: [], sesiones: [], archivos: [], copias: [], bitacoras: [], asistencias: []
  };

  if ((await leerAjuste(db, 'programas_sync')) !== '1') {
    carpetas.push(...PROGRAMAS.map(rutaPrograma));
    confirmacion.programas = true;
  }
  for (const r of await db.query<Residente>('SELECT * FROM residentes WHERE NOT carpeta_sync ORDER BY id LIMIT $1', [limite])) {
    carpetas.push(rutaResidente(r.programa, r.carpeta));
    confirmacion.residentes.push(r.id);
  }
  const sesionesNuevas = await db.query<{ id: number; numero: number; programa: string; carpeta: string }>(
    `SELECT s.id, s.numero, r.programa, r.carpeta FROM sesiones s JOIN residentes r ON r.id = s.residente_id
      WHERE NOT s.carpetas_sync ORDER BY s.id LIMIT $1`, [limite]
  );
  for (const s of sesionesNuevas) {
    const base = rutaSesion(s.programa, s.carpeta, s.numero);
    carpetas.push(`${base}/${CARPETA_FOTOS}`, `${base}/${CARPETA_MATERIAL}`);
    confirmacion.sesiones.push(s.id);
  }

  const archivos = await db.query<{ id: number; ruta: string; blob_url: string; bytes: string | number }>(
    'SELECT id, ruta, blob_url, bytes FROM archivos WHERE sincronizado_en IS NULL ORDER BY id LIMIT $1', [limite]
  );
  confirmacion.archivos = archivos.map((a) => a.id);
  const copias = await db.query<{ id: number; ruta: string; blob_url: string; bytes: string | number }>(
    `SELECT c.id, c.ruta, a.blob_url, a.bytes FROM archivo_copias c JOIN archivos a ON a.id = c.archivo_id
      WHERE c.sincronizado_en IS NULL ORDER BY c.id LIMIT $1`, [limite]
  );
  confirmacion.copias = copias.map((c) => c.id);

  const hojas: Hoja[] = [];
  const bitacoras = await db.query<{ id: number; programa: string; carpeta: string; bitacora_version: number }>(
    'SELECT id, programa, carpeta, bitacora_version FROM residentes WHERE bitacora_version > bitacora_sync ORDER BY id LIMIT $1', [limite]
  );
  for (const r of bitacoras) {
    hojas.push({ ruta: `${rutaResidente(r.programa, r.carpeta)}/Bitácora.xlsx`, filas: await filasBitacora(db, r.id) });
    confirmacion.bitacoras.push({ id: r.id, version: r.bitacora_version });
  }
  const asistencias = await db.query<{ id: number; numero: number; programa: string; carpeta: string; asistencia_version: number }>(
    `SELECT s.id, s.numero, r.programa, r.carpeta, s.asistencia_version FROM sesiones s JOIN residentes r ON r.id = s.residente_id
      WHERE s.asistencia_version > s.asistencia_sync ORDER BY s.id LIMIT $1`, [limite]
  );
  for (const s of asistencias) {
    hojas.push({
      ruta: `${rutaSesion(s.programa, s.carpeta, s.numero)}/Asistencia Sesión ${s.numero}.xlsx`,
      filas: await filasAsistencia(db, s.id)
    });
    confirmacion.asistencias.push({ id: s.id, version: s.asistencia_version });
  }

  return {
    carpetas,
    archivos: [...archivos, ...copias].map((a) => ({ ruta: a.ruta, url: a.blob_url, bytes: Number(a.bytes) })),
    hojas,
    confirmacion
  };
}

const esEntero = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const enteros = (v: unknown) => (Array.isArray(v) ? v.filter(esEntero) : []);
const versiones = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter((x) => esEntero(x?.id) && esEntero(x?.version)) as { id: number; version: number }[];

/**
 * Marca como sincronizado lo que el sincronizador ya dejó en Drive y borra esas copias temporales.
 * Las versiones evitan perder un cambio que llegó mientras se sincronizaba.
 */
export async function confirmarSync(ctx: Ctx, c: Partial<Confirmacion>) {
  const db = ctx.db;
  if (c.programas === true) await guardarAjuste(db, 'programas_sync', '1');
  const residentes = enteros(c.residentes);
  if (residentes.length) await db.query('UPDATE residentes SET carpeta_sync = true WHERE id = ANY($1::int[])', [residentes]);
  const sesiones = enteros(c.sesiones);
  if (sesiones.length) await db.query('UPDATE sesiones SET carpetas_sync = true WHERE id = ANY($1::int[])', [sesiones]);

  const ids = enteros(c.archivos);
  if (ids.length) {
    await db.query('UPDATE archivos SET sincronizado_en = now() WHERE id = ANY($1::int[]) AND sincronizado_en IS NULL', [ids]);
  }
  const copias = enteros(c.copias);
  if (copias.length) {
    await db.query('UPDATE archivo_copias SET sincronizado_en = now() WHERE id = ANY($1::int[]) AND sincronizado_en IS NULL', [copias]);
  }
  // La copia temporal se borra cuando el archivo y todas sus copias ya están en Drive.
  const listos = await db.query<{ id: number; blob_url: string }>(
    `SELECT a.id, a.blob_url FROM archivos a
      WHERE NOT a.blob_borrado AND a.sincronizado_en IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM archivo_copias c WHERE c.archivo_id = a.id AND c.sincronizado_en IS NULL)`
  );
  let borrados = 0;
  if (listos.length) {
    try {
      await ctx.almacen.borrar(listos.map((l) => l.blob_url));
      await db.query('UPDATE archivos SET blob_borrado = true WHERE id = ANY($1::int[])', [listos.map((l) => l.id)]);
      borrados = listos.length;
    } catch (e) {
      console.error('No se pudieron borrar copias temporales (se reintentará):', e);
    }
  }
  for (const b of versiones(c.bitacoras)) {
    await db.query('UPDATE residentes SET bitacora_sync = GREATEST(bitacora_sync, $2) WHERE id = $1', [b.id, b.version]);
  }
  for (const a of versiones(c.asistencias)) {
    await db.query('UPDATE sesiones SET asistencia_sync = GREATEST(asistencia_sync, $2) WHERE id = $1', [a.id, a.version]);
  }
  await guardarAjuste(db, 'ultima_sync', new Date().toISOString());
  return { archivos: ids.length, borrados };
}

export async function estadoSync(db: Db) {
  const [p] = await db.query<{ archivos: number; hojas: number }>(
    `SELECT ((SELECT count(*) FROM archivos WHERE sincronizado_en IS NULL)
             + (SELECT count(*) FROM archivo_copias WHERE sincronizado_en IS NULL))::int AS archivos,
            ((SELECT count(*) FROM residentes WHERE bitacora_version > bitacora_sync)
             + (SELECT count(*) FROM sesiones WHERE asistencia_version > asistencia_sync))::int AS hojas`
  );
  return { archivosPendientes: p.archivos, hojasPendientes: p.hojas, ultima: await leerAjuste(db, 'ultima_sync') };
}

/** Vuelve a enviar todas las carpetas y hojas (por ejemplo, si se borró algo en Drive). Los archivos ya enviados no se pueden reenviar. */
export async function reenviarTodo(db: Db) {
  await guardarAjuste(db, 'programas_sync', '0');
  await db.query('UPDATE residentes SET carpeta_sync = false, bitacora_sync = 0, bitacora_version = GREATEST(bitacora_version, 1) WHERE plan_subido');
  await db.query('UPDATE residentes SET carpeta_sync = false WHERE NOT plan_subido');
  await db.query('UPDATE sesiones SET carpetas_sync = false, asistencia_sync = 0');
}
