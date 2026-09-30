'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '@/lib/cliente';

/** QR de asistencia de la sesión, con contador en vivo de estudiantes registrados. */
export function QrSesion(props: { numero: number; url: string; asistentes: number; onContinuar: () => void }) {
  const [imagen, setImagen] = useState('');
  const [asistentes, setAsistentes] = useState(props.asistentes);
  const [grande, setGrande] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [verEnlace, setVerEnlace] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(props.url, { width: 800, margin: 2, errorCorrectionLevel: 'M' }).then(setImagen);
  }, [props.url]);

  useEffect(() => {
    const t = setInterval(() => {
      api<{ asistentes: number }>('/api/asistentes').then((r) => setAsistentes(r.asistentes)).catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(props.url);
    } catch {
      setVerEnlace(true); // sin acceso al portapapeles: se muestra el enlace para copiarlo a mano
      return;
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  return (
    <section>
      <div className="card">
        <p className="muted small" style={{ margin: 0 }}>Sesión</p>
        <div className="big-num">{props.numero}</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Pida a los estudiantes que escaneen este código para registrar su asistencia.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en el navegador (data URL) */}
        <div className="qr-box">{imagen && <img src={imagen} alt={`Código QR de asistencia, sesión ${props.numero}`} />}</div>
        <p style={{ textAlign: 'center' }}>
          <strong>{asistentes}</strong> estudiante{asistentes === 1 ? '' : 's'} registrado{asistentes === 1 ? '' : 's'}
        </p>
        <div className="actions center">
          <button type="button" className="secondary" onClick={() => setGrande(true)}>Pantalla completa</button>
          <a className="btn secondary" href={imagen} download={`QR Sesión ${props.numero}.png`}>Descargar QR</a>
          <button type="button" className="secondary" onClick={copiar}>{copiado ? '¡Copiado!' : 'Copiar enlace'}</button>
        </div>
        {verEnlace && (
          <input type="text" readOnly value={props.url} autoFocus onFocus={(e) => e.currentTarget.select()} style={{ marginTop: 12 }} />
        )}
      </div>
      <div className="actions end">
        <button type="button" onClick={props.onContinuar}>Continuar a la bitácora →</button>
      </div>

      {grande && (
        <div className="overlay" role="dialog" aria-modal="true">
          <h1>Sesión {props.numero} · Registro de asistencia</h1>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en el navegador (data URL) */}
          <div className="qr-box"><img src={imagen} alt="Código QR de asistencia" /></div>
          <button type="button" onClick={() => setGrande(false)}>Cerrar</button>
        </div>
      )}
    </section>
  );
}
