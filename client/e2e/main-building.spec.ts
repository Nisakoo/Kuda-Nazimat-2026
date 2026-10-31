import { expect, test, type Page } from '@playwright/test';
import { expectCapture } from './helpers';

async function position(page: Page) {
  const text = (await page.getByLabel('Положение игрока').textContent())!;
  const values = text.match(/X (-?[\d.]+) · Z (-?[\d.]+) · Y (-?[\d.]+)/)!;
  return { x: Number(values[1]), z: Number(values[2]), y: Number(values[3]) };
}
async function walk(page: Page, axis: 'x' | 'z', target: number) {
  for (let i = 0; i < 160; i++) {
    const here = (await position(page))[axis];
    if (Math.abs(here - target) < .2) return;
    const key = axis === 'x' ? (here < target ? 'd' : 'a') : (here < target ? 's' : 'w');
    await page.keyboard.down(key);
    await page.clock.runFor(Math.min(200, Math.abs(here - target) / 3 * 1000));
    await page.keyboard.up(key); await page.clock.runFor(100);
  }
  throw new Error(`Blocked: ${JSON.stringify(await position(page))}, ${axis}=${target}`);
}

test('building courtyard streams from market, stairs rise to landing, symbols toggle and return preserves the session', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'market', debug: true, chunkRadius: 0 } }));
  await page.clock.install(); await page.goto('/');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Начать прогулку' }).click(); await expectCapture(page, true);
  await page.clock.runFor(300);
  await walk(page, 'z', 9); await walk(page, 'x', -32); await walk(page, 'z', 10);
  await expect(page.getByRole('heading', { name: 'Двор Вавилонской башни', exact: true })).toBeVisible();
  await page.addStyleTag({ content: '.debug { visibility: hidden; }' });
  await page.screenshot({ path: 'test-results/building-courtyard.png' });
  await page.keyboard.press('Escape');
  await page.getByLabel('Символы над башней').uncheck();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.clock.runFor(300); await page.screenshot({ path: 'test-results/building-without-symbols.png' });
  await walk(page, 'z', 9); await walk(page, 'x', -23); await walk(page, 'z', -4);
  expect((await position(page)).y).toBe(3);
  await page.screenshot({ path: 'test-results/building-landing.png' });
  // The railing prevents stepping sideways off the raised platform.
  const before = await position(page);
  await page.keyboard.down('d'); await page.clock.runFor(1000); await page.keyboard.up('d'); await page.clock.runFor(100);
  const after = await position(page); expect(after.y).toBe(3); expect(after.x - before.x).toBeLessThan(1);
  await walk(page, 'x', -23); await walk(page, 'z', 9); expect((await position(page)).y).toBe(0);
  await walk(page, 'x', 0);
  await expect(page.getByRole('heading', { name: 'Рынок Вавилона', exact: true })).toBeVisible();
  const budget = (await page.getByLabel('Кеш мира').textContent())!.match(/^(\d+) \/ (\d+)/)!;
  expect(Number(budget[1])).toBeLessThanOrEqual(Number(budget[2]));
  expect(errors).toEqual([]);
});

test('default streaming loads the landmark while the player is still on the market', async ({ page }) => {
  await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'market', debug: true } }));
  const building = page.waitForResponse(response => response.url().endsWith('/main-building.glb') && response.status() === 200);
  await page.goto('/'); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await building;
  const start = page.getByRole('button', { name: 'Начать прогулку' }); const box = (await start.boundingBox())!;
  await start.click(); await expectCapture(page, true);
  // Rotate west with real pointer-lock input; keep the market spawn as the observation point.
  await page.mouse.move(box.x + box.width / 2 - 290, box.y + box.height / 2 - 120, { steps: 20 });
  await page.addStyleTag({ content: '.debug { visibility: hidden; }' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/building-from-market.png' });
  const budget = (await page.getByLabel('Кеш мира').textContent())!.match(/^(\d+) \/ (\d+)/)!;
  expect(Number(budget[1])).toBeLessThanOrEqual(Number(budget[2]));
});
