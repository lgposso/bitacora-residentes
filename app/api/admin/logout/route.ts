import { manejar } from '@/lib/api';
import { cerrarSesion } from '@/lib/auth';

export const POST = manejar(async () => {
  await cerrarSesion('admin');
});
