import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { expectCapture } from './helpers';
let child: ChildProcess, directory: string, origin: string, configFile: string;
async function start() {
  child = spawn(process.execPath, ['../server/src/app/main.ts', '--config', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error(output || 'Server startup timeout')), 15000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stderr!.on('data', data => { output += data; });
    child.stdout!.on('data', data => { output += data; if (output.includes('Сервер доступен')) { clearTimeout(timeout); done(); } });
  });
}
async function stop() { if (child?.exitCode !== null || child?.signalCode) return; const exited = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 11000); const [code] = await exited; clearTimeout(timer); expect(code).toBe(0); }
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'browser-babel-'));
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>(done => listener.close(() => done()));
  origin = `http://127.0.0.1:${port}`; configFile = join(directory, 'config.json');
  await writeFile(configFile, JSON.stringify({ host: '127.0.0.1', port, clientDir: resolve('dist'), worldDir: resolve('public'), contentDir: resolve('../server/content'), dbPath: join(directory, 'game.sqlite'), defaultMap: 'market', disconnectGraceMs: 100, saveIntervalMs: 100 }));
  await start();
});
test.afterAll(async () => { await stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function login(page: Page, name: string, size?: string, learning = 'en') {
  await page.route('**/config.json', route => route.fulfill({ json: { session: 'online', serverUrl: origin, mapId: 'market', debug: true, chunkRadius: 0 } }));
  await page.goto(origin); await page.getByLabel('Имя игрока').fill(name); await page.getByRole('button', { name: 'Войти', exact: true }).click();
  if (size) {
    await expect(page.getByRole('dialog', { name: 'Подготовка путешествия' })).toBeVisible();
    const select = page.getByLabel('Число игроков'); if (await select.isEnabled()) await select.selectOption(size);
    await page.getByRole('button', { name: 'Далее: языки' }).click(); await page.getByLabel('Изучаемый язык').selectOption(learning);
    await page.getByRole('button', { name: 'Войти в Вавилон' }).click();
    await expect(page.getByRole('dialog', { name: 'Добро пожаловать в Вавилон' })).toBeVisible();
    await expectCapture(page, false); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  await page.bringToFront(); await page.getByRole('button', { name: 'Начать прогулку' }).click(); await expectCapture(page, true);
}
async function menu(page: Page, title: string) {
  await page.bringToFront();
  if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog', { name: 'Пауза' }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: title, exact: true }).click(); await expectCapture(page, false);
}
async function close(page: Page) { await page.getByRole('button', { name: 'Закрыть', exact: true }).click(); }

test('two real players enroll, translate, share stones and restore a private dictionary after restart', async ({ page, context }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, 'Пастух-тест', '2', 'en');
  const other = await context.newPage(); other.on('pageerror', error => errors.push(error.message));
  await login(other, 'Покупатель-тест', '2', 'es');
  await menu(page, 'Задание'); await expect(page.getByRole('dialog', { name: 'Козы пастуха' })).toContainText('white goat'); await close(page);
  await menu(other, 'Задание'); await expect(other.getByRole('dialog', { name: 'Козы пастуха' })).toContainText('Contacta'); await expect(other.getByRole('dialog', { name: 'Козы пастуха' })).not.toContainText('dátiles'); await close(other);
  await menu(page, 'Общение'); await page.getByLabel('Сообщение группе').fill('Купи финики'); await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByLabel('История общения')).toContainText('Доставлено');
  await menu(other, 'Общение'); await expect(other.getByLabel('История общения')).toContainText('Compra dátiles'); await expect(other.getByLabel('История общения')).toContainText('Машинный перевод');
  await other.getByRole('button', { name: 'Запомнить dátiles', exact: true }).click();
  await expect(other.getByLabel('Перевод', { exact: true })).toHaveValue('финики');
  await other.getByLabel('Заметка').fill('Личная запись'); await other.getByRole('button', { name: 'Добавить слово', exact: true }).click(); await expect(other.locator('.word-list')).toContainText('Личная запись'); await close(other);
  await close(page); await menu(page, 'Камень');
  const canvas = page.getByLabel('Камень для рисунка'); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 100, { steps: 5 }); await page.mouse.up();
  await close(page); await menu(page, 'Камень'); await expect(canvas.locator('polyline')).toHaveCount(1);
  await page.getByRole('button', { name: 'Высечь · 0/8', exact: true }).click(); await expect(page.getByLabel('Камень от Пастух-тест')).toBeVisible();
  await menu(other, 'Камень'); await expect(other.getByLabel('Камень от Пастух-тест')).toBeVisible();
  await other.screenshot({ path: 'test-results/babylon-shared-stone.png' });
  await close(page); await menu(page, 'Словарь'); await expect(page.locator('.word-list li')).toHaveCount(0);
  await stop(); await start();
  await login(other, 'Покупатель-тест'); await menu(other, 'Словарь'); await expect(other.locator('.word-list')).toContainText('Личная запись');
  await other.getByRole('button', { name: 'Изменить', exact: true }).click(); await other.getByLabel('Заметка').fill('Исправлено'); await other.getByRole('button', { name: 'Сохранить слово', exact: true }).click(); await expect(other.locator('.word-list')).toContainText('Исправлено');
  await other.screenshot({ path: 'test-results/babylon-dictionary.png' });
  await other.close(); expect(errors).toEqual([]);
});

