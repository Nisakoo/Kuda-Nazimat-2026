/** ADMIN browser acceptance (first stage + NPC, world, journal, charts and FPS sections) against real HTTP/Socket.IO/SQLite.
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
const evidence = resolve('tasks/evidence/admin-panel-sections');
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
  // OBS-011: a client FPS report shows up in the clients table with its threshold.
  assert.equal((await fetch(origin + '/api/telemetry/client', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + second.body.token }, body: JSON.stringify({ v: 1, kind: 'perf', fps: 22, visible: true, frameMs: 48, drawCalls: 140 }) })).status, 204);
  await page.goto(origin + '/operator');
  await expect(page.locator('#overview-cards')).toContainText('2 из 4');
  await expect(page.locator('#urls')).toContainText('http://localhost:');
  await expect(page.locator('#chart-players')).not.toBeEmpty();
  await page.screenshot({ path: join(evidence, 'overview-1440.png'), fullPage: true });
  await go('Клиенты');
  await expect(page.locator('#players')).toContainText('Мира');
  await expect(page.locator('#players')).toContainText('Тормозит картинка');
  await expect(page.locator('#players')).toContainText('22');
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

  // NPC: live edit, create with an existing appearance, delete/restore, world block.
  await go('NPC');
  await expect(page.locator('#npc-rows')).toContainText('guide');
  await expect(page.locator('#world-rows')).toContainText('test');
  await page.locator('#npc-rows').getByRole('button', { name: 'Изменить' }).first().click();
  await expect(page.locator('#npc-editor')).toBeVisible();
  await page.locator('#npc-form [name="topic"]').fill('Новая тема');
  await page.locator('#npc-form [name="persona"]').fill('Спокойный проводник, говорит коротко.');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Изменения сохранены');
  await expect(page.locator('#npc-rows')).toContainText('Новая тема');
  assert.equal((await (await fetch(origin + '/api/operator/npcs/guide')).json()).npc.topic, 'Новая тема');
  await expect(page.locator('#npc-history')).toContainText('Редактирование');
  await page.screenshot({ path: join(evidence, 'npc-1440.png'), fullPage: true });
  await page.getByRole('button', { name: '+ Создать персонажа' }).click();
  await page.locator('#npc-form [name="id"]').fill('helper');
  await page.locator('#npc-form [name="name"]').fill('Помощник');
  await page.locator('#npc-form [name="topic"]').fill('Дорога');
  await page.locator('#npc-form [name="persona"]').fill('Вежливый');
  await page.locator('#npc-form [name="greeting"]').fill('Здравствуй');
  await page.locator('#npc-form [name="x"]').fill('2');
  await page.locator('#npc-form [name="z"]').fill('2');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('#npc-rows')).toContainText('helper');
  page.once('dialog', dialog => { page.once('dialog', prompt => prompt.accept('helper')); return dialog.accept(); });
  await page.getByRole('button', { name: 'Удалить персонажа' }).click();
  await expect(page.locator('#npc-rows')).not.toContainText('helper');
  await page.locator('#npc-deleted').check();
  await expect(page.locator('#npc-rows')).toContainText('Удалён');
  await page.locator('#npc-rows tr', { hasText: 'helper' }).getByRole('button', { name: 'Изменить' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Восстановить персонажа' }).click();
  await expect(page.locator('#toast')).toContainText('восстановлен');
  await page.locator('#npc-deleted').uncheck();

  await go('Журнал');
  await expect(page.locator('#journal-rows')).toContainText('Редактирование');
  await expect(page.locator('#journal-rows')).toContainText('Создание');
  await page.locator('#journal-rows tr', { hasText: 'Редактирование' }).first().click();
  await expect(page.locator('#journal-after')).toContainText('Новая тема');
  await page.locator('#journal-filters [name="action"]').selectOption('npc.delete');
  await expect(page.locator('#journal-rows')).toContainText('Удаление');
  await expect(page.locator('#journal-rows')).not.toContainText('Редактирование');
  assert.match(await page.locator('#journal-csv').getAttribute('href'), /journal\.csv\?.*action=npc\.delete/);
  const csv = await (await fetch(origin + (await page.locator('#journal-csv').getAttribute('href')))).text();
  assert.match(csv, /npc\.delete/); assert.doesNotMatch(csv, /npc\.update/);
  await page.screenshot({ path: join(evidence, 'journal-1440.png'), fullPage: true });

  await go('Аккаунты');
  await page.locator('#account-name').fill('мира');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.locator('#account-title')).toHaveText('Мира');
  await expect(page.locator('#account-sessions')).toHaveText('2 активных');
  await expect(page.locator('#account-history')).toContainText('Вход в игру');
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
  await page.locator('#account-name').fill('со');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.locator('#account-title')).toHaveText('Соня');

  await go('Сервер');
  await expect(page.locator('#environment')).toHaveText('test');
  await expect(page.locator('#queue')).toContainText('из 4');
  await expect(page.locator('#chart-perf')).not.toBeEmpty();
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
  const injected = { ...snapshot, overview: { ...snapshot.overview, unstable: 1 }, health: { level: 'yellow', reasons: [{ level: 'yellow', text: 'NPC недоступны' }] }, npc: 'unavailable', players: [{ name: '<b>Соня</b>', mapId: 'test', connected: true, releaseInMs: null, rttMs: 172, reconnects: 3, seatedSeconds: 123 }], seats: { used: 1, max: 4 } };
  await page.route('**/api/operator/status', route => route.fulfill({ json: injected }));
  await page.locator('#refresh').click();
  await expect(page.locator('#players')).toContainText('<b>Соня</b>');
  assert.equal(await page.locator('#players b').count(), 0);
  await expect(page.locator('#players')).toContainText('Медленная сеть');
  await expect(page.locator('#players')).toContainText('Нестабильная связь');
  await expect(page.locator('#client-cards .card').last()).toContainText('1');
  // Controlled history: lines, threshold, a gap (null), an above-scale point ("inf") and the hover tooltip.
  const now = Date.now();
  const pts = (f) => Array.from({ length: 30 }, (_, i) => [now - (29 - i) * 10000, f(i)]);
  const fakeHistory = { stepMs: 10000, from: now - 300000, to: now, thresholds: { ...snapshot.thresholds, seats: 4 },
    series: { seated: pts(i => i < 10 ? 1 : 2), connected: pts(i => i === 15 ? null : 2), tickP95Ms: pts(i => i === 20 ? 'inf' : 1 + (i % 4)), broadcastP95Ms: pts(() => 100), rssBytes: pts(i => (180 + i) * 1048576), heapBytes: pts(() => 60 * 1048576),
      npcFirstPartialP95Ms: pts(() => null), npcGenerationP95Ms: pts(i => 800 + i * 10), npcQueued: pts(() => 0), npcTimeouts: pts(() => 0), npcErrors: pts(() => 0), errors: pts(() => 0), warnings: pts(() => 0) },
    players: { p1: { name: 'Соня', rtt: pts(i => 40 + i * 6), fps: pts(i => 60 - i) }, p2: { name: '<i>Мира</i>', rtt: pts(() => 50), fps: pts(() => null) } } };
  await page.route('**/api/operator/history', route => route.fulfill({ json: fakeHistory }));
  await page.locator('#refresh').click();
  await expect(page.locator('#chart-ping svg path')).toHaveCount(2);
  await expect(page.locator('#chart-ping .limit')).toHaveCount(1);
  await expect(page.locator('#chart-ping .legend')).toContainText('<i>Мира</i>');
  assert.equal(await page.locator('#chart-ping i').count(), 0);
  await expect(page.locator('#chart-fps .legend')).toContainText('нет данных');
  const box = await page.locator('#chart-ping .hit').boundingBox();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await expect(page.locator('#chart-ping .chart-tip')).toContainText('Соня: 214 мс');
  await page.screenshot({ path: join(evidence, 'clients-thresholds-1024.png'), fullPage: true });
  await go('Сервер');
  await expect(page.locator('#chart-perf .legend')).toContainText('выше шкалы');
  await expect(page.locator('#chart-memory svg path')).toHaveCount(2);
  await page.screenshot({ path: join(evidence, 'server-charts-1024.png'), fullPage: true });
  await go('Обзор');
  const connected = await page.locator('#chart-players svg path').nth(1).getAttribute('d');
  assert.equal((connected.match(/M/g) || []).length, 2, 'null splits the line');
  await expect(page.locator('#chart-npc .legend')).toContainText('Первый текст, p95 — нет данных');
  await page.screenshot({ path: join(evidence, 'overview-charts-1024.png'), fullPage: true });
  await page.unroute('**/api/operator/history');
  await go('Клиенты');
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
  console.log('PASS: real HTTP/SQLite/Socket.IO; offline assets; navigation, filters, 1024 px, confirmations, revoke, lock/unlock, one-time password, dump, API failure/recovery, XSS and thresholds; client FPS report; NPC live edit/create/delete/restore; world block; journal filter/details/CSV; partial account search; SVG charts (threshold, gap, above-scale, tooltip).');
  console.log('Thresholds, chart series and HTTP failures used controlled API fixtures. Physical LAN, real client FPS and a live scene reset were not measured.');
} finally {
  await browser?.close();
  for (const socket of sockets) socket.disconnect();
  await app?.stop(); obs.close();
  await rm(root, { recursive: true, force: true });
}
