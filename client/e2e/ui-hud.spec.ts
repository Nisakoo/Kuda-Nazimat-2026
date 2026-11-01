import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { expectCapture, createFromHub, joinFromHub } from './helpers';
import { storedTool, hudWindow } from './helpers';
import { authAvatarScenario } from './auth-avatar-scenario';
import { avatarWorldScenario } from './avatar-world-scenario';

let child: ChildProcess, directory: string, origin: string;
const evidence = resolve(process.env.UI_EVIDENCE_DIR ?? '../tasks/evidence/ui-redesign-2026-07-02');
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ui-hud-real-'));
  await mkdir(evidence, { recursive: true });
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>(done => listener.close(() => done()));
  origin = `http://127.0.0.1:${port}`;
  const configFile = join(directory, 'config.json');
  await writeFile(configFile, JSON.stringify({ clientDebug: false, logs: { fileLevel: 'off', consoleLevel: 'warn' }, host: '127.0.0.1', port, clientDir: resolve('dist'), worldDir: resolve('public'), contentDir: resolve('../server/content'), dbPath: join(directory, 'game.sqlite'), defaultMap: 'market', disconnectGraceMs: 100, saveIntervalMs: 100 }));
  child = spawn(process.execPath, ['../server/src/app/main.ts', '--config', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error(output || 'Server startup timeout')), 15000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stderr!.on('data', data => { output += data; });
    child.stdout!.on('data', data => { output += data; if (output.includes('ВАВИЛОН ЗАПУЩЕН')) { clearTimeout(timer); done(); } });
  });
});
test.afterAll(async () => {
  if (child && child.exitCode === null && !child.signalCode) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function screenshot(page: Page, name: string) { await page.screenshot({ path: join(evidence, name) }); }
async function enroll(page: Page, name: string, size = '1') {
  await page.goto(origin);
  await page.getByLabel('Имя игрока').fill(name);
  await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await createFromHub(page, size);
}
async function dock(page: Page, name: string) {
  const key = name === '\u041a\u0430\u0440\u0442\u0430' ? '3' : name === '\u0421\u043b\u043e\u0432\u0430\u0440\u044c' ? '2' : '1';
  await hudWindow(page, key);
}
async function withinViewport(page: Page) {
  const problems = await page.evaluate(() => [...document.querySelectorAll('dialog[open], .hud-dock')].filter(node => { const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1; }).map(node => node.className));
  expect(problems).toEqual([]);
}

test('confirmed appearance enters the real world, changes live and keeps the held jug', async ({ page }) => {
  test.setTimeout(240000);
  await avatarWorldScenario(page, origin, evidence);
});

test('real guest entry preserves only the connection address and returns from mode with Escape', async ({ page }) => {
  // HTTP LAN origins do not expose randomUUID, even though getRandomValues works.
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  await page.goto(origin);
  expect(await page.locator('.entry-login-screen').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await screenshot(page, 'entry-1280.png');
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'entry-390.png');
  await expect(page.getByLabel('Имя игрока')).toBeVisible();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByText('Дополнительно', { exact: true }).click();
  await page.getByLabel('Адрес сервера').fill(origin);
  await page.getByRole('button', { name: 'Применить и открыть карту', exact: true }).click();
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('babylon.serverUrl'))).toBe(origin);
  await expect(page.getByRole('button', { name: 'Настроить подключение', exact: true })).toHaveCount(0);
  const entryBackground = await page.locator('main').evaluate(node => getComputedStyle(node, '::before').backgroundImage);
  await page.getByLabel('Имя игрока').fill('UI-назад'); await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Куда отправимся?' })).toBeVisible();
  expect(await page.locator('main').evaluate(node => getComputedStyle(node, '::before').backgroundImage)).toBe(entryBackground);
  const back = page.getByRole('button', { name: '← Назад', exact: true });
  const next = page.getByRole('button', { name: 'Далее →', exact: true });
  const before = await back.boundingBox(), nextBounds = await next.boundingBox();
  expect(before).not.toBeNull(); expect(nextBounds).not.toBeNull();
  expect(before!.y).toBe(nextBounds!.y);
  expect(before!.height).toBe(nextBounds!.height);
  expect(Math.abs(before!.width - nextBounds!.width)).toBeLessThan(1);
  const background = await back.evaluate(node => getComputedStyle(node).backgroundImage);
  await back.hover();
  expect(await back.boundingBox()).toEqual(before);
  expect(await back.evaluate(node => getComputedStyle(node).backgroundImage)).toBe(background);
  await expect(page.getByRole('radio', { name: /^Одному/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^С друзьями/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Личный кабинет' })).toBeVisible();
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  await expect(page.getByRole('radio', { name: /^С друзьями/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Имя игрока')).toHaveValue('');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['babylon.serverUrl']);
});

test('real registration resumes mandatory appearance and uses password authentication', async ({ page }) => {
  test.setTimeout(180000);
  await authAvatarScenario(page, origin, evidence);
});

test('real server HUD switches one modal, blocks gameplay, preserves words and closes without pause', async ({ page }) => {
  test.setTimeout(240000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enroll(page, 'UI-соло');
  await screenshot(page, 'hud-1280.png');
  expect(await storedTool(page, 'jug')).toEqual({ tool: 'jug' });
  await dock(page, 'Карта');
  await expect(page.getByRole('dialog', { name: 'Карта Вавилона', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Карта Вавилона', exact: true })).toHaveCSS('background-color', 'rgb(251, 241, 223)');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const map = page.getByRole('img', { name: 'Схема рынка и положение игрока' });
  const before = await map.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Увеличить карту' }).click();
  expect(await map.getAttribute('viewBox')).not.toBe(before);
  await page.getByRole('button', { name: 'К игроку' }).click();
  await screenshot(page, 'map-1280.png'); await withinViewport(page);
  await dock(page, 'Словарь');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByLabel('Слово', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.getByLabel('Перевод', { exact: true }).fill('Безопасный текст');
  await page.getByLabel('Заметка', { exact: true }).fill('Проверка сохранения');
  await page.keyboard.press('w'); // Text input must not move the player.
  await page.getByRole('button', { name: 'Добавить слово', exact: true }).click();
  await expect(page.locator('.word-list')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.word-list img')).toHaveCount(0);
  await page.getByLabel('Моя заметка', { exact: true }).fill('Уточнённая заметка перед изучением');
  await page.getByLabel('Пример', { exact: true }).fill('The little goat is hungry.');
  await page.getByLabel('Перевод примера', { exact: true }).fill('Козлёнок голоден.');
  for (let poll = 0; poll < 2; poll++) await page.waitForResponse(response => new URL(response.url()).pathname === '/api/babylon' && response.request().method() === 'POST' && response.request().postDataJSON()?.action?.type === 'state' && response.ok());
  await expect(page.getByLabel('Моя заметка', { exact: true })).toHaveValue('Уточнённая заметка перед изучением');
  await expect(page.getByLabel('Пример', { exact: true })).toHaveValue('The little goat is hungry.');
  await expect(page.getByLabel('Перевод примера', { exact: true })).toHaveValue('Козлёнок голоден.');
  await page.getByRole('button', { name: 'Запомнил', exact: true }).click();
  await page.getByRole('button', { name: 'Выучено · 1', exact: true }).click();
  await expect(page.locator('.word-list')).toContainText('Уточнённая заметка перед изучением');
  await screenshot(page, 'dictionary-1280.png');
  await page.getByLabel('Поиск', { exact: true }).fill('не существует'); await expect(page.locator('.word-list li')).toHaveCount(0);
  await page.getByLabel('Поиск', { exact: true }).fill('');
  await dock(page, 'Чат');
  await expect(page.getByRole('dialog', { name: 'Чат с напарниками' })).toBeVisible();
  await page.getByLabel('Сообщение группе').fill('Привет'); await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByLabel('История общения')).toContainText('Доставлено');
  await screenshot(page, 'chat-1280.png');
  for (const [width, height] of [[1622, 970], [390, 844], [640, 480]]) {
    await page.setViewportSize({ width: width!, height: height! });
    for (const [button, image] of [['Карта', 'map'], ['Словарь', 'dictionary'], ['Чат', 'chat']]) { await dock(page, button!); await withinViewport(page); await screenshot(page, `${image}-${width}.png`); }
  }
  await page.keyboard.press('Escape'); await expectCapture(page, true);
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Выйти из сессии', exact: true }).click();
  await page.getByLabel('Имя игрока').fill('UI-соло'); await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await joinFromHub(page);
  expect(await storedTool(page)).toEqual({ tool: 'jug' });
  await dock(page, 'Словарь');
  await page.getByRole('button', { name: 'Выучено · 1', exact: true }).click();
  await expect(page.locator('.word-list')).toContainText('Уточнённая заметка перед изучением');
  await expect(page.getByLabel('Моя заметка', { exact: true })).toHaveValue('Уточнённая заметка перед изучением');
  await expect(page.getByLabel('Пример', { exact: true })).toHaveValue('The little goat is hungry.');
  await expect(page.getByLabel('Перевод примера', { exact: true })).toHaveValue('Козлёнок голоден.');
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await page.getByLabel('Заметка', { exact: true }).fill('Изменено'); await page.getByRole('button', { name: 'Сохранить слово', exact: true }).click();
  await expect(page.locator('.word-list')).toContainText('Изменено');
  await page.getByRole('button', { name: 'Удалить', exact: true }).click(); await expect(page.locator('.word-list li')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('windows close without pause and keep actions aligned at desktop and compact sizes', async ({ page }) => {
  test.setTimeout(120000);
  await enroll(page, 'UI-window-polish');
  for (const [width, height] of [[1280, 800], [390, 844], [640, 480]]) {
    await page.setViewportSize({ width: width!, height: height! });
    for (const [key, name] of [['Tab', 'tasks'], ['1', 'chat'], ['2', 'words'], ['3', 'map'], ['4', 'languages']]) {
      await page.keyboard.press(key!);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCount(1); await expectCapture(page, false);
      await expect(page.getByRole('dialog', { name: 'Пауза' })).toHaveCount(0);
      await withinViewport(page);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const buttons = await dialog.locator('button').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0).map(node => {
        const r = node.getBoundingClientRect(); return { text: node.textContent, x: r.x, right: r.right, y: r.y, bottom: r.bottom, height: r.height };
      }));
      for (const button of buttons) { expect(button.height).toBeGreaterThanOrEqual(44); expect(button.x).toBeGreaterThanOrEqual(0); expect(button.right).toBeLessThanOrEqual(width!); }
      for (let a = 0; a < buttons.length; a++) for (let b = a + 1; b < buttons.length; b++) {
        const x = buttons[a]!, y = buttons[b]!;
        expect(x.x < y.right - 1 && y.x < x.right - 1 && x.y < y.bottom - 1 && y.y < x.bottom - 1, `${x.text} overlaps ${y.text}`).toBe(false);
      }
      const close = dialog.getByRole('button').first(); const before = await close.boundingBox();
      await close.hover(); expect(await close.boundingBox()).toEqual(before);
      await screenshot(page, `window-${name}-${width}.png`);
      if (key === '1' || key === '3') await page.keyboard.press('Escape');
      else await close.click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const recovery = page.getByRole('button', { name: 'Вернуть управление', exact: true });
      await expect.poll(async () => await page.evaluate(() => !!document.pointerLockElement) || await recovery.isVisible()).toBe(true);
      // Chrome's native Escape unlock can temporarily reject reacquisition.
      if (await recovery.isVisible()) { await page.waitForTimeout(1200); await recovery.click(); }
      await expectCapture(page, true);
    }
    await page.keyboard.press('Escape');
    const pause = page.getByRole('dialog', { name: 'Пауза' }); await expect(pause).toBeVisible();
    await screenshot(page, `window-pause-${width}.png`);
    await pause.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Настройки' })).toBeVisible();
    await withinViewport(page); await screenshot(page, `window-settings-${width}.png`);
    await page.keyboard.press('Escape'); await expect(pause).toBeVisible();
    await page.keyboard.press('Escape');
    const recovery = page.getByRole('button', { name: 'Вернуть управление', exact: true });
    await expect.poll(async () => await page.evaluate(() => !!document.pointerLockElement) || await recovery.isVisible()).toBe(true);
    if (await recovery.isVisible()) { await page.waitForTimeout(1200); await recovery.click(); }
    await expectCapture(page, true);
  }
  await page.keyboard.press('3');
  await expect(page.getByRole('dialog', { name: 'Карта Вавилона' })).toBeVisible();
  await page.evaluate(() => {
    const original = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function() {
      Element.prototype.requestPointerLock = original;
      return Promise.reject(new Error('Test denial after closing a HUD window'));
    };
  });
  await page.getByRole('dialog').getByRole('button').first().click();
  await expect(page.getByRole('region', { name: 'Возврат управления' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toHaveCount(0); await expectCapture(page, false);
  await page.getByRole('button', { name: 'Вернуть управление', exact: true }).click();
  await expectCapture(page, true);
});

test('connection errors allow retry and disappear after entry polling recovers', async ({ page }) => {
  await page.goto(origin);
  await page.getByLabel('Имя игрока').fill('UI-recovery');
  await page.route('**/api/auth/guest', route => route.abort(), { times: 1 });
  await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось связаться с сервером');
  await page.route('**/api/babylon', route => route.abort(), { times: 1 });
  await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Личный кабинет', exact: true });
  await expect(setup.getByRole('alert')).toContainText('Сервер недоступен');
  await expect(setup.getByRole('button', { name: 'Создать игру', exact: true })).toBeVisible();
  await expect(setup.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Имя игрока')).toHaveValue('');
});
