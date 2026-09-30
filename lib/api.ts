/** Utilidades para las rutas /api: respuestas JSON y errores legibles. */
import { leerSesion } from './auth';
import { secretoIgual } from './servicio';
import { ErrorUsuario } from './validaciones';

export function manejar(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      const resultado = await fn(req);
      return Response.json(resultado ?? { ok: true });
    } catch (e) {
      if (e instanceof ErrorUsuario) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: 'Ocurrió un error inesperado. Intente de nuevo en unos segundos.' }, { status: 500 });
    }
  };
}

export async function cuerpo<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ErrorUsuario('Solicitud inválida.');
  }
}

export async function residenteActual() {
  const sub = await leerSesion('residente');
  if (!sub) throw new ErrorUsuario('SESION_EXPIRADA', 401);
  return Number(sub);
}

export async function exigirAdmin() {
  if (!(await leerSesion('admin'))) throw new ErrorUsuario('SESION_EXPIRADA', 401);
}

/** El sincronizador se identifica con "Authorization: Bearer <SYNC_TOKEN>". */
export function exigirSincronizador(req: Request) {
  const real = process.env.SYNC_TOKEN;
  if (!real || real.length < 20) throw new ErrorUsuario('SYNC_TOKEN no está configurado en el servidor.', 503);
  const dado = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!secretoIgual(dado, real)) throw new ErrorUsuario('No autorizado.', 401);
}
