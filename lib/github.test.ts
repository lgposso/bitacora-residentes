import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { dispararSync, dispararSyncSinFallar, ultimaCorrida } from './github';

const corrida = (status: string, conclusion: string | null) => ({
  workflow_runs: [{ status, conclusion, created_at: '2026-09-30T02:47:00Z', html_url: 'https://github.com/x/y/actions/runs/1' }]
});

let llamadas: { url: string; method: string; body?: string }[];

function responder(runs: object, status = 200) {
  llamadas = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    llamadas.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
    return new Response(url.endsWith('/dispatches') ? null : JSON.stringify(runs), { status: url.endsWith('/dispatches') ? 204 : status });
  }));
}

beforeEach(() => {
  process.env.GITHUB_REPO = 'lgposso/bitacora-residentes';
  process.env.GITHUB_TOKEN = 'token-de-prueba';
});
afterEach(() => vi.unstubAllGlobals());

test('traduce el estado de la última corrida', async () => {
  responder(corrida('in_progress', null));
  expect((await ultimaCorrida()).estado).toBe('en-curso');
  responder(corrida('completed', 'success'));
  expect((await ultimaCorrida()).estado).toBe('exitosa');
  responder(corrida('completed', 'failure'));
  expect((await ultimaCorrida()).estado).toBe('fallida');
  responder({ workflow_runs: [] });
  expect((await ultimaCorrida()).estado).toBe('nunca');
});

test('lanza el workflow en la rama main', async () => {
  responder(corrida('completed', 'success'));
  expect((await dispararSync()).estado).toBe('en-curso');
  const d = llamadas.find((l) => l.url.endsWith('/dispatches'))!;
  expect(d.url).toBe('https://api.github.com/repos/lgposso/bitacora-residentes/actions/workflows/sincronizar.yml/dispatches');
  expect(d.method).toBe('POST');
  expect(JSON.parse(d.body!)).toEqual({ ref: 'main' });
});

test('no lanza otra si ya hay una en curso', async () => {
  responder(corrida('queued', null));
  await dispararSync();
  expect(llamadas.some((l) => l.url.endsWith('/dispatches'))).toBe(false);
});

test('sin token queda "sin-configurar" y el disparo de fondo no falla', async () => {
  delete process.env.GITHUB_TOKEN;
  responder(corrida('completed', 'success'));
  expect((await ultimaCorrida()).estado).toBe('sin-configurar');
  await expect(dispararSyncSinFallar()).resolves.toBeUndefined();
  await expect(dispararSync()).rejects.toThrow(/GITHUB_TOKEN/);
  expect(llamadas).toEqual([]);
});

test('token rechazado da un mensaje claro', async () => {
  responder({}, 401);
  await expect(ultimaCorrida()).rejects.toThrow(/rechazó el permiso/);
});
