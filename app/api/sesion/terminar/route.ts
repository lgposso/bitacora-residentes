import { after } from 'next/server';
import { manejar, residenteActual } from '@/lib/api';
import { contexto } from '@/lib/contexto';
import { dispararSyncSinFallar } from '@/lib/github';
import { terminarSesion } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  const r = await terminarSesion(await contexto(req), await residenteActual());
  // Al cerrar la sesión, sus evidencias se llevan a Drive de inmediato (sin esperar la sincronización periódica).
  after(dispararSyncSinFallar);
  return r;
});
