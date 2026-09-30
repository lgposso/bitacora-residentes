/**
 * Dispara y consulta la sincronización con Google Drive (workflow de GitHub Actions).
 * Requiere GITHUB_REPO ("usuario/repo") y GITHUB_TOKEN (token con permiso Actions: lectura y escritura).
 */
import { ErrorUsuario } from './validaciones';

const WORKFLOW = 'sincronizar.yml';

export interface EstadoCorrida {
  estado: 'sin-configurar' | 'nunca' | 'en-curso' | 'exitosa' | 'fallida';
  inicio: string | null;
  url: string | null;
}

function config() {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  return repo && token ? { repo, token } : null;
}

async function github(ruta: string, init: RequestInit = {}) {
  const c = config();
  if (!c) throw new ErrorUsuario('El botón de sincronizar aún no está conectado a GitHub (falta GITHUB_TOKEN).', 503);
  const res = await fetch(`https://api.github.com/repos/${c.repo}/actions/workflows/${WORKFLOW}${ruta}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${c.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    },
    cache: 'no-store'
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new ErrorUsuario('GitHub rechazó el permiso para sincronizar. Revise el token (GITHUB_TOKEN).', 502);
  }
  if (!res.ok) throw new ErrorUsuario(`GitHub respondió ${res.status}. Intente de nuevo en un momento.`, 502);
  return res;
}

export async function ultimaCorrida(): Promise<EstadoCorrida> {
  if (!config()) return { estado: 'sin-configurar', inicio: null, url: null };
  const r = (await (await github('/runs?per_page=1')).json()) as {
    workflow_runs: { status: string; conclusion: string | null; created_at: string; html_url: string }[];
  };
  const c = r.workflow_runs[0];
  if (!c) return { estado: 'nunca', inicio: null, url: null };
  const estado = c.status !== 'completed' ? 'en-curso' : c.conclusion === 'success' ? 'exitosa' : 'fallida';
  return { estado, inicio: c.created_at, url: c.html_url };
}

/** Lanza una sincronización (si ya hay una en curso, no lanza otra). */
export async function dispararSync() {
  const actual = await ultimaCorrida();
  if (actual.estado === 'en-curso') return actual;
  await github('/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  return { estado: 'en-curso' as const, inicio: new Date().toISOString(), url: null };
}

/** Igual que dispararSync, pero nunca falla: para lanzar la sincronización de fondo tras cerrar una sesión. */
export async function dispararSyncSinFallar() {
  if (!config()) return;
  try {
    await dispararSync();
  } catch (e) {
    console.error('No se pudo lanzar la sincronización:', e);
  }
}
