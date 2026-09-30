/** "Sincronizar ahora" del panel: lanza el workflow de GitHub y consulta cómo va. */
import { exigirAdmin, manejar } from '@/lib/api';
import { dispararSync, ultimaCorrida } from '@/lib/github';

export const GET = manejar(async () => {
  await exigirAdmin();
  return ultimaCorrida();
});

export const POST = manejar(async () => {
  await exigirAdmin();
  return dispararSync();
});
