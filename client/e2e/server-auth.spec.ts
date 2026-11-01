import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { expectCapture, createFromHub } from './helpers';

let processHandle: ChildProcess; let directory: string; let origin: string; let configFile: string;
async function startServer() {
  processHandle = spawn(process.execPath, ['../server/src/app/main.ts', '--config', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timeout: ${output}`)), 15000);
    const failed = (code: number | null) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); };
    processHandle.once('exit', failed);
    const ready = (chunk: Buffer) => {
      output += String(chunk);
      if (output.includes('(app.ready)')) { clearTimeout(timeout); processHandle.off('exit', failed); resolve(); }
    };
    processHandle.stderr!.on('data', ready);
    processHandle.stdout!.on('data', ready);
  });
}
async function stopServer() {
  if (processHandle?.exitCode !== null || processHandle?.signalCode) return;
  const exited = once(processHandle, 'exit'); processHandle.kill('SIGTERM');
  const deadline = setTimeout(() => processHandle.kill('SIGKILL'), 11000);
  const [code] = await exited; clearTimeout(deadline); expect(code).toBe(0);
}
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'browser-auth-'));
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const address = portServer.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>((done) => portServer.close(() => done()));
  origin = `http://127.0.0.1:${port}`; configFile = join(directory, 'config.json');
  await writeFile(configFile, JSON.stringify({ clientDebug: false, logs: { fileLevel: 'off', consoleLevel: 'warn' }, host: '127.0.0.1', port, clientDir: resolve('dist'), worldDir: resolve('public'), contentDir: resolve('../server/content'), dbPath: join(directory, 'game.sqlite'), defaultMap: 'demo', disconnectGraceMs: 100, saveIntervalMs: 100, npc: { options: { delayMs: 30 } } }));
  await startServer();
});
test.afterAll(async () => { await stopServer(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function login(page: Page, name: string) {
  await page.goto(origin); await expect(page.getByRole('heading', { name: 'Войти в город' })).toBeVisible();
  await page.getByLabel('Имя игрока').fill(name);
  const [response] = await Promise.all([
    page.waitForResponse(result => result.url() === `${origin}/api/auth/guest` && result.request().method() === 'POST'),
    page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);
  const session = await response.json() as { token: string };
  expect(session.token).toMatch(/^[\w-]{43}$/);
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  return session;
}
async function chat(page: Page) {
  await page.bringToFront(); await page.getByRole('button', { name: 'Начать прогулку' }).click(); await expectCapture(page, true);
  await page.keyboard.press('1');

}

test('real guest login authorizes world, takeover returns the form, logout and reload forget the token', async ({ page, context }) => {
  const protectedRequests: string[] = []; let posts = 0; const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.url().includes('/world/')) protectedRequests.push(request.headers().authorization ?? ''); if (request.url().endsWith('/api/auth/guest')) posts++; });
  await page.goto(origin); await expect(page.getByRole('button', { name: 'Начать путешествие →', exact: true })).toBeDisabled();
  expect(protectedRequests).toEqual([]); expect(posts).toBe(0);
  await page.getByLabel('Имя игрока').fill('Аня'); await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled(); expect(posts).toBe(1);
  expect(protectedRequests.length).toBeGreaterThan(0); expect(protectedRequests.every((value) => /^Bearer [\w-]{43}$/.test(value))).toBe(true);
  const other = await context.newPage(); await login(other, 'аня');
  await expect(page.getByRole('heading', { name: 'Войти в город' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Игра открыта в другом окне.'); await expect(page.locator('canvas')).toHaveCount(0);
  await other.getByRole('button', { name: 'Выйти из сессии' }).click(); await expect(other.getByLabel('Имя игрока')).toBeVisible();
  await other.reload(); await expect(other.getByLabel('Имя игрока')).toBeVisible();
  expect(await other.evaluate(() => Object.keys(localStorage))).toEqual(['babylon.serverUrl']);
  expect(await other.evaluate(() => localStorage.getItem('babylon.serverUrl'))).toBe(origin);
  expect(await other.evaluate(() => sessionStorage.length)).toBe(0);
  await other.close(); expect(errors).toEqual([]);
});

test('real players exchange chat and NPC memory survives a server restart', async ({ page, context }) => {
  test.setTimeout(60000);
  await login(page, 'Лея-тест'); const other = await context.newPage(); await login(other, 'Борис');
  await chat(page); await page.getByLabel('Сообщение игрокам').fill('Привет <b>мир</b>'); await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await chat(other); await expect(other.getByRole('dialog', { name: 'Общение' })).toContainText('Привет <b>мир</b>');
  await other.close(); await page.bringToFront(); await page.keyboard.press('Escape');
  await expectCapture(page, true);
  await page.keyboard.down('w'); await page.waitForTimeout(1500); await page.keyboard.up('w');
  await page.keyboard.down('a'); await page.waitForTimeout(1200); await page.keyboard.up('a');
  await page.keyboard.press('e'); await expect(page.getByRole('dialog', { name: 'Лея', exact: true })).toBeVisible();
  await page.getByLabel('Ваш вопрос').fill('Что хранит история?'); await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Лея', exact: true })).toContainText('Приветствую');
  await stopServer(); await startServer(); await login(page, 'Лея-тест');
  await page.getByRole('button', { name: 'Начать прогулку' }).click(); await expectCapture(page, true);
  await page.keyboard.press('e'); await expect(page.getByRole('dialog', { name: 'Лея', exact: true })).toBeVisible();
  await page.getByLabel('Ваш вопрос').fill('Что хранит история?'); await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Лея', exact: true })).toContainText('В прошлый раз ты спрашивал: “Что хранит история?”');
  await page.screenshot({ path: 'test-results/server-npc-memory.png' });
});

test('login errors remain text, pending login is cancelled by settings, and small-screen form fits', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 }); await page.goto(origin);
  await page.route('**/api/auth/guest', route => route.fulfill({ status: 400, json: { error: { code: 'INVALID', message: '<img src=x onerror=alert(1)> Ошибка имени' } } }));
  await page.getByLabel('Имя игрока').fill('Тест'); await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('<img'); await expect(page.locator('img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Начать путешествие →', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/server-login-640.png' });
  await page.unroute('**/api/auth/guest');
  await page.route('**/api/auth/guest', async (route) => { await new Promise<void>((resolve) => setTimeout(resolve, 500)); await route.abort().catch(() => {}); });
  await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true })).toBeDisabled();
  await expect(page.locator('.entry-form')).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByText('Дополнительно', { exact: true }).click();
  await page.getByLabel('Адрес сервера').fill('http://127.0.0.1:1'); await page.getByRole('button', { name: 'Применить и открыть карту' }).click();
  await expect(page.getByLabel('Имя игрока')).toBeVisible(); await expect(page.getByRole('button', { name: 'Начать путешествие →', exact: true })).toBeDisabled();
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('a world 401 and client session expiry return to login without automatically posting again', async ({ page }) => {
  let posts = 0; page.on('request', (request) => { if (request.url().endsWith('/api/auth/guest')) posts++; });
  await page.route('**/world/**', route => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Истекла' } } }));
  await page.goto(origin); await page.getByLabel('Имя игрока').fill('Сессия'); await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('сессия истекла или отклонена');
  await expect(page.getByLabel('Имя игрока')).toBeVisible(); await expect(page.locator('canvas')).toHaveCount(0); expect(posts).toBe(1);
  await page.unroute('**/world/**'); await page.clock.install(); await login(page, 'Сессия');
  await page.clock.fastForward(43200001);
  await expect(page.getByLabel('Имя игрока')).toBeVisible(); await expect(page.locator('canvas')).toHaveCount(0); expect(posts).toBe(2);
});

test('switching to the server market enrolls BABEL and opens tasks without inventory controls', async ({ page }) => {
  const session = await login(page, 'Рынок'); await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByText('Дополнительно', { exact: true }).click();
  await page.getByLabel('Карта', { exact: true }).fill('market'); await page.getByRole('button', { name: 'Применить и открыть карту' }).click();
  await createFromHub(page); await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog', { name: 'Козы пастуха', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  const authoritative = await page.request.post(`${origin}/api/babylon`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { v: 2, requestId: randomUUID(), action: { type: 'state' } },
  });
  expect(authoritative.ok()).toBe(true);
  const result = await authoritative.json() as { state: { inventory: Record<string, number> } };
  expect(result.state.inventory).toEqual({ dates: 0, 'red-fruit': 0, 'yellow-fruit': 0, water: 0, fabric: 0 });
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expectCapture(page, true); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Выйти из сессии' }).click(); await expect(page.getByLabel('Имя игрока')).toBeVisible();
});
