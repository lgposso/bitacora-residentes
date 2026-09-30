import { cuerpo, manejar } from '@/lib/api';
import { iniciarSesion } from '@/lib/auth';
import { obtenerDb } from '@/lib/db';
import { verificarClaveAdmin } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  const { clave } = await cuerpo<{ clave: string }>(req);
  await verificarClaveAdmin(await obtenerDb(), clave);
  await iniciarSesion('admin', 'admin');
});
