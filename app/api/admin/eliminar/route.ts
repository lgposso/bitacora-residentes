import { cuerpo, exigirAdmin, manejar } from '@/lib/api';
import { contexto } from '@/lib/contexto';
import { eliminarResidente } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  await exigirAdmin();
  const { usuario } = await cuerpo<{ usuario: string }>(req);
  return eliminarResidente(await contexto(req), usuario);
});
