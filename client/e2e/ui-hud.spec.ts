import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { expectCapture } from './helpers';
import { authAvatarScenario } from './auth-avatar-scenario';
import { avatarWorldScenario } from './avatar-world-scenario';

let child: ChildProcess, directory: string, origin: string;
const evidence = resolve('../tasks/evidence/ui-redesign-2026-07-02');
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ui-hud-real-'));
  await mkdir(evidence, { recursive: true });
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>(done => listener.close(() => done()));
  origin = `http://127.0.0.1:${port}`;
  const configFile = join(directory, 'config.json');
  await writeFile(configFile, JSON.stringify({ host: '127.0.0.1', port, clientDir: resolve('dist'), worldDir: resolve('public'), contentDir: resolve('../server/content'), dbPath: join(directory, 'game.sqlite'), defaultMap: 'market', disconnectGraceMs: 100, saveIntervalMs: 100 }));
  child = spawn(process.execPath, ['../server/src/app/main.ts', '--config', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error(output || 'Server startup timeout')), 15000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stderr!.on('data', data => { output += data; });
    child.stdout!.on('data', data => { output += data; if (output.includes('Сервер доступен')) { clearTimeout(timer); done(); } });
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
  await expect(page.getByRole('dialog', { name: 'Куда отправимся?' })).toBeVisible();
  if (size !== '1') { const friends = page.getByRole('radio', { name: /С друзьями/ }); if (await friends.isEnabled()) await friends.check(); const count = page.getByLabel('Число игроков'); if (await count.isEnabled()) await count.selectOption(size); }
  await screenshot(page, 'mode-1280.png');
  await page.getByRole('button', { name: 'Далее: языки →', exact: true }).click();
  await page.getByRole('button', { name: 'Войти в Вавилон →', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать в Вавилон' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  await page.getByRole('button', { name: 'Начать прогулку' }).click();
  await expectCapture(page, true);
}
async function dock(page: Page, name: string) { await page.getByRole('navigation', { name: 'Игровые окна' }).getByRole('button', { name, exact: true }).click(); }
async function withinViewport(page: Page) {
  const problems = await page.evaluate(() => [...document.querySelectorAll('dialog[open], .hud-dock')].filter(node => { const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1; }).map(node => node.className));
  expect(problems).toEqual([]);
}

test('confirmed appearance enters the real world, changes live and keeps the held jug', async ({ page }) => {
  test.setTimeout(240000);
  await avatarWorldScenario(page, origin, evidence);
});

test('real guest entry preserves only the connection address and returns from mode with Escape', async ({ page }) => {
  await page.goto(origin);
  expect(await page.locator('.entry-login-screen').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await screenshot(page, 'entry-1280.png');
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'entry-390.png');
  await expect(page.getByLabel('Имя игрока')).toBeVisible();
  await page.getByRole('button', { name: 'Настроить подключение', exact: true }).click();
  await page.getByLabel('Адрес сервера').fill(origin);
  await page.getByRole('button', { name: 'Применить и открыть карту', exact: true }).click();
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('babylon.serverUrl'))).toBe(origin);
  await page.getByLabel('Имя игрока').fill('UI-назад'); await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Куда отправимся?' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Одному/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^С друзьями/ })).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Ваши языки', exact: true })).toBeVisible();
  await expect(page.getByLabel('Родной язык', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Куда отправимся?', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^С друзьями/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Имя игрока')).toHaveValue('');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['babylon.serverUrl']);
});

test('real registration resumes mandatory appearance and uses password authentication', async ({ page }) => {
  test.setTimeout(180000);
  await authAvatarScenario(page, origin, evidence);
});

test('real server HUD switches one modal, blocks gameplay, preserves words and requires explicit capture', async ({ page }) => {
  test.setTimeout(240000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enroll(page, 'UI-соло');
  await screenshot(page, 'hud-1280.png');
  await page.keyboard.press('i');
  await expect(page.getByRole('dialog', { name: 'Инвентарь', exact: true })).toBeVisible();
  await expectCapture(page, false);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: 'Кувшин', exact: true }).click();
  await page.getByRole('button', { name: 'Взять в руки', exact: true }).click();
  await expect(page.getByText('В руках: Кувшин', { exact: true })).toBeVisible();
  await screenshot(page, 'inventory-1280.png');
  await page.keyboard.press('i');
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
  await expectCapture(page, false);
  await dock(page, 'Инвентарь');
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
  await page.getByRole('button', { name: '＋ Добавить', exact: true }).click();
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
    for (const [button, image] of [['Инвентарь', 'inventory'], ['Карта', 'map'], ['Словарь', 'dictionary'], ['Чат', 'chat']]) { await dock(page, button!); await withinViewport(page); await screenshot(page, `${image}-${width}.png`); }
  }
  await page.keyboard.press('Escape'); await expectCapture(page, false);
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expectCapture(page, true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Выйти из сессии', exact: true }).click();
  await page.getByLabel('Имя игрока').fill('UI-соло'); await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Куда отправимся?' })).toBeVisible();
  await expect(page.getByText('Продолжение сохранённого задания. Режим и прогресс сохраняются.')).toBeVisible();
  await page.getByRole('button', { name: 'Далее: языки →', exact: true }).click();
  await page.getByRole('button', { name: 'Войти в Вавилон →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  await page.getByRole('button', { name: 'Начать прогулку' }).click(); await expectCapture(page, true);
  await page.keyboard.press('i');
  await expect(page.getByText('В руках: Кувшин', { exact: true })).toBeVisible();
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
