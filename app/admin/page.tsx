import type { Metadata } from 'next';
import { AdminApp } from '../_componentes/AdminApp';

export const metadata: Metadata = { title: 'Administración · Bitácora' };

export default function Admin() {
  return <AdminApp />;
}
