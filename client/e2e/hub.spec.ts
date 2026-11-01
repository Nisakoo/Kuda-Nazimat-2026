import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { expectCapture, finishLoading, joinFromHub, createFromHub, storedTool } from './helpers';

let directory: string, origin: string, targetOrigin: string;
const children: ChildProcess[] = [];
const evidence = resolve(process.env.UI_EVIDENCE_DIR ?? '../tasks/evidence/hub-2026-11-01');
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ui-hud-real-'));
  await mkdir(evidence, { recursive: true });
  for (let index = 0; index < 2; index++) {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>(done => listener.close(() => done()));
  if (index === 0) origin = `http://127.0.0.1:${port}`; else targetOrigin = `http://127.0.0.1:${port}`;
  const configFile = join(directory, `config-${index}.json`);
  await writeFile(configFile, JSON.stringify({ clientDebug: false, logs: { fileLevel: 'off', consoleLevel: 'warn' }, host: '127.0.0.1', port, clientDir: resolve('dist'), worldDir: resolve('public'), contentDir: resolve('../server/content'), dbPath: join(directory, `game-${index}.sqlite`), defaultMap: 'market', disconnectGraceMs: 100, saveIntervalMs: 100 }));
  const child = spawn(process.execPath, ['../server/src/app/main.ts', '--config', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error(output || 'Server startup timeout')), 15000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stderr!.on('data', data => { output += data; });
    child.stdout!.on('data', data => { output += data; if (output.includes('ВАВИЛОН ЗАПУЩЕН')) { clearTimeout(timer); done(); } });
  });
  }
});
test.afterAll(async () => {
  for (const child of children) if (child.exitCode === null && !child.signalCode) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function profile(page: Page, name: string) {
  await page.goto(origin);
  await page.getByLabel('Имя игрока').fill(name);
  await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Личный кабинет' })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  await expect(page.getByText('Профиль сохранён')).toBeVisible();
  await expect.poll(() => page.locator('.hub-portrait').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}
async function play(page: Page) {
  await expect(page.getByRole('region', { name: 'Загрузка мира' })).toHaveCount(0, { timeout: 30000 });
  const restore = page.getByRole('button', { name: 'Вернуть управление', exact: true });
  if (await restore.isVisible()) await restore.click();
  await expectCapture(page, true);
}
test('hub saves preferences, selects modes, loads automatically and preserves the saved game', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let creates = 0;
  page.on('request', request => { if (request.url().endsWith('/api/babylon') && request.postDataJSON()?.action?.type === 'create') creates++; });
  await page.addInitScript(() => localStorage.setItem('babylon.serverUrl', 'http://127.0.0.1:1'));
  await profile(page, 'Hub solo');
  await page.getByLabel('Изучаемый язык').selectOption('es');
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const actions = page.locator('.hub-actions button');
    const bounds = await actions.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { y: r.y, height: r.height, right: r.right }; }));
    expect(bounds).toHaveLength(3);
    expect(new Set(bounds.map(r => r.y)).size).toBe(1);
    expect(new Set(bounds.map(r => r.height)).size).toBe(1);
    expect(bounds.every(r => r.right <= width)).toBe(true);
    await actions.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, `profile-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await page.getByRole('radio', { name: /С друзьями/ }).check();
  await expect(page.getByLabel('Число игроков')).toBeVisible();
  await page.getByRole('radio', { name: /Одному/ }).check();
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Загрузка мира' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toHaveCount(0);
  await play(page);
  expect(await storedTool(page, 'jug')).toEqual({ tool: 'jug' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Выйти из сессии', exact: true }).click();
  await page.getByLabel('Имя игрока').fill('Hub solo');
  await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByText('Профиль сохранён')).toBeVisible();
  await expect(page.getByLabel('Изучаемый язык')).toHaveValue('es');
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await page.getByRole('radio', { name: /С друзьями/ }).check();
  await expect(page.getByRole('button', { name: 'Далее →', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: /С друзьями/ }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Удалить текущую игру и создать новую?' })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(creates).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Повторить запрос', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Сохранённая игра' })).toContainText('Одиночная игра');
  await page.getByRole('button', { name: 'Продолжить игру', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'saved-game-mode.png') });
  await page.getByRole('button', { name: 'Продолжить игру', exact: true }).click();
  await play(page);
  expect(await storedTool(page)).toEqual({ tool: 'jug' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'На главный экран', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Личный кабинет' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить игру', exact: true }).click();
  await play(page);
  expect(creates).toBe(1);
  expect(errors).toEqual([]);
});

test('manual IP validates input, reports unreachable server, cancels late navigation and reauthenticates on another server', async ({ page, request }) => {
  test.setTimeout(60000);
  const host = await (await request.post(`${targetOrigin}/api/auth/guest`, { data: { name: 'Remote host' } })).json();
  const headers = { Authorization: `Bearer ${host.token}` };
  for (const action of [{ type: 'languages', native: 'ru', learning: 'en' }, { type: 'create', size: 2 }]) {
    const reply = await request.post(`${targetOrigin}/api/babylon`, { headers, data: { v: 2, requestId: crypto.randomUUID(), action } });
    expect(reply.ok()).toBe(true);
  }
  let sourceToken = ''; let leaked = false;
  page.on('response', async response => { if (response.url() === `${origin}/api/auth/guest`) sourceToken = (await response.json()).token; });
  page.on('request', request => { if (sourceToken && new URL(request.url()).origin === targetOrigin && JSON.stringify(request.headers()).includes(sourceToken)) leaked = true; });
  await profile(page, 'Remote visitor');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await page.getByLabel('IP-адрес').fill('999.1.1.1');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('IP');
  await page.getByLabel('IP-адрес').fill('127.0.0.1'); await page.getByLabel('Порт', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('65535');
  await page.getByLabel('Порт', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось подключиться');
  await page.getByLabel('Порт', { exact: true }).fill(new URL(targetOrigin).port);
  await page.route(`${targetOrigin}/api/health`, route => route.fulfill({ json: { status: 'ok', protocol: 1 }, headers: { 'Access-Control-Allow-Origin': '*' } }), { times: 1 });
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Несовместимая версия');
  let release!: () => void; let intercepted = false;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${targetOrigin}/api/health`, async route => { intercepted = true; await delayed; await route.continue().catch(() => {}); }, { times: 1 });
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect.poll(() => intercepted).toBe(true);
  await page.getByRole('button', { name: '← Назад', exact: true }).click(); release();
  await expect(page.getByRole('heading', { name: 'Личный кабинет' })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(origin);
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page).toHaveURL(targetOrigin + '/');
  await page.getByLabel('Имя игрока').fill('Remote visitor');
  await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Подключиться к игре' })).toBeVisible();
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  await joinFromHub(page);
  expect(leaked).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('babylon.serverUrl'))).toBe(targetOrigin);
  const revoked = await request.get(`${origin}/api/auth/state`, { headers: { Authorization: `Bearer ${sourceToken}` } });
  expect(revoked.status()).toBe(401);
});

