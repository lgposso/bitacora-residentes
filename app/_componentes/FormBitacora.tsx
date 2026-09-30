'use client';

import { useEffect, useState } from 'react';
import { ESCENARIOS, ESTRATEGIAS, EVALUACIONES, POBLACIONES } from '@/lib/config';
import { guardarLocal, leerLocal } from '@/lib/cliente';
import { calcularDuracion, validarBitacora } from '@/lib/validaciones';

export interface Bitacora {
  fecha: string;
  horaInicio: string;
  horaFinal: string;
  escenario: string;
  escenarioOtro: string;
  poblacion: string;
  participantes: string;
  tema: string;
  estrategias: string[];
  evaluaciones: string[];
}

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const vacia = (): Bitacora => ({
  fecha: hoy(), horaInicio: '', horaFinal: '', escenario: '', escenarioOtro: '', poblacion: '',
  participantes: '', tema: '', estrategias: [], evaluaciones: []
});

/** Formulario de la bitácora (11 campos). Guarda un borrador local por si se cierra la página. */
export function FormBitacora(props: {
  numero: number;
  claveBorrador: string;
  enviando: boolean;
  onEnviar: (datos: Bitacora) => void;
  onVolver: () => void;
  onError: (msg: string) => void;
}) {
  const [d, setD] = useState<Bitacora>(vacia);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    try {
      const b = JSON.parse(leerLocal(props.claveBorrador) ?? 'null');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- el borrador solo existe en el navegador
      if (b) setD({ ...vacia(), ...b });
    } catch { /* borrador dañado: se ignora */ }
    setListo(true);
  }, [props.claveBorrador]);

  useEffect(() => {
    if (listo) guardarLocal(props.claveBorrador, JSON.stringify(d));
  }, [d, listo, props.claveBorrador]);

  const cambiar = <K extends keyof Bitacora>(k: K, v: Bitacora[K]) => setD((x) => ({ ...x, [k]: v }));
  const alternar = (k: 'estrategias' | 'evaluaciones', v: string) =>
    setD((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  let duracion = '';
  if (d.horaInicio && d.horaFinal) {
    try { duracion = calcularDuracion(d.horaInicio, d.horaFinal).texto; } catch { duracion = 'Hora final inválida'; }
  }

  function enviar() {
    const { errores } = validarBitacora(d);
    if (errores.length) return props.onError(errores.join('\n'));
    props.onEnviar(d);
  }

  const unica = (nombre: 'escenario' | 'poblacion', opciones: readonly string[]) => (
    <div className="choices">
      {opciones.map((op) => (
        <label key={op}>
          <input type="radio" name={nombre} value={op} checked={d[nombre] === op} onChange={() => cambiar(nombre, op)} />
          {op}
        </label>
      ))}
    </div>
  );

  const multiple = (nombre: 'estrategias' | 'evaluaciones', opciones: readonly string[]) => (
    <div className="choices">
      {opciones.map((op) => (
        <label key={op}>
          <input type="checkbox" value={op} checked={d[nombre].includes(op)} onChange={() => alternar(nombre, op)} />
          {op}
        </label>
      ))}
    </div>
  );

  return (
    <section>
      <form className="card" noValidate onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <h2>Bitácora · Sesión {props.numero}</h2>
        <div className="row">
          <label className="field"><span>1. # de sesión</span><input type="text" value={props.numero} readOnly /></label>
          <label className="field"><span>2. Fecha</span>
            <input type="date" value={d.fecha} onChange={(e) => cambiar('fecha', e.target.value)} required /></label>
        </div>
        <div className="row">
          <label className="field"><span>3. Hora inicio</span>
            <input type="time" value={d.horaInicio} onChange={(e) => cambiar('horaInicio', e.target.value)} required /></label>
          <label className="field"><span>4. Hora final</span>
            <input type="time" value={d.horaFinal} onChange={(e) => cambiar('horaFinal', e.target.value)} required /></label>
          <label className="field"><span>5. Duración</span>
            <input type="text" value={duracion} readOnly placeholder="Se calcula sola" /></label>
        </div>
        <fieldset>
          <legend>6. Escenario de aprendizaje</legend>
          {unica('escenario', ESCENARIOS)}
          {d.escenario === 'Otro' && (
            <label className="field" style={{ marginTop: 10 }}><span>¿Cuál?</span>
              <input type="text" value={d.escenarioOtro} onChange={(e) => cambiar('escenarioOtro', e.target.value)} autoFocus /></label>
          )}
        </fieldset>
        <fieldset><legend>7. Población participante</legend>{unica('poblacion', POBLACIONES)}</fieldset>
        <label className="field"><span>8. Número de participantes</span>
          <input type="number" min={1} step={1} inputMode="numeric" value={d.participantes}
            onChange={(e) => cambiar('participantes', e.target.value)} required /></label>
        <label className="field"><span>9. Tema desarrollado</span>
          <textarea rows={2} value={d.tema} onChange={(e) => cambiar('tema', e.target.value)} required /></label>
        <fieldset>
          <legend>10. Estrategia pedagógica <span className="muted small">(puede elegir varias)</span></legend>
          {multiple('estrategias', ESTRATEGIAS)}
        </fieldset>
        <fieldset>
          <legend>11. Evaluación <span className="muted small">(puede elegir varias)</span></legend>
          {multiple('evaluaciones', EVALUACIONES)}
        </fieldset>
      </form>
      <div className="actions between">
        <button type="button" className="secondary" onClick={props.onVolver}>← Volver al QR</button>
        <button type="button" onClick={enviar} disabled={props.enviando}>
          {props.enviando ? <><span className="spinner" /> Enviando…</> : 'Enviar bitácora'}
        </button>
      </div>
    </section>
  );
}
