import { exigirAdmin, manejar } from '@/lib/api';
import { obtenerDb } from '@/lib/db';
import { dispararSyncSinFallar } from '@/lib/github';
import { reenviarTodo } from '@/lib/servicio';

export const POST = manejar(async () => {
  await exigirAdmin();
  await reenviarTodo(await obtenerDb());
  await dispararSyncSinFallar();
});
