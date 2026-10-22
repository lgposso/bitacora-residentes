import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, test } from 'vitest';
import { AlmacenLocal } from './almacen';
import { ASISTENCIA_ENCABEZADOS, BITACORA_ENCABEZADOS, PROGRAMAS } from './config';
import { asegurarEsquema, dbPglite } from './db';
import * as S from './servicio';

let ctx: S.Ctx;
let almacen: AlmacenLocal;

beforeEach(async () => {
  const db = dbPglite(new PGlite());
  await asegurarEsquema(db);
  almacen = new AlmacenLocal();
  ctx = { db, almacen, appUrl: 'https://app.test' };
  process.env.ADMIN_PASSWORD = 'admin123';
});

/** Simula el navegador: preparar, "subir" al almacén y confirmar. */
async function subir(residenteId: number, tipo: S.TipoSubida, nombre: string, mime: string) {
  const { pathname } = await S.prepararSubida(ctx.db, residenteId, { tipo, nombre, mime, bytes: 1000 });
  await S.autorizarSubida(ctx.db, residenteId, tipo, pathname);
  almacen.guardar(pathname, new Uint8Array(1000), mime);
  return S.confirmarSubida(ctx, residenteId, { tipo, url: `https://app.test/api/dev/almacen?p=${encodeURIComponent(pathname)}`, nombre });
}

const bitacora = {
  modalidad: 'Individual',
  fecha: '2026-09-29', horaInicio: '07:00', horaFinal: '08:45',
  escenario: 'Otro', escenarioOtro: 'Auditorio', poblacion: 'Ambos', participantes: '15',
  tema: 'Manejo de sepsis', estrategias: ['Caso clínico', 'Gamificación'], evaluaciones: ['Rúbrica', 'Estación ECOE']
};

const estudiante = (nombre: string, correo: string, semestre = '8', universidad = 'Universidad del Valle') =>
  ({ nombre, correo, universidad, semestre, autoriza: true });

async function residenteConPlan(usuario = 'laura.gomez@correo.com', nombre = 'Laura Gómez', programa = 'Pediatría') {
  await S.crearResidente(ctx, { nombre, programa, usuario, clave: '1144123456' });
  const id = await S.autenticarResidente(ctx.db, usuario, '1144123456');
  await subir(id, 'plan', 'mi plan.pdf', 'application/pdf');
  return id;
}

