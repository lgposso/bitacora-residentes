import { cuerpo, exigirAdmin, manejar } from '@/lib/api';
import { obtenerDb } from '@/lib/db';
import { restablecerClave } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  await exigirAdmin();
  const { usuario, clave } = await cuerpo<{ usuario: string; clave: string }>(req);
  await restablecerClave(await obtenerDb(), usuario, clave);
});
