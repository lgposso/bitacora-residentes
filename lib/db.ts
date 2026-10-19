/**
 * Acceso a Postgres con SQL parametrizado.
 * - Producción (Vercel): Neon, vía DATABASE_URL.
 * - Local sin DATABASE_URL y pruebas: PGlite (Postgres embebido).
 * Las tablas se crean solas la primera vez (CREATE TABLE IF NOT EXISTS).
 */
import { neon } from '@neondatabase/serverless';

export interface Db {
  query<T = Record<string, unknown>>(texto: string, params?: unknown[]): Promise<T[]>;
}

export const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS ajustes (
    clave text PRIMARY KEY,
    valor text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS residentes (
    id serial PRIMARY KEY,
    usuario text UNIQUE NOT NULL, -- correo electrónico del residente
    nombre text NOT NULL,
    programa text NOT NULL,
    carpeta text NOT NULL,
    clave_hash text NOT NULL,
    plan_subido boolean NOT NULL DEFAULT false,
    carpeta_sync boolean NOT NULL DEFAULT false,
    bitacora_version int NOT NULL DEFAULT 0,
    bitacora_sync int NOT NULL DEFAULT 0,
    creado timestamptz NOT NULL DEFAULT now(),
    UNIQUE (programa, carpeta)
  )`,
  `CREATE TABLE IF NOT EXISTS sesiones (
    id serial PRIMARY KEY,
    residente_id int NOT NULL REFERENCES residentes(id),
    numero int NOT NULL,
    token text UNIQUE NOT NULL,
    estado text NOT NULL DEFAULT 'qr',
    fecha text,
    hora_inicio text,
    hora_final text,
    duracion_min int,
    escenario text,
    poblacion text,
    participantes int,
    tema text,
    estrategias text[],
    evaluaciones text[],
    carpetas_sync boolean NOT NULL DEFAULT false,
    asistencia_version int NOT NULL DEFAULT 1,
    asistencia_sync int NOT NULL DEFAULT 0,
    abierta_en timestamptz NOT NULL DEFAULT now(),
    bitacora_en timestamptz,
    cerrada_en timestamptz,
    UNIQUE (residente_id, numero)
  )`,
  // Un residente solo puede tener una sesión abierta a la vez.
  `CREATE UNIQUE INDEX IF NOT EXISTS sesiones_una_abierta ON sesiones (residente_id) WHERE estado <> 'cerrada'`,
  `CREATE TABLE IF NOT EXISTS asistencias (
    id serial PRIMARY KEY,
    sesion_id int NOT NULL REFERENCES sesiones(id),
    nombre text NOT NULL,
    correo text NOT NULL,
    semestre text NOT NULL,
    creado timestamptz NOT NULL DEFAULT now(),
    actualizado timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sesion_id, correo)
  )`,
  // Agregada después de publicar: las bases existentes reciben la columna (registros previos quedan vacíos).
  `ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS universidad text NOT NULL DEFAULT ''`,
  // ruta = destino en Google Drive. blob_url = copia temporal hasta sincronizar.
  `CREATE TABLE IF NOT EXISTS archivos (
    id serial PRIMARY KEY,
    residente_id int NOT NULL REFERENCES residentes(id),
    sesion_id int REFERENCES sesiones(id),
    tipo text NOT NULL,
    nombre text NOT NULL,
    ruta text UNIQUE NOT NULL,
    blob_url text UNIQUE NOT NULL,
    bytes bigint NOT NULL,
    creado timestamptz NOT NULL DEFAULT now(),
    sincronizado_en timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS intentos (
    clave text PRIMARY KEY,
    n int NOT NULL,
    desde timestamptz NOT NULL
  )`
];

export async function asegurarEsquema(db: Db) {
  for (const sentencia of ESQUEMA) await db.query(sentencia);
}

export function dbNeon(url: string): Db {
  const sql = neon(url);
  return {
    query: async <T,>(texto: string, params: unknown[] = []) => (await sql.query(texto, params)) as T[]
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbPglite(pg: any): Db {
  return {
    query: async <T,>(texto: string, params: unknown[] = []) => (await pg.query(texto, params)).rows as T[]
  };
}

const global = globalThis as unknown as { __bitacoraDb?: Promise<Db> };

/** Conexión única por proceso, con el esquema ya creado. */
export function obtenerDb(): Promise<Db> {
  if (!global.__bitacoraDb) {
    global.__bitacoraDb = (async () => {
      let db: Db;
      if (process.env.DATABASE_URL) {
        db = dbNeon(process.env.DATABASE_URL);
      } else {
        if (process.env.NODE_ENV === 'production') throw new Error('Falta la variable DATABASE_URL.');
        const { PGlite } = await import('@electric-sql/pglite');
        // Con el almacén en memoria, la base también va en memoria para que no queden desfasados.
        db = dbPglite(process.env.ALMACEN_LOCAL === '1' ? new PGlite() : new PGlite('./.pglite'));
      }
      await asegurarEsquema(db);
      return db;
    })();
    global.__bitacoraDb.catch(() => { global.__bitacoraDb = undefined; });
  }
  return global.__bitacoraDb;
}
