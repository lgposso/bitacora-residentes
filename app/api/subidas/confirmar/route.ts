import { cuerpo, manejar, residenteActual } from '@/lib/api';
import { contexto } from '@/lib/contexto';
import { confirmarSubida, type TipoSubida } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  const id = await residenteActual();
  return confirmarSubida(await contexto(req), id, await cuerpo<{ tipo: TipoSubida; url: string; nombre: string }>(req));
});
