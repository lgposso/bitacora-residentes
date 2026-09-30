import { cuerpo, manejar } from '@/lib/api';
import { contexto } from '@/lib/contexto';
import { registrarAsistencia } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  const { token, ...datos } = await cuerpo<{ token: string }>(req);
  return registrarAsistencia(await contexto(req), token, datos);
});