test('delayed world stays frozen; cancel ignores late resources and retry enters without creating twice', async ({ page }) => {
  test.setTimeout(60000);
  let release!: () => void; let held = false; let creates = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const positions: string[] = [];
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string' || !payload.startsWith('42')) return;
    const message = JSON.parse(payload.slice(payload.indexOf('[')))[1];
    const entities = message.snapshot?.entities ?? message.upsert ?? [];
    const player = entities.find((entity: { character?: { kind: string; name: string } }) => entity.character?.name === 'Loading freeze');
    if (player?.transform?.position) positions.push(JSON.stringify(player.transform.position));
  }));
  page.on('request', request => { if (request.url().endsWith('/api/babylon') && request.postDataJSON()?.action?.type === 'create') creates++; });
  await profile(page, 'Loading freeze');
  await page.route('**/world/**/*.bin', async route => { held = true; await gate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await page.keyboard.down('w'); await page.keyboard.down('Space');
  await expect(page.getByRole('region', { name: 'Загрузка мира' })).toBeVisible();
  await expectCapture(page, false);
  await page.screenshot({ path: join(evidence, 'loading-delayed.png') });
  await page.keyboard.up('w'); await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Вернуться в кабинет', exact: true }).click(); release();
  await page.unroute('**/world/**/*.bin');
  await expect(page.getByRole('heading', { name: 'Личный кабинет' })).toBeVisible();
  expect(positions.length).toBeGreaterThan(0);
  expect(new Set(positions).size).toBe(1);
  await joinFromHub(page);
  expect(creates).toBe(1);
});

test('resource failure retries and Escape during loading requires an explicit capture gesture', async ({ page }) => {
  test.setTimeout(60000);
  await profile(page, 'Load recovery');
  await page.route('**/world/**/*.bin', route => route.abort());
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.unroute('**/world/**/*.bin');
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Вернуть управление', exact: true })).toBeVisible({ timeout: 30000 });
  await expectCapture(page, false);
  await page.screenshot({ path: join(evidence, 'loading-capture-recovery.png') });
  await finishLoading(page);
});

