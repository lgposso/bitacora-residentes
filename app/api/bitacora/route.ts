import { cuerpo, manejar, residenteActual } from '@/lib/api';
import { contexto } from '@/lib/contexto';
import { enviarBitacora } from '@/lib/servicio';

export const POST = manejar(async (req) => enviarBitacora(await contexto(req), await residenteActual(), await cuerpo(req)));
