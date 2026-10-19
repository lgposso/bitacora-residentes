/**
 * Validaciones y cálculos puros (sin base de datos ni Google). Compartidos por servidor y navegador.
 */
import { ESCENARIOS, ESTRATEGIAS, EVALUACIONES, PLAN_EXTENSIONES, POBLACIONES, SEMESTRES } from './config';

/** Error con mensaje apto para mostrar al usuario. */
export class ErrorUsuario extends Error {
  constructor(mensaje: string, public status = 400) {
    super(mensaje);
  }
}

/** 'HH:MM' → minutos desde medianoche, o null si no es válida. */
export function parseHora(hora: unknown): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hora ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 90 → '1 h 30 min' */
export function formatDuracion(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export function calcularDuracion(inicio: string, fin: string) {
  const a = parseHora(inicio);
  const b = parseHora(fin);
  if (a === null || b === null) throw new ErrorUsuario('Hora inválida.');
  if (b <= a) throw new ErrorUsuario('La hora final debe ser posterior a la hora de inicio.');
  return { minutos: b - a, texto: formatDuracion(b - a) };
}

/** 'yyyy-mm-dd' si es una fecha real, o null. */
export function parseFecha(fecha: unknown): string | null {
  const s = String(fecha ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

const texto = (v: unknown) => String(v ?? '').trim();
const lista = (v: unknown) => (Array.isArray(v) ? v.map(texto).filter(Boolean) : []);
const enLista = (opciones: readonly string[], v: string) => opciones.includes(v);

export interface DatosBitacora {
  fecha: string;
  horaInicio: string;
  horaFinal: string;
  duracionMinutos: number;
  escenario: string;
  poblacion: string;
  participantes: number;
  tema: string;
  estrategias: string[];
  evaluaciones: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validarBitacora(input: any): { errores: string[]; datos: DatosBitacora } {
  const i = input ?? {};
  const errores: string[] = [];

  const fecha = parseFecha(i.fecha);
  if (!fecha) errores.push('La fecha no es válida.');

  const horaInicio = texto(i.horaInicio);
  const horaFinal = texto(i.horaFinal);
  let duracionMinutos = 0;
  try {
    duracionMinutos = calcularDuracion(horaInicio, horaFinal).minutos;
  } catch (e) {
    errores.push((e as Error).message);
  }

  let escenario = texto(i.escenario);
  if (!enLista(ESCENARIOS, escenario)) {
    errores.push('Seleccione el escenario de aprendizaje.');
  } else if (escenario === 'Otro') {
    const cual = texto(i.escenarioOtro);
    if (!cual) errores.push('Indique cuál es el otro escenario de aprendizaje.');
    escenario = `Otro: ${cual}`;
  }

  const poblacion = texto(i.poblacion);
  if (!enLista(POBLACIONES, poblacion)) errores.push('Seleccione la población participante.');

  const participantes = Number(texto(i.participantes));
  if (!Number.isInteger(participantes) || participantes < 1) {
    errores.push('El número de participantes debe ser un entero mayor que 0.');
  }

  const tema = texto(i.tema);
  if (!tema) errores.push('Escriba el tema desarrollado.');

  const estrategias = lista(i.estrategias);
  if (!estrategias.length || estrategias.some((x) => !enLista(ESTRATEGIAS, x))) {
    errores.push('Seleccione al menos una estrategia pedagógica válida.');
  }

  const evaluaciones = lista(i.evaluaciones);
  if (!evaluaciones.length || evaluaciones.some((x) => !enLista(EVALUACIONES, x))) {
    errores.push('Seleccione al menos un tipo de evaluación válido.');
  }

  return {
    errores,
    datos: { fecha: fecha ?? '', horaInicio, horaFinal, duracionMinutos, escenario, poblacion, participantes, tema, estrategias, evaluaciones }
  };
}

export function esCorreo(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validarAsistencia(input: any) {
  const i = input ?? {};
  const errores: string[] = [];
  const datos = {
    nombre: texto(i.nombre).replace(/\s+/g, ' '),
    correo: texto(i.correo).toLowerCase(),
    universidad: texto(i.universidad).replace(/\s+/g, ' '),
    semestre: texto(i.semestre),
    autoriza: i.autoriza === true
  };
  if (datos.nombre.length < 3) errores.push('Escriba sus nombres y apellidos.');
  if (!esCorreo(datos.correo)) errores.push('El correo electrónico no es válido.');
  if (datos.universidad.length < 2) errores.push('Escriba su universidad.');
  if (!enLista(SEMESTRES, datos.semestre)) errores.push('Seleccione su semestre.');
  if (!datos.autoriza) errores.push('Debe autorizar el tratamiento de sus datos para registrar la asistencia.');
  return { errores, datos };
}

export function extensionDe(nombre: string) {
  const m = /\.([A-Za-z0-9]+)$/.exec(nombre || '');
  return m ? m[1].toLowerCase() : '';
}

/** Devuelve la extensión si el plan de clase tiene un formato permitido; si no, lanza error. */
export function validarPlan(nombre: string) {
  const ext = extensionDe(nombre);
  if (!enLista(PLAN_EXTENSIONES, ext)) {
    throw new ErrorUsuario('Formato no permitido. Suba un archivo .doc, .docx, .xls, .xlsx o .pdf.');
  }
  return ext;
}

/** Correo electrónico con el que ingresa el residente (en minúsculas, sin espacios). */
export function normalizarCorreo(correo: unknown) {
  const c = texto(correo).toLowerCase();
  if (c.length > 254 || !esCorreo(c)) throw new ErrorUsuario('Escriba un correo electrónico válido.');
  return c;
}

/** Número de documento usado como contraseña del residente: sin puntos, espacios ni guiones. */
export function normalizarDocumento(documento: unknown) {
  const d = String(documento ?? '').replace(/[\s.-]/g, '');
  if (!/^\d{5,15}$/.test(d)) {
    throw new ErrorUsuario('El número de documento debe tener entre 5 y 15 dígitos (solo números, sin letras).');
  }
  return d;
}

/** Nombre apto para carpetas y archivos de Drive. */
export function nombreSeguro(nombre: unknown) {
  return texto(nombre)
    .replace(/[/\\]/g, '-')
    .replace(/[:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
