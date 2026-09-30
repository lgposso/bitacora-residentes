import { cuerpo, exigirAdmin, manejar } from '@/lib/api';
import { contexto, urlApp } from '@/lib/contexto';
import { obtenerDb } from '@/lib/db';
import { crearResidente, estadoSync, listarResidentes } from '@/lib/servicio';

async function panel(req: Request) {
  const db = await obtenerDb();
  return { residentes: await listarResidentes(db), sync: await estadoSync(db), urlApp: urlApp(req) };
}

export const GET = manejar(async (req) => {
  await exigirAdmin();
  return panel(req);
});

export const POST = manejar(async (req) => {
  await exigirAdmin();
  await crearResidente(await contexto(req), await cuerpo(req));
  return panel(req);
});
