import { cuerpo, manejar } from '@/lib/api';
import { iniciarSesion } from '@/lib/auth';
import { contexto } from '@/lib/contexto';
import { autenticarResidente, obtenerEstado } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  const { usuario, clave } = await cuerpo<{ usuario: string; clave: string }>(req);
  const ctx = await contexto(req);
  const id = await autenticarResidente(ctx.db, usuario, clave);
  await iniciarSesion('residente', String(id));
  return { estado: await obtenerEstado(ctx, id) };
});
