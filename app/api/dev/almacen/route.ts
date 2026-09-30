/** Solo local (ALMACEN_LOCAL=1): recibe y entrega archivos en lugar de Vercel Blob. */
import { AlmacenLocal } from '@/lib/almacen';
import { almacenLocal, usaAlmacenLocal } from '@/lib/contexto';

export async function PUT(req: Request) {
  if (!usaAlmacenLocal()) return new Response('No disponible', { status: 404 });
  const pathname = AlmacenLocal.pathnameDe(req.url);
  almacenLocal().guardar(pathname, new Uint8Array(await req.arrayBuffer()), req.headers.get('content-type') ?? 'application/octet-stream');
  return Response.json({ url: `${new URL(req.url).origin}/api/dev/almacen?p=${encodeURIComponent(pathname)}` });
}

export async function GET(req: Request) {
  if (!usaAlmacenLocal()) return new Response('No disponible', { status: 404 });
  const a = almacenLocal().archivos.get(AlmacenLocal.pathnameDe(req.url));
  if (!a) return new Response('No existe', { status: 404 });
  return new Response(a.datos as BodyInit, { headers: { 'Content-Type': a.mime } });
}
