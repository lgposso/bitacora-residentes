/** Emite el permiso para que el navegador suba el archivo directo a Vercel Blob. */
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { cuerpo, manejar, residenteActual } from '@/lib/api';
import { obtenerDb } from '@/lib/db';
import { autorizarSubida, type TipoSubida } from '@/lib/servicio';

export const POST = manejar(async (req) => {
  const body = await cuerpo<HandleUploadBody>(req);
  if (body.type !== 'blob.generate-client-token') return { ok: true };
  const id = await residenteActual();
  const db = await obtenerDb();
  return handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname, clientPayload) =>
      autorizarSubida(db, id, String(clientPayload ?? '') as TipoSubida, pathname)
  });
});
