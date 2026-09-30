'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROGRAMAS } from '@/lib/config';
import { api, ErrorApi } from '@/lib/cliente';

interface Residente {
  usuario: string;
  nombre: string;
  programa: string;
  planSubido: boolean;
  sesionesCompletas: number;
  sesionEnCurso: number | null;
  carpeta: string;
}

interface Corrida {
  estado: 'sin-configurar' | 'nunca' | 'en-curso' | 'exitosa' | 'fallida';
  inicio: string | null;
  url: string | null;
}

interface Panel {
  residentes: Residente[];
  sync: { archivosPendientes: number; hojasPendientes: number; ultima: string | null };
  urlApp: string;
}

function hace(iso: string | null) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace menos de un minuto';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : new Date(iso).toLocaleString('es-CO');
}

/** Panel de la administradora: sincronización con Drive, residentes y contraseñas. */
export function AdminApp() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState('');
  const [alerta, setAlerta] = useState('');
  const [aviso, setAviso] = useState('');
  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [confirmar, setConfirmar] = useState('');
  const [claveDe, setClaveDe] = useState('');
  const sondeo = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fallo = useCallback((e: unknown) => {
    if (e instanceof ErrorApi && e.expirada) {
      setPanel(null);
      setAlerta('Su sesión expiró. Ingrese de nuevo.');
    } else {
      setAlerta((e as Error).message);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    api<Panel>('/api/admin/residentes')
      .then(setPanel)
      .catch((e) => { if (!(e instanceof ErrorApi && e.status === 401)) fallo(e); })
      .finally(() => setCargando(false));
  }, [fallo]);

  /** Consulta la sincronización en GitHub hasta que termine; al terminar, actualiza los contadores. */
  const seguirSync = useCallback(function seguir(intentos = 0) {
    if (sondeo.current) clearTimeout(sondeo.current);
    api<Corrida>('/api/admin/sincronizar').then(async (c) => {
      setCorrida(c);
      if (c.estado === 'en-curso' && intentos < 90) {
        sondeo.current = setTimeout(() => seguir(intentos + 1), 5000);
      } else if (intentos > 0) {
        setPanel(await api<Panel>('/api/admin/residentes'));
        if (c.estado === 'exitosa') setAviso('Sincronización terminada: todo lo pendiente ya está en Google Drive.');
        if (c.estado === 'fallida') setAlerta('La sincronización falló. Intente de nuevo; si se repite, avíseme.');
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (panel) seguirSync();
    return () => { if (sondeo.current) clearTimeout(sondeo.current); };
  }, [panel !== null, seguirSync]); // eslint-disable-line react-hooks/exhaustive-deps

  const sincronizarAhora = () => accion('sync', async () => {
    setCorrida(await api<Corrida>('/api/admin/sincronizar', {}));
    sondeo.current = setTimeout(() => seguirSync(1), 5000);
  });

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function accion(nombre: string, fn: () => Promise<void>) {
    setOcupado(nombre);
    setAlerta('');
    try { await fn(); } catch (e) { fallo(e); } finally { setOcupado(''); }
  }

  if (cargando) return <main className="wrap"><div className="card"><span className="spinner" /> Cargando…</div></main>;

  if (!panel) {
    return (
      <main className="wrap" style={{ maxWidth: 460 }}>
        {alerta && <div className="alert error" role="alert">{alerta}</div>}
        <form className="card" onSubmit={(e) => {
          e.preventDefault();
          const clave = String(new FormData(e.currentTarget).get('clave'));
          void accion('login', async () => {
            await api('/api/admin/login', { clave });
            setPanel(await api<Panel>('/api/admin/residentes'));
          });
        }}>
          <h1>Administración</h1>
          <label className="field"><span>Contraseña de administradora</span>
            <input type="password" name="clave" autoComplete="current-password" required /></label>
          <div className="actions"><Btn ocupado={ocupado} id="login" texto="Ingresar" tipo="submit" /></div>
        </form>
      </main>
    );
  }

  const { sync } = panel;
  const pendientes = sync.archivosPendientes + sync.hojasPendientes;
  const enCurso = corrida?.estado === 'en-curso';

  return (
    <>
      <header className="topbar">
        <div className="who">Administración<small>Bitácora de residentes · MGB / Proyecto1</small></div>
        <button type="button" onClick={() => accion('salir', async () => { await api('/api/admin/logout', {}); setPanel(null); })}>Salir</button>
      </header>
      <main className="wrap ancho">
        {alerta && <div className="alert error" role="alert">{alerta}</div>}
        {aviso && <div className="alert ok">{aviso}</div>}

        <section className="card">
          <h2>Google Drive</h2>
          <p style={{ marginBottom: 4 }}>
            Última sincronización: <strong>{hace(sync.ultima)}</strong>.
          </p>
          <p className="muted small">
            {!sync.ultima
              ? 'Aún no se ha hecho la primera sincronización. Las evidencias quedarán en la carpeta MGB/Proyecto1 de Drive.'
              : pendientes === 0
              ? 'Todo está al día en Drive (carpeta MGB/Proyecto1).'
              : `Pendientes por llevar a Drive: ${sync.archivosPendientes} archivo(s) y ${sync.hojasPendientes} hoja(s) de Excel.`}
          </p>
          {enCurso && (
            <div className="alert info"><span className="spinner" /> Sincronizando con Google Drive… (tarda cerca de un minuto)</div>
          )}
          {corrida?.estado === 'sin-configurar' && (
            <p className="small muted">El botón de sincronizar aún no está conectado a GitHub. Mientras tanto, se sincroniza sola cada hora.</p>
          )}
          <div className="actions">
            <button type="button" disabled={!!ocupado || enCurso || corrida?.estado === 'sin-configurar'} onClick={sincronizarAhora}>
              {ocupado === 'sync' || enCurso ? <><span className="spinner" /> Sincronizando…</> : 'Sincronizar ahora'}
            </button>
            {confirmar === 'reenviar' ? (
              <>
                <Btn ocupado={ocupado} id="reenviar" texto="Sí, reenviar todo" onClick={() => {
                  setConfirmar('');
                  void accion('reenviar', async () => {
                    await api('/api/admin/reenviar', {});
                    setPanel(await api<Panel>('/api/admin/residentes'));
                    setAviso('Se están reenviando todas las carpetas y hojas a Drive.');
                    seguirSync(1);
                  });
                }} />
                <button type="button" className="secondary" onClick={() => setConfirmar('')}>Cancelar</button>
              </>
            ) : (
              <Btn ocupado={ocupado} id="reenviar" texto="Reenviar carpetas y hojas" clase="secondary" onClick={() => setConfirmar('reenviar')} />
            )}
          </div>
          {confirmar === 'reenviar' && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Vuelve a crear en Drive todas las carpetas y hojas de Excel (útil si se borró algo en Drive). Los archivos ya enviados no se duplican.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Enlaces</h2>
          <p className="small muted" style={{ marginBottom: 4 }}>Enlace para los residentes:</p>
          <input type="text" readOnly value={panel.urlApp} onFocus={(e) => e.currentTarget.select()} />
        </section>

        <form className="card" autoComplete="off" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
          void accion('crear', async () => {
            setPanel(await api<Panel>('/api/admin/residentes', f));
            setAviso(`Residente creado. Entréguele: usuario "${f.usuario.trim().toLowerCase()}" y la contraseña asignada.`);
            form.reset();
          });
        }}>
          <h2>Nuevo residente</h2>
          <div className="row">
            <label className="field"><span>Nombre completo</span><input type="text" name="nombre" required /></label>
            <label className="field"><span>Programa</span>
              <select name="programa" required defaultValue="">
                <option value="" disabled>Seleccione…</option>
                {PROGRAMAS.map((p) => <option key={p}>{p}</option>)}
              </select></label>
          </div>
          <div className="row">
            <label className="field"><span>Usuario</span>
              <input type="text" name="usuario" autoCapitalize="none" autoCorrect="off" placeholder="ej. jperez" required /></label>
            <label className="field"><span>Contraseña</span>
              <input type="text" name="clave" placeholder="mínimo 6 caracteres" required /></label>
          </div>
          <div className="actions"><Btn ocupado={ocupado} id="crear" texto="Crear residente" tipo="submit" /></div>
        </form>

        <section className="card">
          <h2>Residentes</h2>
          {panel.residentes.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>Aún no hay residentes.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Residente</th><th>Programa</th><th>Usuario</th><th>Plan</th><th>Sesiones</th><th /></tr></thead>
                <tbody>
                  {panel.residentes.map((r) => (
                    <tr key={r.usuario}>
                      <td>{r.nombre}</td>
                      <td>{r.programa}</td>
                      <td>{r.usuario}</td>
                      <td>{r.planSubido ? 'Cargado' : 'Pendiente'}</td>
                      <td>{r.sesionesCompletas} completas{r.sesionEnCurso ? ` · en curso: ${r.sesionEnCurso}` : ''}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {claveDe === r.usuario ? (
                          <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => {
                            e.preventDefault();
                            const clave = String(new FormData(e.currentTarget).get('clave'));
                            void accion('clave', async () => {
                              await api('/api/admin/clave', { usuario: r.usuario, clave });
                              setClaveDe('');
                              setAviso(`Contraseña de ${r.nombre} actualizada.`);
                            });
                          }}>
                            <input type="text" name="clave" placeholder="nueva (mín. 6)" autoFocus required
                              style={{ minHeight: 32, padding: '4px 8px', width: 140 }} />
                            <button type="submit" className="mini" disabled={!!ocupado}>Guardar</button>
                            <button type="button" className="secondary mini" onClick={() => setClaveDe('')}>×</button>
                          </form>
                        ) : (
                          <button type="button" className="secondary mini" disabled={!!ocupado} title={r.carpeta}
                            onClick={() => setClaveDe(r.usuario)}>
                            Restablecer clave
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function Btn(p: { ocupado: string; id: string; texto: string; tipo?: 'submit' | 'button'; clase?: string; onClick?: () => void }) {
  return (
    <button type={p.tipo ?? 'button'} className={p.clase} disabled={!!p.ocupado} onClick={p.onClick}>
      {p.ocupado === p.id ? <><span className="spinner" /> Procesando…</> : p.texto}
    </button>
  );
}
