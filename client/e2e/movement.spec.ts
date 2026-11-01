import { expect, test, type Page } from '@playwright/test';
import { expectCapture } from './helpers';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const evidence = process.env.UI_EVIDENCE_DIR ?? 'test-results';
test.beforeAll(async () => { await mkdir(evidence, { recursive: true }); });

async function start(page: Page, mapId = 'demo') {
  await page.route('**/config.json', route => route.fulfill({ json: { mapId, debug: true } }));
  await page.clock.install(); await page.goto('/');
  if (mapId === 'market') await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  await page.getByRole('button', { name: 'Начать прогулку' }).click(); await expectCapture(page, true);
  await page.clock.runFor(200);
}
async function height(page: Page) {
  return Number((await page.getByLabel('Положение игрока').textContent())!.match(/Y (-?[\d.]+)/)![1]);
}
for (const mapId of ['demo', 'science', 'market']) test(`MOVE: ${mapId} supports jump, sprint, stamina HUD and interruption`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page, mapId);
  const ring = page.getByRole('progressbar', { name: 'Выносливость' });
  await expect(ring).toHaveCount(0);
  await page.keyboard.press('Space'); await page.clock.runFor(200);
  await expect.poll(() => height(page)).toBeGreaterThan(.6);
  await page.clock.runFor(1000); await expect.poll(() => height(page)).toBe(0);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('s'); await page.clock.runFor(1000);
  const stock = Number(await ring.getAttribute('aria-valuenow')); expect(stock).toBeGreaterThanOrEqual(70); expect(stock).toBeLessThanOrEqual(80);
  await page.screenshot({ path: join(evidence, `move-${mapId}-sprint.png`) });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expectCapture(page, false); await expect(ring).toHaveCount(0);
  await page.keyboard.up('s'); await page.keyboard.up('ShiftLeft');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expectCapture(page, true);
  await page.clock.runFor(200); await expect.poll(() => height(page)).toBe(0);
  expect(Number(await ring.getAttribute('aria-valuenow'))).toBeLessThan(100);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 640, height: 480 }]) {
  for (const zoom of [1, 2]) test(`MOVE HUD layout ${viewport.width}x${viewport.height} at ${zoom * 100}% equivalent CSS viewport`, async ({ page }) => {
    // A halved CSS viewport exercises the layout reflow of browser 200% zoom.
    await page.setViewportSize({ width: viewport.width / zoom, height: viewport.height / zoom });
    await start(page);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('s'); await page.clock.runFor(1000);
    await page.keyboard.up('s'); await page.keyboard.up('ShiftLeft');
    const ring = page.getByRole('progressbar', { name: 'Выносливость' }); await expect(ring).toBeVisible();
    const bounds = await ring.boundingBox(); expect(bounds!.width).toBe(56); expect(bounds!.height).toBe(56);
    expect(viewport.height / zoom - bounds!.y - bounds!.height).toBeGreaterThanOrEqual(22);
    const card = await page.locator('.stamina').boundingBox();
    expect(card!.x + card!.width).toBeLessThanOrEqual(viewport.width / zoom - 10);
    expect(card!.x + card!.width).toBeGreaterThanOrEqual(viewport.width / zoom - 20);
    expect(card!.y + card!.height).toBeLessThanOrEqual(viewport.height / zoom - 10);
    const overlap = await ring.evaluate(element => {
      const a = element.getBoundingClientRect();
      return [...document.querySelectorAll('.world-actions button, footer > *, header > *')].some(other => {
        const b = other.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      });
    });
    expect(overlap).toBe(false);
    expect(await ring.evaluate(e => getComputedStyle(e.parentElement!).pointerEvents)).toBe('none');
    await page.screenshot({ path: join(evidence, `move-hud-${viewport.width}-${zoom}.png`) });
    await page.keyboard.down('AltLeft'); await expect(ring).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Управление' })).toBeVisible();
    await page.keyboard.up('AltLeft'); await expect(ring).toBeVisible();
  });
}
