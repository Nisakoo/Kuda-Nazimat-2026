import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

// Real HTTP/auth/client bootstrap, but only the deterministic scripted responder.
// An isolated HOME prevents any operator's prepared model catalog from being selected.
let child: ChildProcess | undefined; let directory: string; let origin: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'browser-npc-timeout-'));
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  const port = address.port; await new Promise<void>(done => reservation.close(() => done()));
  origin = `http://127.0.0.1:${port}`;
  const config = join(directory, 'config.json');
  await writeFile(config, JSON.stringify({ host: '127.0.0.1', port, clientDir: resolve('dist'), worldDir: resolve('public'),
    contentDir: resolve('../server/content'), dbPath: join(directory, 'game.sqlite'), defaultMap: 'demo',
    npc: { adapter: 'scripted', timeoutMs: 15000, options: { delayMs: 30 } } }));
  child = spawn(process.execPath, ['../server/src/app/main.ts', '--config', config], {
    env: { ...process.env, HOME: directory, KUDA_NPC_TIMEOUT: '60', KUDA_LLM_BACKEND: '', KUDA_LLM_MODEL: '', KUDA_LLM_PROFILES: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error(`Scripted startup timeout: ${output}`)), 15000);
    const failed = (code: number | null) => { clearTimeout(timer); reject(new Error(`Scripted server exited ${code}: ${output}`)); };
    child!.once('exit', failed); child!.once('error', error => { clearTimeout(timer); reject(error); });
    child!.stderr!.on('data', data => { output += String(data); });
    child!.stdout!.on('data', data => {
      output += String(data);
      if (output.includes('Сервер доступен')) { clearTimeout(timer); child!.off('exit', failed); done(); }
    });
  });
});
test.afterAll(async () => {
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child?.kill('SIGKILL'), 11000);
      try { const [code] = await exited; expect(code).toBe(0); } finally { clearTimeout(timer); }
    }
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
});

test('Make-compatible seconds override reaches public HTTP and the actual online client', async ({ page, request }) => {
  const response = await request.get(`${origin}/api/game-config`);
  expect(response.ok()).toBe(true); expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ npcTimeoutMs: 60000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Войти в мир' })).toBeVisible();
  const metadata = page.waitForResponse(result => result.url() === `${origin}/api/game-config`);
  await page.getByLabel('Имя игрока').fill('Timeout-тест');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect(await (await metadata).json()).toEqual({ npcTimeoutMs: 60000 });
  await expect(page.getByLabel('Состояние связи')).toHaveText('Подключён');
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  expect(errors).toEqual([]);
});
