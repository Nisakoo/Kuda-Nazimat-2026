/** ADMIN first-stage browser acceptance against real HTTP/Socket.IO/SQLite.
 * Uses the already provisioned client Playwright package; does not build or change client/.
 * OPERATOR_BROWSER_PACKAGE may point to another installed package.json in an isolated worktree.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { io } from 'socket.io-client';
import { makeWorld, npc } from './a-helpers.ts';
import { parseConfig } from '../src/app/config.ts';
import { startApplication } from '../src/app/application.ts';
import { createGame } from '../src/game/index.ts';
import { createObservability } from '../src/obs/index.ts';

const { chromium, expect } = createRequire(process.env.OPERATOR_BROWSER_PACKAGE || new URL('../../client/package.json', import.meta.url))('@playwright/test');
const evidence = resolve('tasks/evidence/admin-panel');
await mkdir(evidence, { recursive: true });
const world = await makeWorld([npc('guide', 0, 6)]);
const root = dirname(world.worldDir);
await writeFile(join(root, 'index.html'), '<main>Fixture client</main>');
const config = { ...parseConfig({ ...world, clientDir: root, dbPath: join(root, 'game.sqlite'), defaultMap: 'test', host: '127.0.0.1', staticChunkRadius: 0, auth: { passwordless: false }, disconnectGraceMs: 10000, monitoring: { pingIntervalMs: 1000 }, logs: { dir: join(root, 'logs'), consoleLevel: 'fatal', fileLevel: 'debug' } }, join(root, 'config.json'), 'test'), port: 0 };
const obs = createObservability(config.logs);
let app, browser;
const sockets = [];
try {
  app = await startApplication(config, createGame, obs.logger, undefined, obs);
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const post = async (path, data, token) => {
    const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const first = await post('/api/auth/register', { name: 'Мира', password: 'private-test-pass-42' });
  assert.equal(first.status, 201);
  const second = await post('/api/auth/login', { name: 'Мира', password: 'private-test-pass-42' });
  const sonya = await post('/api/auth/register', { name: 'Соня', password: 'another-test-pass-42' });
  async function joinGame(token) {
    assert.equal((await post('/api/avatar', { avatarId: 'ksu' }, token)).status, 200);
    const socket = io(origin + '/game', { auth: { version: 3, token }, transports: ['websocket'], reconnection: false, autoConnect: false });
    sockets.push(socket);
    const packets = [];
    socket.on('game', value => packets.push(value));
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    socket.emit('game', { v: 3, type: 'join', requestId: 'join', mapId: 'test' });
    await expect.poll(() => packets.some(p => p.type === 'joined')).toBe(true);
    return socket;
  }
  const miraSocket = await joinGame(second.body.token);
  const sonyaSocket = await joinGame(sonya.body.token);
  browser = await chromium.launch({ headless: true, ...(process.env.OPERATOR_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OPERATOR_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  async function go(label) {
    const ids = { 'Обзор': 'overview', 'Сервер': 'server', 'Клиенты': 'clients', NPC: 'npc', 'Журнал': 'journal', 'Аккаунты': 'accounts' };
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page.locator('#view-' + ids[label])).toBeVisible();
    await expect(page.locator('[data-section="' + ids[label] + '"]')).toHaveAttribute('aria-current', 'page');
  }
  const errors = [], external = [], mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(origin)) external.push(request.url());
    if (request.method() === 'POST') mutations.push(request.url());
  });
  await page.goto(origin + '/operator');
  await expect(page.locator('#overview-cards')).toContainText('2 из 4');
  await expect(page.locator('#urls')).toContainText('http://localhost:');
  await page.screenshot({ path: join(evidence, 'overview-1440.png'), fullPage: true });
  await go('Клиенты');
  await expect(page.locator('#players')).toContainText('Мира');
  await page.locator('#player-search').fill('сон');
  await expect(page.locator('#players')).toContainText('Соня');
  await expect(page.locator('#players')).not.toContainText('Мира');
  await page.locator('#player-search').fill('');
  await page.locator('#map-filter').selectOption('test');
  await expect(page.locator('#player-count')).toHaveText('Показано 2 из 2');
  sonyaSocket.disconnect();
  await expect(page.locator('#players')).toContainText('Вышел, место удержано');
  await expect(page.locator('#client-cards')).toContainText('1 из 4');
  await expect(page.locator('#client-cards')).toContainText('Места 2 из 4');
  await page.screenshot({ path: join(evidence, 'clients-1440.png'), fullPage: true });

  await go('Аккаунты');
  await page.locator('#account-name').fill('мира');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.locator('#account-title')).toHaveText('Мира');
  await expect(page.locator('#account-sessions')).toHaveText('2 активных');
  await expect(page.locator('[data-action="unlock"]')).toBeDisabled();
  await page.screenshot({ path: join(evidence, 'accounts-1440.png'), fullPage: true });
  const before = mutations.length;
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-action="revoke"]').click();
  assert.equal(mutations.length, before);
  assert.equal(miraSocket.connected, true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="revoke"]').click();
  await expect(page.locator('#toast')).toContainText('Сессии завершены: 2');
  await expect.poll(() => miraSocket.connected).toBe(false);
  await expect(page.locator('#account-sessions')).toHaveText('0 активных');
  for (const token of [first.body.token, second.body.token]) assert.equal((await fetch(origin + '/api/auth/state', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/login', { name: 'Мира', password: 'wrong-password' })).status, 401);
  await page.locator('#refresh').click();
  await expect(page.locator('#account-lock')).toContainText('заблокирован');
  await expect(page.locator('[data-action="unlock"]')).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="unlock"]').click();
  await expect(page.locator('#toast')).toContainText('Блокировка входа снята');
  await expect(page.locator('[data-action="unlock"]')).toBeDisabled();

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="reset-password"]').click();
  await expect(page.locator('#password-dialog')).toBeVisible();
  const password = await page.locator('#temporary-password').textContent();
  assert.equal(password.length, 10);
  await page.keyboard.press('Escape');
  await expect(page.locator('#temporary-password')).toBeEmpty();
  await expect(page.locator('body')).not.toContainText(password);
  assert.equal((await post('/api/auth/login', { name: 'Мира', password })).body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  await page.locator('#account-name').fill('Никого');
  await expect(page.locator('#account-details')).toBeHidden();
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.locator('#account-message')).toContainText('Аккаунт не найден');

  await go('Сервер');
  await expect(page.locator('#environment')).toHaveText('test');
  await expect(page.locator('#queue')).toContainText('из 4');
  await page.screenshot({ path: join(evidence, 'server-1440.png'), fullPage: true });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#dump').click();
  await expect(page.locator('#toast')).toContainText('Отчёт сохранён:');
  for (const section of ['Обзор', 'Сервер', 'Клиенты', 'NPC', 'Журнал', 'Аккаунты']) {
    await go(section);
    await page.setViewportSize({ width: 1024, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, section + ' must fit 1024 px');
  }
  await go('Сервер');
  await page.screenshot({ path: join(evidence, 'server-1024.png'), fullPage: true });
  await page.getByRole('button', { name: 'Свернуть боковую панель' }).click();
  await expect(page.locator('body')).toHaveClass('collapsed');
  await go('Клиенты');
  await expect(page.locator('#view-clients')).toBeVisible();
  await page.getByRole('button', { name: 'Развернуть боковую панель' }).click();
  await page.locator('#section-search').fill('сер');
  await expect(page.getByRole('link', { name: 'Сервер', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Клиенты', exact: true })).toBeHidden();
  await page.locator('#section-search').fill('');

  // Controlled API fixture tests display thresholds and XSS without pretending to measure hardware.
  const snapshot = await (await fetch(origin + '/api/operator/status')).json();
  const injected = { ...snapshot, health: { level: 'yellow', reasons: [{ level: 'yellow', text: 'NPC недоступны' }] }, npc: 'unavailable', players: [{ name: '<b>Соня</b>', mapId: 'test', connected: true, releaseInMs: null, rttMs: 172, reconnects: 3, seatedSeconds: 123 }], seats: { used: 1, max: 4 } };
  await page.route('**/api/operator/status', route => route.fulfill({ json: injected }));
  await page.locator('#refresh').click();
  await expect(page.locator('#players')).toContainText('<b>Соня</b>');
  assert.equal(await page.locator('#players b').count(), 0);
  await expect(page.locator('#players')).toContainText('Медленная сеть');
  await expect(page.locator('#players')).toContainText('Нестабильная связь');
  await expect(page.locator('#client-cards .card').last()).toContainText('1');
  await page.screenshot({ path: join(evidence, 'clients-thresholds-1024.png'), fullPage: true });
  await go('Сервер');
  await expect(page.locator('#reasons')).toContainText('NPC недоступны');
  await page.unroute('**/api/operator/status');
  const lastTime = await page.locator('#updated').textContent();
  await page.route('**/api/operator/status', route => route.fulfill({ status: 503, json: { error: { message: 'offline' } } }));
  await page.locator('#refresh').click();
  await expect(page.locator('#connection-error')).toContainText('Сервер недоступен');
  await expect(page.locator('#updated')).toHaveText(lastTime);
  await expect(page.locator('#seats')).toHaveText('Места 1 из 4');
  await page.screenshot({ path: join(evidence, 'disconnected-1024.png'), fullPage: true });
  await page.unroute('**/api/operator/status');
  await page.locator('#refresh').click();
  await expect(page.locator('#connection-error')).toBeHidden();
  await go('Аккаунты');
  await page.locator('#account-name').fill('Мира');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.locator('#account-details')).toBeVisible();
  await page.route('**/api/operator/actions/reset-password', route => route.abort());
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="reset-password"]').click();
  await expect(page.locator('#toast')).toContainText('Не удалось подтвердить результат');
  await expect(page.locator('#password-dialog')).toBeHidden();
  await expect(page.locator('[data-action="reset-password"]')).toBeEnabled();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: real HTTP/SQLite/Socket.IO; offline assets; navigation, filters, 1024 px, confirmations, revoke, lock/unlock, one-time password, dump, API failure/recovery, XSS and thresholds.');
  console.log('Thresholds and HTTP failures used controlled API fixtures. Physical LAN and client FPS were not measured.');
} finally {
  await browser?.close();
  for (const socket of sockets) socket.disconnect();
  await app?.stop(); obs.close();
  await rm(root, { recursive: true, force: true });
}
