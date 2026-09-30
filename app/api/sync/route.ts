/** Usado por sync/sincronizar.py (GitHub Actions) para llevar las evidencias a Google Drive. */
import { cuerpo, exigirSincronizador, manejar } from '@/lib/api';
import { almacen, contexto } from '@/lib/contexto';
import { obtenerDb } from '@/lib/db';
import { confirmarSync, pendientesSync, type Confirmacion } from '@/lib/servicio';

export const GET = manejar(async (req) => {
  exigirSincronizador(req);
  const p = await pendientesSync(await obtenerDb());
  const urls = await almacen().urlsDescarga(p.archivos.map((a) => a.url));
  return { ...p, archivos: p.archivos.map((a, i) => ({ ...a, url: urls[i] })) };
});

export const POST = manejar(async (req) => {
  exigirSincronizador(req);
  return confirmarSync(await contexto(req), await cuerpo<Partial<Confirmacion>>(req));
});
