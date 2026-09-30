import { manejar, residenteActual } from '@/lib/api';
import { obtenerDb } from '@/lib/db';
import { contarAsistentes } from '@/lib/servicio';

export const GET = manejar(async () => ({ asistentes: await contarAsistentes(await obtenerDb(), await residenteActual()) }));