async function position(page: Page) {
  const text = (await page.getByLabel('Положение игрока').textContent())!;
  const values = text.match(/X (-?[\d.]+) · Z (-?[\d.]+)/)!;
  return { x: Number(values[1]), z: Number(values[2]) };
}
async function walk(page: Page, axis: 'x' | 'z', target: number) {
  for (let i = 0; i < 200; i++) {
    const here = (await position(page))[axis]; if (Math.abs(here - target) <= .3 + 1e-6) return;
    const key = axis === 'x' ? (here < target ? 'd' : 'a') : (here < target ? 's' : 'w');
    await page.keyboard.down(key); await page.waitForTimeout(Math.max(140, Math.min(220, Math.abs(here - target) / 3 * 1000)));
    await page.keyboard.up(key); await page.waitForTimeout(150);
  }
  throw new Error(`Blocked at ${JSON.stringify(await position(page))}, ${axis}=${target}`);
}
async function interact(page: Page, name: string) { await page.keyboard.press('e'); await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible(); await expectCapture(page, false); }
async function resume(page: Page) { await close(page); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expectCapture(page, true); }

test('solo buys and feeds through the real server, rejects wrong food and restores the completed task', async ({ page }) => {
  test.setTimeout(150000);
  await login(page, 'Соло-тест', '1');
  await walk(page, 'z', .5); await walk(page, 'x', -2); await interact(page, 'Торговец фруктами');
  await page.getByLabel('Вопрос NPC').fill('Расскажи о финиках'); await page.getByRole('button', { name: 'Спросить', exact: true }).click();
  await expect(page.locator('.dialog-history')).toContainText('test merchant reply');
  for (const name of ['Финики', 'Красные плоды', 'Жёлтые фрукты']) { await page.getByRole('button', { name: `Купить: ${name}`, exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Предмет добавлен' })).toBeVisible(); }
  await resume(page); await walk(page, 'z', -1); await walk(page, 'x', 2.4); await interact(page, 'Гончар');
  await page.getByRole('button', { name: 'Купить: Вода в кувшине', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Предмет добавлен' })).toBeVisible();
  await resume(page); await walk(page, 'x', 0); await walk(page, 'z', -31); await walk(page, 'x', 2);
  await interact(page, 'Чёрная коза'); await page.getByRole('button', { name: 'Финики · 1', exact: true }).click(); await page.getByRole('button', { name: 'Дать выбранный корм' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Коза отказалась' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Финики · 1', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Красные плоды · 1', exact: true }).click(); await page.getByRole('button', { name: 'Дать выбранный корм' }).click(); await expect(page.getByText('Уже накормлена.', { exact: false })).toBeVisible();
  await resume(page); await walk(page, 'x', -3); await interact(page, 'Белая коза'); await page.getByRole('button', { name: 'Финики · 1', exact: true }).click(); await page.getByRole('button', { name: 'Дать выбранный корм' }).click(); await expect(page.getByText('Уже накормлена.', { exact: false })).toBeVisible();
  await resume(page); await walk(page, 'z', -35); await interact(page, 'Рыжая коза'); await page.getByRole('button', { name: 'Жёлтые фрукты · 1', exact: true }).click(); await page.getByRole('button', { name: 'Дать выбранный корм' }).click(); await expect(page.getByText('Уже накормлена.', { exact: false })).toBeVisible();
  await resume(page); await walk(page, 'x', 3); await interact(page, 'Светло-серый козлёнок'); await page.getByRole('button', { name: 'Вода в кувшине · 1', exact: true }).click(); await page.getByRole('button', { name: 'Дать выбранный корм' }).click();
  await expect(page.getByRole('dialog', { name: 'Козы пастуха' })).toContainText('All four goats have been fed');
  await page.screenshot({ path: 'test-results/babylon-solo-complete.png' });
  await stop(); await start(); await login(page, 'Соло-тест'); await menu(page, 'Задание'); await expect(page.getByRole('dialog', { name: 'Козы пастуха' })).toContainText('All four goats have been fed');
});
