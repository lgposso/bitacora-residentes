import { cuerpo, manejar, residenteActual } from '@/lib/api';
import { almacen } from '@/lib/contexto';
import { obtenerDb } from '@/lib/db';
import { prepararSubida, type TipoSubida } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  const id = await residenteActual();
  const datos = await cuerpo<{ tipo: TipoSubida; nombre: string; mime: string; bytes: number }>(req);
  const { pathname } = await prepararSubida(await obtenerDb(), id, datos);
  return { pathname, modo: almacen().modo };
});
