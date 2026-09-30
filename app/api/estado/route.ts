import { manejar, residenteActual } from '@/lib/api';
import { contexto } from '@/lib/contexto';
import { obtenerEstado } from '@/lib/servicio';

export const GET = manejar(async (req) => obtenerEstado(await contexto(req), await residenteActual()));
