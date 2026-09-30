import { manejar, residenteActual } from '@/lib/api';
import { contexto } from '@/lib/contexto';
import { terminarFotos } from '@/lib/servicio';

export const POST = manejar(async (req) => terminarFotos(await contexto(req), await residenteActual()));
