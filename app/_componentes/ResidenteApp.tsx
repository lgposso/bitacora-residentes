'use client';

import { useCallback, useEffect, useState } from 'react';
import { PLAN_EXTENSIONES } from '@/lib/config';
import { api, ErrorApi, guardarLocal, subirArchivo, tamano } from '@/lib/cliente';
import type { EstadoResidente } from '@/lib/servicio';
import { FormBitacora, type Bitacora } from './FormBitacora';
import { QrSesion } from './QrSesion';
import { Subidor } from './Subidor';

type Vista = 'cargando' | 'login' | 'plan' | 'qr' | 'bitacora' | 'fotos' | 'material' | 'fin';

const vistaDe = (e: EstadoResidente): Vista => (!e.planSubido ? 'plan' : (e.sesion?.estado as Vista) ?? 'qr');

/** Flujo del residente: login → plan de clase → QR → bitácora → fotos → material → fin. */
export function ResidenteApp() {
  const [vista, setVista] = useState<Vista>('cargando');
  const [estado, setEstado] = useState<EstadoResidente | null>(null);
  const [alerta, setAlerta] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [guardados, setGuardados] = useState(0);
  const [sesionCerrada, setSesionCerrada] = useState(0);
  const [confirmarFin, setConfirmarFin] = useState(false);

  const mostrar = useCallback((v: Vista) => {
    setVista(v);
    window.scrollTo(0, 0);
  }, []);

  const aplicar = useCallback((e: EstadoResidente) => {
    setEstado(e);
    setAlerta('');
    setGuardados(e.sesion?.estado === 'fotos' ? e.sesion.fotos : e.sesion?.material ?? 0);
    mostrar(vistaDe(e));
  }, [mostrar]);

  const fallo = useCallback((e: unknown) => {
    if (e instanceof ErrorApi && e.expirada) {
      setEstado(null);
      setAlerta('Su sesión expiró. Ingrese de nuevo.');
      mostrar('login');
      return;
    }
    setAlerta((e as Error).message);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [mostrar]);

  useEffect(() => {
    api<EstadoResidente>('/api/estado').then(aplicar).catch((e) => {
      if (e instanceof ErrorApi && e.status === 401) mostrar('login');
      else fallo(e);
    });
  }, [aplicar, fallo, mostrar]);

  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => { if (subiendo) e.preventDefault(); };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [subiendo]);

  async function accion(fn: () => Promise<void>) {
    setOcupado(true);
    setAlerta('');
    try { await fn(); } catch (e) { fallo(e); } finally { setOcupado(false); }
  }

  const salir = () => accion(async () => {
    await api('/api/logout', {});
    setEstado(null);
    mostrar('login');
  });

  const claveBorrador = estado?.sesion ? `bitacora_borrador_${estado.nombre}_${estado.sesion.numero}` : '';

  // ---------- Pasos ----------
  let pasos: string[] = [];
  let actual = 0;
  if (estado && vista !== 'fin' && vista !== 'login') {
    if (!estado.planSubido) pasos = ['Plan de clase'];
    else {
      pasos = ['QR asistencia', 'Bitácora', 'Fotos', 'Material'];
      actual = { qr: 0, bitacora: 1, fotos: 2, material: 3 }[vista as 'qr'] ?? 0;
    }
  }

  return (
    <>
      {estado && vista !== 'login' && (
        <header className="topbar">
          <div className="who">{estado.nombre}<small>{estado.programa}</small></div>
          <button type="button" onClick={salir}>Salir</button>
        </header>
      )}
      <main className="wrap">
        {pasos.length > 0 && (
          <ol className="steps">
            {pasos.map((p, i) => <li key={p} className={i < actual ? 'done' : i === actual ? 'now' : ''}>{p}</li>)}
          </ol>
        )}
        {alerta && <div className="alert error" role="alert">{alerta}</div>}

        {vista === 'cargando' && <div className="card"><span className="spinner" /> Cargando…</div>}

        {vista === 'login' && (
          <Login ocupado={ocupado} onIngresar={(usuario, clave) => accion(async () => {
            aplicar((await api<{ estado: EstadoResidente }>('/api/login', { usuario, clave })).estado);
          })} />
        )}

        {vista === 'plan' && (
          <PlanClase ocupado={ocupado} onError={setAlerta} onSubir={(archivo, progreso) => accion(async () => {
            aplicar((await subirArchivo<{ estado: EstadoResidente }>('plan', archivo, progreso)).estado);
          })} />
        )}

        {vista === 'qr' && estado?.sesion && (
          <QrSesion
            numero={estado.sesion.numero}
            url={estado.sesion.urlAsistencia}
            asistentes={estado.sesion.asistentes}
            onContinuar={() => { setAlerta(''); mostrar('bitacora'); }}
          />
        )}

        {vista === 'bitacora' && estado?.sesion && (
          <FormBitacora
            numero={estado.sesion.numero}
            claveBorrador={claveBorrador}
            enviando={ocupado}
            onError={(m) => { setAlerta(m); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            onVolver={() => { setAlerta(''); mostrar('qr'); }}
            onEnviar={(datos: Bitacora) => accion(async () => {
              const clave = claveBorrador;
              aplicar(await api<EstadoResidente>('/api/bitacora', datos));
              guardarLocal(clave, null);
            })}
          />
        )}

        {(vista === 'fotos' || vista === 'material') && estado?.sesion && (
          <section key={vista}>
            <div className="card">
              {vista === 'fotos' ? (
                <>
                  <h2>Registro fotográfico · Sesión {estado.sesion.numero}</h2>
                  <p className="muted">Suba las fotos de la sesión. Puede elegir varias a la vez.</p>
                </>
              ) : (
                <>
                  <h2>Material utilizado · Sesión {estado.sesion.numero}</h2>
                  <p className="muted">Suba presentaciones, guías, artículos, rúbricas u otros archivos usados en la sesión.</p>
                </>
              )}
              <Subidor
                tipo={vista === 'fotos' ? 'foto' : 'material'}
                titulo={vista === 'fotos' ? 'Toque para elegir fotos' : 'Toque para elegir archivos'}
                accept={vista === 'fotos' ? 'image/*' : undefined}
                comprimir={vista === 'fotos'}
                guardados={guardados}
                onGuardados={setGuardados}
                onOcupado={setSubiendo}
                onExpirada={() => fallo(new ErrorApi('SESION_EXPIRADA', 401))}
              />
            </div>
            <div className="actions end">
              {vista === 'fotos' ? (
                <button type="button" disabled={ocupado || subiendo || guardados < 1}
                  onClick={() => accion(async () => aplicar(await api<EstadoResidente>('/api/fotos/terminar', {})))}>
                  {ocupado ? <><span className="spinner" /> Guardando…</> : 'Continuar a material utilizado →'}
                </button>
              ) : confirmarFin ? (
                <>
                  <span className="small muted" style={{ alignSelf: 'center' }}>El QR dejará de recibir asistencia.</span>
                  <button type="button" className="secondary" disabled={ocupado} onClick={() => setConfirmarFin(false)}>Cancelar</button>
                  <button type="button" disabled={ocupado}
                    onClick={() => accion(async () => {
                      const r = await api<{ sesionCerrada: number }>('/api/sesion/terminar', {});
                      setConfirmarFin(false);
                      setSesionCerrada(r.sesionCerrada);
                      mostrar('fin');
                    })}>
                    {ocupado ? <><span className="spinner" /> Cerrando sesión…</> : 'Sí, finalizar'}
                  </button>
                </>
              ) : (
                <button type="button" disabled={ocupado || subiendo || guardados < 1} onClick={() => setConfirmarFin(true)}>
                  Finalizar sesión
                </button>
              )}
            </div>
          </section>
        )}

        {vista === 'fin' && (
          <section className="card">
            <div className="alert ok">Sesión <strong>{sesionCerrada}</strong> registrada completa. ¡Gracias!</div>
            <p className="muted">La bitácora, la asistencia, las fotos y el material quedaron guardados en su carpeta de Drive.</p>
            <div className="actions">
              <button type="button" disabled={ocupado}
                onClick={() => accion(async () => aplicar(await api<EstadoResidente>('/api/estado')))}>
                {ocupado ? <><span className="spinner" /> Abriendo…</> : 'Iniciar nueva sesión'}
              </button>
              <button type="button" className="secondary" onClick={salir}>Salir</button>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function Login(props: { ocupado: boolean; onIngresar: (usuario: string, clave: string) => void }) {
  return (
    <section className="card">
      <h1>Bitácora de residentes</h1>
      <p className="muted">Ingrese con el usuario y la contraseña que le asignaron.</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        props.onIngresar(String(f.get('usuario')), String(f.get('clave')));
      }}>
        <label className="field"><span>Usuario</span>
          <input type="text" name="usuario" autoComplete="username" autoCapitalize="none" autoCorrect="off" required /></label>
        <label className="field"><span>Contraseña <small className="muted">(su número de documento)</small></span>
          <input type="password" name="clave" inputMode="numeric" autoComplete="current-password" required /></label>
        <div className="actions">
          <button type="submit" disabled={props.ocupado}>
            {props.ocupado ? <><span className="spinner" /> Ingresando…</> : 'Ingresar'}
          </button>
        </div>
      </form>
    </section>
  );
}

function PlanClase(props: { ocupado: boolean; onError: (m: string) => void; onSubir: (f: File, progreso: (p: number) => void) => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [progreso, setProgreso] = useState(0);
  const [sobre, setSobre] = useState(false);

  function elegir(f?: File | null) {
    if (!f) return;
    const ext = (f.name.includes('.') ? f.name.split('.').pop() ?? '' : '').toLowerCase();
    if (!(PLAN_EXTENSIONES as readonly string[]).includes(ext)) {
      setArchivo(null);
      props.onError('Formato no permitido. Suba un archivo .doc, .docx, .xls, .xlsx o .pdf.');
      return;
    }
    props.onError('');
    setArchivo(f);
  }

  return (
    <section className="card">
      <h2>Plan de clase</h2>
      <p className="muted">
        Antes de empezar, suba su plan de clase. Es un único archivo en formato .doc, .docx, .xls, .xlsx o .pdf y solo se carga una vez.
      </p>
      <label
        className={'drop' + (sobre ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => { e.preventDefault(); setSobre(false); elegir(e.dataTransfer.files[0]); }}
      >
        <input type="file" accept=".doc,.docx,.xls,.xlsx,.pdf" onChange={(e) => elegir(e.target.files?.[0])} />
        <strong>Toque para elegir el archivo</strong>
        <br />
        <span className="small muted">{archivo ? `${archivo.name} · ${tamano(archivo.size)}` : 'o arrástrelo aquí'}</span>
      </label>
      <div className="actions">
        <button type="button" disabled={!archivo || props.ocupado} onClick={() => archivo && props.onSubir(archivo, setProgreso)}>
          {props.ocupado ? <><span className="spinner" /> Subiendo {Math.round(progreso * 100)} %</> : 'Subir plan de clase'}
        </button>
      </div>
    </section>
  );
}
