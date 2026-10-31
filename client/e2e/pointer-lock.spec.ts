import { expect, test } from '@playwright/test';
import { expectCapture, resume } from './helpers';

test.beforeEach(async ({ page }) => { await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'demo' } })); });

test('real pointer lock survives repeated relative movement, releases on loss and resumes with clean input', async ({ page }) => {
  await page.route('**/config.json', (route) => route.fulfill({ json: { debug: true } }));
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать прогулку' }).click();
  await expectCapture(page, true);
  const canvas = page.locator('canvas');
  const before = await canvas.screenshot();
  for (let step = 0; step < 20; step++) await page.mouse.move(650 + step * 60, 440);
  await page.clock.runFor(100);
  await expectCapture(page, true);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  // Zoom remains behind/above the character at both extremes.
  await page.mouse.wheel(0, -10_000);
  await page.clock.runFor(100);
  await page.screenshot({ path: 'test-results/babylon-near-camera.png' });
  await page.mouse.wheel(0, 10_000);
  await page.clock.runFor(100);
  await page.screenshot({ path: 'test-results/babylon-far-camera.png' });
  await page.keyboard.down('w');
  await page.clock.runFor(200);
  await page.evaluate(() => document.exitPointerLock());
  await expectCapture(page, false);
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
  const coords = page.getByLabel('Положение игрока');
  const stopped = await coords.textContent();
  await page.keyboard.up('w');
  await page.evaluate(() => document.dispatchEvent(new Event('pointerlockchange')));
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
  await resume(page);
  await page.clock.runFor(400);
  await expect(coords).toHaveText(stopped!);
  await page.keyboard.press('Escape');
  await expectCapture(page, false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
});

test('denied capture keeps controls blocked and a new user click can retry', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.requestPointerLock;
    let denied = false;
    Element.prototype.requestPointerLock = function (this: Element, options) {
      if (!denied) { denied = true; return Promise.reject(new DOMException('Denied', 'NotAllowedError')); }
      return original.call(this, options);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать прогулку' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось захватить мышь');
  await expectCapture(page, false);
  await expect(page.getByRole('button', { name: 'На главный экран' })).toBeVisible();
  await page.keyboard.press('w');
  await page.getByRole('button', { name: 'Повторить захват', exact: true }).click();
  await expectCapture(page, true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('missing pointer lock offers a clear error, retry and a route back to the main screen', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Element.prototype, 'requestPointerLock', { value: undefined, configurable: true }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать прогулку' }).click();
  await expect(page.getByRole('alert')).toContainText('не поддерживает захват мыши');
  await expectCapture(page, false);
  await expect(page.getByRole('button', { name: 'Повторить захват', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'На главный экран' }).click();
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
