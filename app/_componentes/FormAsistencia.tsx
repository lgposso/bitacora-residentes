'use client';

import { useState } from 'react';
import { SEMESTRES } from '@/lib/config';
import { api } from '@/lib/cliente';
import { validarAsistencia } from '@/lib/validaciones';

/** Formulario público que llenan los estudiantes al escanear el QR. */
export function FormAsistencia({ token }: { token: string }) {
  const [alerta, setAlerta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState('');

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const datos = {
      nombre: String(f.get('nombre') ?? ''),
      correo: String(f.get('correo') ?? ''),
      universidad: String(f.get('universidad') ?? ''),
      semestre: String(f.get('semestre') ?? ''),
      autoriza: f.get('autoriza') === 'on'
    };
    const { errores } = validarAsistencia(datos);
    if (errores.length) return setAlerta(errores.join('\n'));
    setEnviando(true);
    setAlerta('');
    try {
      const r = await api<{ actualizado: boolean }>('/api/asistencia', { token, ...datos });
      setListo(r.actualizado ? 'Su registro ya existía y fue actualizado. ¡Gracias!' : 'Asistencia registrada. ¡Gracias!');
    } catch (err) {
      setAlerta((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className="card">
        <div className="alert ok">{listo}</div>
        <p className="muted" style={{ margin: 0 }}>Ya puede cerrar esta página.</p>
      </div>
    );
  }

  return (
    <>
      {alerta && <div className="alert error" role="alert">{alerta}</div>}
      <form className="card" noValidate onSubmit={enviar}>
        <label className="field"><span>1. Nombres y apellidos</span>
          <input type="text" name="nombre" autoComplete="name" required /></label>
        <label className="field"><span>2. Correo electrónico</span>
          <input type="email" name="correo" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" required /></label>
        <label className="field"><span>3. Universidad</span>
          <input type="text" name="universidad" autoComplete="organization" required /></label>
        <fieldset>
          <legend>4. Semestre</legend>
          <div className="choices">
            {SEMESTRES.map((s) => (
              <label key={s}><input type="radio" name="semestre" value={s} />{s}</label>
            ))}
          </div>
        </fieldset>
        <div className="choices" style={{ marginBottom: 16 }}>
          <label className="bloque">
            <input type="checkbox" name="autoriza" />
            <span className="small">
              Autorizo el tratamiento de mis datos personales (nombre, correo, universidad y semestre) con el fin exclusivo de
              registrar mi asistencia a esta actividad académica, conforme a la Ley 1581 de 2012.
            </span>
          </label>
        </div>
        <div className="actions">
          <button type="submit" disabled={enviando}>
            {enviando ? <><span className="spinner" /> Registrando…</> : 'Registrar asistencia'}
          </button>
        </div>
      </form>
    </>
  );
}
