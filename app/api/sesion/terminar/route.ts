import { manejar, residenteActual } from '@/lib/api';
import { contexto } from '@/lib/contexto';
import { terminarSesion } from '@/lib/servicio';

export const POST = manejar(async (req) => terminarSesion(await contexto(req), await residenteActual()));
