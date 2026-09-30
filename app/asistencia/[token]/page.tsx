import type { Metadata } from 'next';
import { obtenerDb } from '@/lib/db';
import { infoAsistencia } from '@/lib/servicio';
import { FormAsistencia } from '../../_componentes/FormAsistencia';

export const metadata: Metadata = { title: 'Registro de asistencia' };

export default async function Asistencia(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const info = await infoAsistencia(await obtenerDb(), token);

  return (
    <main className="wrap">
      {!info ? (
        <div className="card">
          <h1>Enlace no válido</h1>
          <p className="muted">Este código de asistencia no existe. Pida al residente que le muestre el código QR de nuevo.</p>
        </div>
      ) : !info.abierta ? (
        <div className="card">
          <h1>Sesión cerrada</h1>
          <p className="muted">
            La sesión {info.numero} de {info.residente} ya fue cerrada y no recibe más registros de asistencia.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <p className="muted small" style={{ margin: 0 }}>{info.programa}</p>
            <h1>Registro de asistencia</h1>
            <p className="muted" style={{ margin: 0 }}>Sesión {info.numero} · Residente: {info.residente}</p>
          </div>
          <FormAsistencia token={token} />
        </>
      )}
    </main>
  );
}
