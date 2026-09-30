/** Arma el contexto (base de datos + almacén de archivos) para cada petición del servidor. */
import { almacenBlob, AlmacenLocal, type Almacen } from './almacen';
import { obtenerDb } from './db';
import type { Ctx } from './servicio';

const global = globalThis as unknown as { __almacenLocal?: AlmacenLocal };

/** Vista previa local sin Vercel Blob (nunca en producción). */
export const usaAlmacenLocal = () => process.env.ALMACEN_LOCAL === '1' && process.env.NODE_ENV !== 'production';

export function almacenLocal() {
  global.__almacenLocal ??= new AlmacenLocal();
  return global.__almacenLocal;
}

export function almacen(): Almacen {
  return usaAlmacenLocal() ? almacenLocal() : almacenBlob;
}

/** URL pública de la app: APP_URL si está definida; si no, el origen de la petición. */
export function urlApp(req?: Request) {
  const env = process.env.APP_URL?.replace(/\/+$/, '');
  if (env) return env;
  if (req) return new URL(req.url).origin;
  return 'http://localhost:3000';
}

export async function contexto(req?: Request): Promise<Ctx> {
  return { db: await obtenerDb(), almacen: almacen(), appUrl: urlApp(req) };
}
