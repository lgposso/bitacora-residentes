import { manejar, residenteActual } from '@/lib/api';
import { obtenerDb } from '@/lib/db';
import { listarCompaneros } from '@/lib/servicio';

/** Residentes del mismo programa, para marcar quiénes participaron en una sesión grupal. */
export const GET = manejar(async () => ({ companeros: await listarCompaneros(await obtenerDb(), await residenteActual()) }));
