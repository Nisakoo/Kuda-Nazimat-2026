import { expect, test } from '@playwright/test';
import { expectCapture } from './helpers';

test.beforeEach(async ({ page }) => { await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'demo' } })); });

test('streams a nearby region, blocks a slow boundary and stays within its reserved budget', async ({ page }) => {
  let release!: () => void;
  const delayed = new Promise<void>((done) => { release = done; });
  const requests = new Set<string>();
  await page.route('**/config.json', (route) => route.fulfill({ json: { debug: true, chunkRadius: 0 } }));
  await page.route('**/maps/demo/chunks/0_1.json', async (route) => { await delayed; await route.continue(); });
  page.on('request', (request) => { if (request.url().includes('/maps/')) requests.add(request.url()); });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать прогулку' }).click();
  await expectCapture(page, true);
  const canvas = await page.locator('canvas').elementHandle();
  await page.keyboard.down('s');
  await page.clock.runFor(4000);
  await expect(page.getByText('Соседний участок ещё загружается.', { exact: false })).toBeVisible();
  const coords = page.getByLabel('Положение игрока');
  const stopped = await coords.textContent();
  await page.clock.runFor(1000);
  await expect(coords).toHaveText(stopped!);
  expect(Number(stopped!.match(/Z ([\d.]+)/)![1])).toBeLessThan(16);
  release();
  await expect.poll(async () => { await page.clock.runFor(200); return coords.textContent(); }).not.toBe(stopped);
  await page.clock.runFor(1200);
  await page.keyboard.up('s');
  await expect(page.getByRole('button', { name: 'Сады науки', exact: true })).toBeVisible();
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
  const cache = await page.getByLabel('Кеш мира').textContent();
  const [used, limit] = cache!.match(/^([\d]+) \/ ([\d]+)/)!.slice(1).map(Number);
  expect(used!).toBeLessThanOrEqual(limit!);
  expect(requests.size).toBeLessThan(12);
  await page.screenshot({ path: 'test-results/world-region.png' });
});

test('manifest failure leaves the loop responsive and an explicit retry prepares the world', async ({ page }) => {
  let unavailable = true;
  await page.route('**/manifest.json', (route) => unavailable ? route.fulfill({ status: 503 }) : route.continue());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить участок мира');
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeDisabled();
  unavailable = false;
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await page.getByRole('button', { name: 'Начать прогулку' }).click();
  await expectCapture(page, true);
  await expect(page.locator('canvas')).toHaveCount(1);
});
