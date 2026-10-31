import { expect, test } from '@playwright/test';
import { expectCapture, resume } from './helpers';

test('local build renders with external access blocked and handles resize, pause and restart', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    return new URL(route.request().url()).origin === 'http://127.0.0.1:4173'
      ? route.continue() : route.abort();
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Сцена открыта');
  const canvas = page.getByRole('img', { name: 'Трёхмерная сцена' });
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveJSProperty('width', 1280);
  await expect(canvas).toHaveJSProperty('height', 800);
  await page.screenshot({ path: 'test-results/foundation-desktop.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toHaveJSProperty('width', 390);
  await expect(canvas).toHaveJSProperty('height', 844);
  await page.screenshot({ path: 'test-results/foundation-mobile.png' });
  await page.getByRole('button', { name: 'Начать прогулку' }).click();
  await expectCapture(page, true);
  await page.keyboard.press('Escape');
  await expectCapture(page, false);
  await expect(page.getByRole('status')).toHaveText('Просмотр приостановлен');
  await resume(page);
  await expect(page.getByRole('status')).toHaveText('Сцена открыта');
  for (let cycle = 0; cycle < 5; cycle++) {
    const previous = await canvas.elementHandle();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Перезапустить сцену', exact: true }).click();
    await expectCapture(page, true);
    await expect(canvas).toHaveCount(1);
    expect(await previous?.evaluate((element) => element.isConnected)).toBe(false);
    // The old native context is deliberately lost, not merely detached from DOM.
    expect(await previous?.evaluate((element) => (element as HTMLCanvasElement).getContext('webgl2')?.isContextLost())).toBe(true);
    await previous?.dispose();
    await expect(page.getByRole('status')).toHaveText('Сцена открыта');
  }
  expect(requests.every((url) => new URL(url).origin === 'http://127.0.0.1:4173')).toBe(true);
  expect(requests.some((url) => /\/(maps|assets\/models)\//.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

test('unavailable WebGL shows a useful error and no canvas', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).startsWith('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('WebGL 2');
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect(page.getByRole('alert')).toContainText('WebGL 2');
});

test('runtime config can select the explicitly unavailable online mode', async ({ page }) => {
  const connections: string[] = [];
  page.on('websocket', (socket) => connections.push(socket.url()));
  await page.route('**/config.json', (route) => route.fulfill({
    json: { session: 'online', serverUrl: 'http://school.local' },
  }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Сетевой режим');
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(connections).toEqual([]);
});

test('missing config remains visible in the interface', async ({ page }) => {
  await page.route('**/config.json', (route) => route.fulfill({ status: 503 }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
});

test('invalid runtime config is rejected before creating the scene', async ({ page }) => {
  await page.route('**/config.json', (route) => route.fulfill({ json: { chunkRadius: -1 } }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Радиус чанков');
  await expect(page.locator('canvas')).toHaveCount(0);
});
