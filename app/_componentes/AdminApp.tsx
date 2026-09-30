'use client';

import { useCallback, useEffect, useState } from 'react';
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

interface Panel {
  residentes: Residente[];
  sync: { archivosPendientes: number; hojasPendientes: number; ultima: string | null; urlAcciones: string | null };
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
              : `Pendientes por llevar a Drive: ${sync.archivosPendientes} archivo(s) y ${sync.hojasPendientes} hoja(s) de Excel. Se sincronizan solos cada 30 minutos.`}
          </p>
          <div className="actions">
            {sync.urlAcciones && (
              <a className="btn secondary" href={sync.urlAcciones} target="_blank" rel="noopener">Sincronizar ahora (GitHub)</a>
            )}
            <Btn ocupado={ocupado} id="reenviar" texto="Reenviar carpetas y hojas" clase="secondary" onClick={() => {
              if (!window.confirm('Se volverán a crear en Drive todas las carpetas y hojas de Excel en la próxima sincronización. ¿Continuar?')) return;
              void accion('reenviar', async () => {
                await api('/api/admin/reenviar', {});
                setPanel(await api<Panel>('/api/admin/residentes'));
                setAviso('Listo: se reenviarán en la próxima sincronización.');
              });
            }} />
          </div>
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
                        <button type="button" className="secondary mini" disabled={!!ocupado} title={r.carpeta}
                          onClick={() => {
                            const clave = window.prompt(`Nueva contraseña para ${r.nombre} (mínimo 6 caracteres):`);
                            if (!clave) return;
                            void accion('clave', async () => {
                              await api('/api/admin/clave', { usuario: r.usuario, clave });
                              setAviso(`Contraseña de ${r.nombre} actualizada.`);
                            });
                          }}>
                          Restablecer clave
                        </button>
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