describe('flujo del residente', () => {
  test('admin → residente → QR → bitácora → evidencias → nueva sesión', async () => {
    // Administradora
    await expect(S.verificarClaveAdmin(ctx.db, 'mala')).rejects.toThrow(/incorrecta/);
    await S.verificarClaveAdmin(ctx.db, 'admin123');
    await S.crearResidente(ctx, { nombre: 'Laura Gómez', programa: 'Pediatría', usuario: 'Laura.Gomez@Correo.com', clave: '1144123456' });
    await expect(S.crearResidente(ctx, { nombre: 'Otra', programa: 'Pediatría', usuario: 'laura.gomez@correo.com', clave: '1144123456' })).rejects.toThrow(/Ya existe/);
    await expect(S.crearResidente(ctx, { nombre: 'X Y', programa: 'Nada', usuario: 'xy@correo.com', clave: '1144123456' })).rejects.toThrow(/programa/);
    await expect(S.crearResidente(ctx, { nombre: 'X Y', programa: 'Pediatría', usuario: 'jperez', clave: '1144123456' })).rejects.toThrow(/correo/);

    // Login
    await expect(S.autenticarResidente(ctx.db, 'laura.gomez@correo.com', 'mal')).rejects.toThrow(/incorrectos/);
    const id = await S.autenticarResidente(ctx.db, ' LAURA.GOMEZ@CORREO.COM ', '1144123456');
    let estado = await S.obtenerEstado(ctx, id);
    expect(estado.planSubido).toBe(false);
    expect(estado.sesion).toBeNull();

    // Plan de clase
    await expect(subir(id, 'plan', 'foto.jpg', 'image/jpeg')).rejects.toThrow(/Formato/);
    estado = ((await subir(id, 'plan', 'mi plan.pdf', 'application/pdf')) as { estado: S.EstadoResidente }).estado;
    await expect(subir(id, 'plan', 'otro.pdf', 'application/pdf')).rejects.toThrow(/ya fue cargado/);

    // La sesión 1 se abre sola
    expect(estado.sesion?.numero).toBe(1);
    expect(estado.sesion?.estado).toBe('qr');
    expect((await S.obtenerEstado(ctx, id)).sesion?.numero).toBe(1);

    // Asistencia
    const token = estado.sesion!.urlAsistencia.split('/asistencia/')[1];
    expect(estado.sesion!.urlAsistencia).toMatch(/^https:\/\/app\.test\/asistencia\//);
    expect((await S.infoAsistencia(ctx.db, token))?.residente).toBe('Laura Gómez');
    expect(await S.infoAsistencia(ctx.db, 'no-existe@correo.com')).toBeNull();
    expect((await S.registrarAsistencia(ctx, token, estudiante('Ana Pérez', 'ana@u.edu.co'))).actualizado).toBe(false);
    await S.registrarAsistencia(ctx, token, estudiante('Juan Ruiz', 'juan@u.edu.co', '10'));
    expect((await S.registrarAsistencia(ctx, token, estudiante('Ana María Pérez', 'ANA@u.edu.co', '9'))).actualizado).toBe(true);
    await expect(S.registrarAsistencia(ctx, token, { ...estudiante('Sin', 'x@y.co'), autoriza: false })).rejects.toThrow(/autorizar/);
    expect(await S.contarAsistentes(ctx.db, id)).toBe(2);

    // No se pueden saltar pasos
    await expect(subir(id, 'foto', 'a.jpg', 'image/jpeg')).rejects.toThrow(/completado/);

    // Bitácora
    await expect(S.enviarBitacora(ctx, id, { ...bitacora, horaFinal: '06:00' })).rejects.toThrow(/posterior/);
    estado = await S.enviarBitacora(ctx, id, bitacora);
    expect(estado.sesion?.estado).toBe('fotos');
    await expect(S.enviarBitacora(ctx, id, bitacora)).rejects.toThrow(/completado/);

    // Fotos (dos con el mismo nombre → " (2)")
    await expect(S.terminarFotos(ctx, id)).rejects.toThrow(/al menos una foto/);
    await expect(subir(id, 'foto', 'doc.pdf', 'application/pdf')).rejects.toThrow(/no es una imagen/);
    expect(await subir(id, 'foto', 'IMG_1.jpg', 'image/jpeg')).toEqual({ guardados: 1 });
    expect(await subir(id, 'foto', 'IMG_1.jpg', 'image/jpeg')).toEqual({ guardados: 2 });
    expect((await S.terminarFotos(ctx, id)).sesion?.estado).toBe('material');

    // Material y cierre
    await expect(S.terminarSesion(ctx, id)).rejects.toThrow(/al menos un archivo/);
    expect(await subir(id, 'material', 'slides.pptx', 'application/vnd.ms-powerpoint')).toEqual({ guardados: 1 });
    await S.registrarAsistencia(ctx, token, estudiante('Tardío Uno', 't@u.edu.co', '12'));
    expect(await S.terminarSesion(ctx, id)).toEqual({ sesionCerrada: 1 });

    // QR cerrado
    await expect(S.registrarAsistencia(ctx, token, estudiante('Tarde', 'z@u.edu.co'))).rejects.toThrow(/cerrada/);
    expect((await S.infoAsistencia(ctx.db, token))?.abierta).toBe(false);

    // Siguiente ingreso → sesión 2
    expect((await S.obtenerEstado(ctx, id)).sesion?.numero).toBe(2);

    // Panel admin
    const [fila] = await S.listarResidentes(ctx.db);
    expect(fila).toMatchObject({
      usuario: 'laura.gomez@correo.com', planSubido: true, sesionesCompletas: 1, sesionEnCurso: 2, carpeta: 'MGB/Proyecto1/Pediatría/Laura Gómez'
    });

    // Restablecer clave
    await S.restablecerClave(ctx.db, 'laura.gomez@correo.com', '987654321');
    await expect(S.autenticarResidente(ctx.db, 'laura.gomez@correo.com', '1144123456')).rejects.toThrow(/incorrectos/);
    expect(await S.autenticarResidente(ctx.db, 'laura.gomez@correo.com', '987654321')).toBe(id);
    // Si lo escribe con puntos o espacios, también entra
    expect(await S.autenticarResidente(ctx.db, 'laura.gomez@correo.com', '987.654.321')).toBe(id);
    await expect(S.restablecerClave(ctx.db, 'laura.gomez@correo.com', 'clave123')).rejects.toThrow(/documento/);
  });

  test('una subida no puede ir al espacio de otro residente ni a otro paso', async () => {
    const a = await residenteConPlan('ana.uno@correo.com', 'Ana Uno');
    const b = await residenteConPlan('beto.dos@correo.com', 'Beto Dos');
    const { pathname } = await S.prepararSubida(ctx.db, a, { tipo: 'plan', nombre: 'x.pdf', mime: 'application/pdf', bytes: 10 })
      .catch(() => ({ pathname: 'r1/plan/x.pdf' }));
    await expect(S.autorizarSubida(ctx.db, b, 'plan', pathname)).rejects.toThrow();
    // 'foto' todavía no corresponde (la sesión está en el paso QR)
    await expect(S.autorizarSubida(ctx.db, a, 'foto', `r${a}/s1/foto/x.jpg`)).rejects.toThrow(/completado/);
  });

  test('pedir el estado varias veces a la vez abre una sola sesión', async () => {
    const id = await residenteConPlan();
    const estados = await Promise.all([1, 2, 3].map(() => S.obtenerEstado(ctx, id)));
    expect(new Set(estados.map((e) => e.sesion?.numero))).toEqual(new Set([1]));
    const [{ n }] = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM sesiones');
    expect(n).toBe(1);
  });

  test('la contraseña es el número de documento (se limpian puntos y espacios)', async () => {
    await S.crearResidente(ctx, { nombre: 'Doc Prueba', programa: 'Pediatría', usuario: 'doc1@correo.com', clave: '1.144.123.456' });
    expect(await S.autenticarResidente(ctx.db, 'doc1@correo.com', '1144123456')).toBeGreaterThan(0);
    expect(await S.autenticarResidente(ctx.db, 'doc1@correo.com', ' 1 144 123 456 ')).toBeGreaterThan(0);
    for (const malo of ['secreta1', '1234', '1234567890123456', '']) {
      await expect(S.crearResidente(ctx, { nombre: 'Otro Doc', programa: 'Pediatría', usuario: 'doc2@correo.com', clave: malo }))
        .rejects.toThrow(/documento/);
    }
  });

  test('eliminar un residente borra sus sesiones, asistencias y archivos pendientes', async () => {
    const id = await residenteConPlan('borrar@correo.com', 'Para Borrar');
    const otro = await residenteConPlan('queda@correo.com', 'Se Queda');
    const token = (await S.obtenerEstado(ctx, id)).sesion!.urlAsistencia.split('/asistencia/')[1];
    await S.registrarAsistencia(ctx, token, estudiante('Ana', 'ana@u.co'));
    await S.enviarBitacora(ctx, id, bitacora);
    await subir(id, 'foto', 'f1.jpg', 'image/jpeg');
    await S.obtenerEstado(ctx, otro);
    expect(almacen.archivos.size).toBe(3); // 2 planes + 1 foto

    await expect(S.eliminarResidente(ctx, 'no-existe@correo.com')).rejects.toThrow(/no encontrado/);
    expect(await S.eliminarResidente(ctx, 'BORRAR@correo.com')).toEqual({ nombre: 'Para Borrar' });

    expect((await S.listarResidentes(ctx.db)).map((r) => r.usuario)).toEqual(['queda@correo.com']);
    await expect(S.autenticarResidente(ctx.db, 'borrar@correo.com', '1144123456')).rejects.toThrow(/incorrectos/);
    expect(await S.infoAsistencia(ctx.db, token)).toBeNull();
    expect(almacen.archivos.size).toBe(1); // solo queda el plan del otro residente
    const p = await S.pendientesSync(ctx.db);
    expect(JSON.stringify(p)).not.toContain('Para Borrar');
    // Su nombre de usuario queda libre otra vez
    await S.crearResidente(ctx, { nombre: 'Para Borrar', programa: 'Pediatría', usuario: 'borrar@correo.com', clave: '55555' });
  });

  test('bloquea tras 10 intentos fallidos', async () => {
    for (let i = 0; i < 10; i++) await expect(S.autenticarResidente(ctx.db, 'nadie@correo.com', 'x')).rejects.toThrow(/incorrectos/);
    await expect(S.autenticarResidente(ctx.db, 'nadie@correo.com', 'x')).rejects.toThrow(/Demasiados/);
  });
});

describe('sincronización con Drive', () => {
  test('entrega carpetas, archivos y hojas con sus rutas, y no repite lo confirmado', async () => {
    const id = await residenteConPlan();
    const token = (await S.obtenerEstado(ctx, id)).sesion!.urlAsistencia.split('/asistencia/')[1];
    await S.registrarAsistencia(ctx, token, estudiante('Ana Pérez', 'ana@u.edu.co'));
    await S.enviarBitacora(ctx, id, bitacora);
    await subir(id, 'foto', 'f1.jpg', 'image/jpeg');

    const base = 'MGB/Proyecto1/Pediatría/Laura Gómez';
    const p = await S.pendientesSync(ctx.db);
    expect(p.carpetas).toEqual([
      ...PROGRAMAS.map((x) => `MGB/Proyecto1/${x}`),
      base,
      `${base}/Evidencia Sesión 1/Registro Fotográfico`,
      `${base}/Evidencia Sesión 1/Material Utilizado`
    ]);
    expect(p.archivos.map((a) => a.ruta)).toEqual([
      `${base}/Plan de clase.pdf`,
      `${base}/Evidencia Sesión 1/Registro Fotográfico/f1.jpg`
    ]);
    const bit = p.hojas.find((h) => h.ruta === `${base}/Bitácora.xlsx`)!;
    expect(bit.filas[0]).toEqual(BITACORA_ENCABEZADOS);
    expect(bit.filas[1].slice(0, 15)).toEqual([
      1, 'Individual', '', '29/09/2026', '07:00', '08:45', '1 h 45 min', 'Otro: Auditorio', 'Ambos', 15, 'Manejo de sepsis',
      'Caso clínico, Gamificación', 'Rúbrica, Estación ECOE', 1, 'Evidencia Sesión 1'
    ]);
    const asis = p.hojas.find((h) => h.ruta === `${base}/Evidencia Sesión 1/Asistencia Sesión 1.xlsx`)!;
    expect(asis.filas[0]).toEqual(ASISTENCIA_ENCABEZADOS);
    expect(asis.filas[1].slice(1)).toEqual(['Ana Pérez', 'ana@u.edu.co', 'Universidad del Valle', '8', 'Sí']);

    // Un cambio que llega mientras se sincroniza no se pierde (versiones)
    await S.registrarAsistencia(ctx, token, estudiante('Juan Ruiz', 'juan@u.edu.co'));
    expect(almacen.archivos.size).toBe(2);
    expect(await S.confirmarSync(ctx, p.confirmacion)).toEqual({ archivos: 2, borrados: 2 });
    expect(almacen.archivos.size).toBe(0);

    const p2 = await S.pendientesSync(ctx.db);
    expect(p2.carpetas).toEqual([]);
    expect(p2.archivos).toEqual([]);
    expect(p2.hojas.map((h) => h.ruta).sort()).toEqual([
      `${base}/Bitácora.xlsx`, `${base}/Evidencia Sesión 1/Asistencia Sesión 1.xlsx`
    ]);
    await S.confirmarSync(ctx, p2.confirmacion);

    const p3 = await S.pendientesSync(ctx.db);
    expect(p3).toMatchObject({ carpetas: [], archivos: [], hojas: [] });
    expect((await S.estadoSync(ctx.db)).ultima).toBeTruthy();

    // Reenviar todo vuelve a entregar carpetas y hojas (no los archivos ya borrados)
    await S.reenviarTodo(ctx.db);
    const p4 = await S.pendientesSync(ctx.db);
    expect(p4.carpetas.length).toBe(8);
    expect(p4.hojas.length).toBe(2);
    expect(p4.archivos).toEqual([]);
  });

  test('confirmar dos veces no falla ni borra de más', async () => {
    const id = await residenteConPlan();
    await S.obtenerEstado(ctx, id);
    const p = await S.pendientesSync(ctx.db);
    await S.confirmarSync(ctx, p.confirmacion);
    expect(await S.confirmarSync(ctx, p.confirmacion)).toEqual({ archivos: 1, borrados: 0 });
    expect(await S.estadoSync(ctx.db)).toMatchObject({ archivosPendientes: 0, hojasPendientes: 0 });
  });

  test('ignora datos basura en la confirmación', async () => {
    await expect(S.confirmarSync(ctx, { archivos: ['x', null] as unknown as number[], bitacoras: [{ id: 'a' }] as never }))
      .resolves.toEqual({ archivos: 0, borrados: 0 });
  });
});

describe('migración', () => {
  test('una base creada antes de existir "universidad" recibe la columna sin perder registros', async () => {
    const pg = new PGlite();
    const db = dbPglite(pg);
    // Esquema tal como estaba publicado (asistencias sin universidad).
    await asegurarEsquema(db);
    await db.query('ALTER TABLE asistencias DROP COLUMN universidad');
    ctx = { db, almacen, appUrl: 'https://app.test' };
    const id = await residenteConPlan();
    const token = (await S.obtenerEstado(ctx, id)).sesion!.urlAsistencia.split('/asistencia/')[1];
    const [s] = await db.query<{ id: number }>('SELECT id FROM sesiones');
    await db.query("INSERT INTO asistencias (sesion_id, nombre, correo, semestre) VALUES ($1, 'Antes Uno', 'antes@u.co', '7')", [s.id]);

    await asegurarEsquema(db); // lo que hace la app al arrancar con la versión nueva
    await asegurarEsquema(db); // y es idempotente

    await S.registrarAsistencia(ctx, token, estudiante('Después Dos', 'despues@u.co', '9', 'Universidad del Cauca'));
    const filas = (await S.pendientesSync(db)).hojas.find((h) => h.ruta.endsWith('Asistencia Sesión 1.xlsx'))!.filas;
    expect(filas.map((f) => f.slice(1, 5))).toEqual([
      ['Nombres y apellidos', 'Correo electrónico', 'Universidad', 'Semestre'],
      ['Antes Uno', 'antes@u.co', '', '7'],
      ['Después Dos', 'despues@u.co', 'Universidad del Cauca', '9']
    ]);
  });
});

describe('sesión grupal', () => {
  async function escenario() {
    const laura = await residenteConPlan('laura@correo.com', 'Laura Gómez');
    const ana = await residenteConPlan('ana@correo.com', 'Ana Ruiz');
    const pedro = await residenteConPlan('pedro@correo.com', 'Pedro Díaz');
    const carlos = await residenteConPlan('carlos@correo.com', 'Carlos Mora', 'Cirugía General');
    // Pedro está en plena sesión 1 (ya tiene asistentes); la sesión 1 de Ana está reservada pero sin usar.
    const tokenPedro = (await S.obtenerEstado(ctx, pedro)).sesion!.urlAsistencia.split('/asistencia/')[1];
    await S.registrarAsistencia(ctx, tokenPedro, estudiante('De Pedro', 'depedro@u.co'));
    const token = (await S.obtenerEstado(ctx, laura)).sesion!.urlAsistencia.split('/asistencia/')[1];
    return { laura, ana, pedro, carlos, token };
  }

  test('la lista de compañeros es solo de su mismo programa y no lo incluye a él', async () => {
    const { laura, carlos } = await escenario();
    expect((await S.listarCompaneros(ctx.db, laura)).map((c) => c.nombre)).toEqual(['Ana Ruiz', 'Pedro Díaz']);
    expect(await S.listarCompaneros(ctx.db, carlos)).toEqual([]);
  });

  test('no acepta compañeros de otro programa ni a sí mismo', async () => {
    const { laura, ana, carlos } = await escenario();
    for (const malos of [[ana, carlos], [laura], [99999]]) {
      await expect(S.enviarBitacora(ctx, laura, { ...bitacora, modalidad: 'Grupal', companeros: malos }))
        .rejects.toThrow(/mismo programa/);
    }
    // Nada cambió: la sesión de Laura sigue esperando la bitácora
    expect((await S.obtenerEstado(ctx, laura)).sesion?.estado).toBe('qr');
  });

  test('se replica a cada compañero con su propio número, archivos y asistencia', async () => {
    const { laura, ana, pedro, token } = await escenario();
    await S.registrarAsistencia(ctx, token, estudiante('Est Uno', 'uno@u.co'));
    await S.enviarBitacora(ctx, laura, { ...bitacora, modalidad: 'Grupal', companeros: [ana, pedro] });

    // Cuenta como sesión completa para cada compañero.
    // Ana: la copia toma su número reservado sin usar (1) y su sesión abierta pasa a la 2.
    // Pedro: su sesión 1 ya está en uso, así que la copia queda como la 2.
    const lista = Object.fromEntries((await S.listarResidentes(ctx.db)).map((r) => [r.nombre, r]));
    expect(lista['Ana Ruiz']).toMatchObject({ sesionesCompletas: 1, sesionEnCurso: 2 });
    expect(lista['Pedro Díaz']).toMatchObject({ sesionesCompletas: 1, sesionEnCurso: 1 });
    expect((await S.obtenerEstado(ctx, ana)).sesion?.numero).toBe(2);
    expect((await S.obtenerEstado(ctx, pedro)).sesion?.numero).toBe(1);

    // Asistentes tardíos y archivos subidos por Laura llegan también a los compañeros
    await S.registrarAsistencia(ctx, token, estudiante('Est Dos', 'dos@u.co'));
    await subir(laura, 'foto', 'grupo.jpg', 'image/jpeg');

    const p = await S.pendientesSync(ctx.db);
    const base = 'MGB/Proyecto1/Pediatría';
    expect(p.carpetas).toEqual(expect.arrayContaining([
      `${base}/Ana Ruiz/Evidencia Sesión 1/Registro Fotográfico`,
      `${base}/Ana Ruiz/Evidencia Sesión 2/Registro Fotográfico`,
      `${base}/Pedro Díaz/Evidencia Sesión 2/Material Utilizado`
    ]));
    const fotos = p.archivos.filter((a) => a.ruta.endsWith('grupo.jpg'));
    expect(fotos.map((a) => a.ruta).sort()).toEqual([
      `${base}/Ana Ruiz/Evidencia Sesión 1/Registro Fotográfico/grupo.jpg`,
      `${base}/Laura Gómez/Evidencia Sesión 1/Registro Fotográfico/grupo.jpg`,
      `${base}/Pedro Díaz/Evidencia Sesión 2/Registro Fotográfico/grupo.jpg`
    ]);
    expect(new Set(fotos.map((a) => a.url)).size).toBe(1);

    const hoja = (ruta: string) => p.hojas.find((h) => h.ruta === ruta)!.filas;
    const asisPedro = hoja(`${base}/Pedro Díaz/Evidencia Sesión 2/Asistencia Sesión 2.xlsx`);
    expect(asisPedro.slice(1).map((f) => f[1])).toEqual(['Est Uno', 'Est Dos']);
    // La sesión propia de Pedro conserva su asistencia
    expect(hoja(`${base}/Pedro Díaz/Evidencia Sesión 1/Asistencia Sesión 1.xlsx`).slice(1).map((f) => f[1])).toEqual(['De Pedro']);
    // La hoja de asistencia de Ana para la sesión 1 ahora es la de la sesión grupal
    expect(hoja(`${base}/Ana Ruiz/Evidencia Sesión 1/Asistencia Sesión 1.xlsx`).slice(1).map((f) => f[1])).toEqual(['Est Uno', 'Est Dos']);

    const filaDe = (nombre: string) => hoja(`${base}/${nombre}/Bitácora.xlsx`)[1];
    expect(filaDe('Laura Gómez').slice(0, 3)).toEqual([1, 'Grupal', 'Ana Ruiz, Pedro Díaz']);
    expect(filaDe('Ana Ruiz').slice(0, 3)).toEqual([1, 'Grupal', 'Laura Gómez (registró), Pedro Díaz']);
    expect(filaDe('Pedro Díaz').slice(0, 3)).toEqual([2, 'Grupal', 'Laura Gómez (registró), Ana Ruiz']);
    expect(filaDe('Pedro Díaz')[13]).toBe(2); // asistentes registrados
    expect(filaDe('Pedro Díaz')[14]).toBe('Evidencia Sesión 2');

    // La copia temporal se borra solo cuando todos los destinos ya están en Drive
    const sinCopias = { ...p.confirmacion, copias: [] };
    await S.confirmarSync(ctx, sinCopias);
    expect([...almacen.archivos.keys()].some((k) => k.includes('/foto/'))).toBe(true);
    await S.confirmarSync(ctx, p.confirmacion);
    expect([...almacen.archivos.keys()].some((k) => k.includes('/foto/'))).toBe(false);
    expect(await S.estadoSync(ctx.db)).toMatchObject({ archivosPendientes: 0, hojasPendientes: 0 });
  });

  test('si se elimina un compañero, desaparece de los participantes de los demás', async () => {
    const { laura, ana, pedro } = await escenario();
    await S.enviarBitacora(ctx, laura, { ...bitacora, modalidad: 'Grupal', companeros: [ana, pedro] });
    await S.eliminarResidente(ctx, 'ana@correo.com');
    const p = await S.pendientesSync(ctx.db);
    const fila = p.hojas.find((h) => h.ruta.endsWith('Laura Gómez/Bitácora.xlsx'))!.filas[1];
    expect(fila.slice(1, 3)).toEqual(['Grupal', 'Pedro Díaz']);
  });
});