test('reduced motion and a browser capture rejection leave a recoverable ready world', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = Element.prototype.requestPointerLock; let first = true;
    Element.prototype.requestPointerLock = function(options) { if (first) { first = false; return Promise.reject(new Error('test browser denial')); } return original.call(this, options); };
  });
  await profile(page, 'Reduced entry');
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Вернуть управление', exact: true })).toBeVisible({ timeout: 30000 });
  await expectCapture(page, false);
  await expect(page.getByRole('button', { name: 'Вернуться в кабинет', exact: true })).toBeVisible();
  await finishLoading(page);
});

test('entry errors persist across polling and retry never submits a changed destination', async ({ page }) => {
  test.setTimeout(60000);
  await profile(page, 'Retry without submit');
  await page.getByLabel('Изучаемый язык').selectOption('es');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('сохраните изменения языков');
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Нет игры');
  await expect(page.getByRole('button', { name: 'Повторить запрос', exact: true })).toHaveCount(0);
  for (let i = 0; i < 2; i++) await page.waitForResponse(response => response.url().endsWith('/api/babylon') && response.request().postDataJSON()?.action?.type === 'state' && response.ok());
  await expect(page.getByRole('alert')).toContainText('Нет игры');
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await createFromHub(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'На главный экран', exact: true }).click();
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  const packets: unknown[] = []; let probes = 0;
  page.on('request', request => { if (request.url() === `${targetOrigin}/api/health`) probes++; });
  await page.route('**/api/babylon', async route => {
    const packet = route.request().postDataJSON();
    if (packet.action?.type === 'join') {
      packets.push(packet);
      if (packets.length === 1) { await route.fulfill({ status: 503, json: { error: { message: 'Временный отказ' } } }); return; }
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить запрос', exact: true })).toBeVisible();
  await page.getByLabel('Порт', { exact: true }).fill(new URL(targetOrigin).port);
  await page.getByRole('button', { name: 'Повторить запрос', exact: true }).click();
  await finishLoading(page);
  expect(packets).toHaveLength(2); expect(packets[1]).toEqual(packets[0]); expect(probes).toBe(0);
});

test('an existing waiting party offers a direct join before a rejected create', async ({ page, request }) => {
  const owner = await (await request.post(`${origin}/api/auth/guest`, { data: { name: 'Waiting owner' } })).json();
  const headers = { Authorization: `Bearer ${owner.token}` };
  for (const action of [{ type: 'languages', native: 'ru', learning: 'en' }, { type: 'create', size: 2 }]) {
    const reply = await request.post(`${origin}/api/babylon`, { headers, data: { v: 2, requestId: crypto.randomUUID(), action } }); expect(reply.ok()).toBe(true);
  }
  let creates = 0;
  page.on('request', request => { if (request.url().endsWith('/api/babylon') && request.postDataJSON()?.action?.type === 'create') creates++; });
  await profile(page, 'Waiting peer');
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Доступная игра' })).toContainText('1 из 2');
  await expect(page.getByRole('button', { name: 'Далее →', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Присоединиться к игре', exact: true }).click();
  await finishLoading(page); expect(creates).toBe(0);
});

test('keyboard-only HUD keeps tasks and language, supports digits and shows help only while Alt is held', async ({ page }) => {
  await profile(page, 'Keyboard HUD'); await createFromHub(page);
  await expectCapture(page, true);
  await expect(page.locator('button:visible')).toHaveCount(0);
  await expect(page.locator('.hud-dock, .brand, .entry-brand, footer')).toHaveCount(0);
  await expect(page.getByLabel('Текущее задание')).toBeVisible();
  await expect(page.getByLabel('Текущий язык')).toContainText('English');
  const hint = page.getByRole('complementary', { name: 'Управление' });
  await expect(hint).toHaveCount(0);
  for (const key of ['i', 'm', 'k', 'j', 'l', 'o', 'Enter']) await page.keyboard.press(key);
  await expectCapture(page, true); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.down('AltLeft');
  await expect(hint).toBeVisible(); await expect(hint).toContainText('Tab');
  await expectCapture(page, true);
  await page.screenshot({ path: join(evidence, 'controls-alt-1280.png') });
  await page.keyboard.up('AltLeft'); await expect(hint).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog', { name: 'Козы пастуха' })).toBeVisible(); await expectCapture(page, false);
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog', { name: 'Козы пастуха' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Закрыть окно', exact: true })).not.toBeFocused();
  await page.keyboard.press('1');
  await expect(page.getByRole('dialog', { name: 'Чат с напарниками' })).toBeVisible();
  await page.getByLabel('Сообщение группе').fill('Текст ');
  for (const key of ['1', '2', '3', '4']) await page.keyboard.press(key);
  await expect(page.getByLabel('Сообщение группе')).toHaveValue('Текст 1234');
  await page.keyboard.down('AltRight'); await expect(hint).toHaveCount(0); await page.keyboard.up('AltRight');
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).focus();
  await page.keyboard.press('2'); await expect(page.getByRole('dialog', { name: 'Мой словарь' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).focus();
  await page.keyboard.press('3'); await expect(page.getByRole('dialog', { name: 'Карта Вавилона' })).toBeVisible();
  await page.keyboard.press('4'); await expect(page.getByRole('dialog', { name: 'Ваши языки' })).toBeVisible();
  await page.getByLabel('Изучаемый язык', { exact: true }).selectOption('es');
  await page.getByRole('button', { name: 'Сохранить языки', exact: true }).click();
  await expect(page.getByLabel('Текущий язык')).toContainText('Español');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toHaveCount(0);
  await expectCapture(page, true);
  await page.screenshot({ path: join(evidence, 'keyboard-hud-1280.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.down('AltRight'); await expect(hint).toBeVisible();
  const bounds = await hint.boundingBox(); expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: join(evidence, 'controls-alt-390.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(hint).toHaveCount(0); await expectCapture(page, false);
  await page.keyboard.up('AltRight');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(hint).toHaveCount(0); await expectCapture(page, true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Настройки' })).toBeVisible();
});

test('replacing a saved game asks first, preserves cancellation and creates either mode without losing the dictionary', async ({ page }) => {
  let authorization = '';
  const creates: { requestId: string; action: { type: string; size: number; replacePartyId?: string } }[] = [];
  page.on('request', request => {
    if (!request.url().endsWith('/api/babylon')) return;
    authorization = request.headers().authorization ?? authorization;
    const body = request.postDataJSON(); if (body?.action?.type === 'create') creates.push(body);
  });
  await profile(page, 'Replace game'); await createFromHub(page);
  const state = async () => {
    const response = await page.request.post(`${origin}/api/babylon`, { headers: { Authorization: authorization }, data: { v: 2, requestId: crypto.randomUUID(), action: { type: 'state' } } });
    expect(response.ok()).toBe(true); return (await response.json()).state;
  };
  const initial = await state();
  const saved = await page.request.post(`${origin}/api/babylon`, { headers: { Authorization: authorization }, data: { v: 2, requestId: crypto.randomUUID(), action: { type: 'word-save', word: 'goat', translation: 'коза', note: 'Сохранить при замене' } } });
  expect(saved.ok()).toBe(true);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'На главный экран', exact: true }).click();
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await page.getByRole('radio', { name: /С друзьями/ }).check();
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Удалить текущую игру и создать новую?' });
  await expect(confirmation).toBeVisible(); await expect(confirmation).toContainText('на 2 игроков');
  await expect(confirmation.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(confirmation).toHaveCount(0);
  expect(creates).toHaveLength(1); expect((await state()).party.id).toBe(initial.party.id);
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await confirmation.screenshot({ path: join(evidence, 'replace-game-confirmation.png') });
  await confirmation.getByRole('button', { name: 'Удалить и создать новую', exact: true }).click();
  await finishLoading(page);
  const multiplayer = await state();
  expect(multiplayer.party).toMatchObject({ size: 2, count: 1 });
  expect(multiplayer.party.id).not.toBe(initial.party.id);
  expect(multiplayer.words).toHaveLength(1); expect(multiplayer.profile).toEqual(initial.profile);
  expect(creates[1]!.action.replacePartyId).toBe(initial.party.id);
  const replay = await page.request.post(`${origin}/api/babylon`, { headers: { Authorization: authorization }, data: { ...creates[1], v: 2 } });
  expect(replay.ok()).toBe(true); expect((await replay.json()).state.party.id).toBe(multiplayer.party.id);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'На главный экран', exact: true }).click();
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await page.getByRole('radio', { name: /Одному/ }).check();
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  await expect(confirmation).toContainText('одиночная игра');
  await confirmation.getByRole('button', { name: 'Удалить и создать новую', exact: true }).click();
  await finishLoading(page);
  const solo = await state();
  expect(solo.party).toMatchObject({ size: 1, started: true }); expect(solo.party.id).not.toBe(multiplayer.party.id);
  expect(solo.words[0].note).toBe('Сохранить при замене');
});

