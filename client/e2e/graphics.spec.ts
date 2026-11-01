import { expect, test, type Page } from '@playwright/test';
import { expectCapture, resume } from './helpers';

test.use({ deviceScaleFactor: 2 });

async function enter(page: Page) {
  const intro = page.getByRole('button', { name: 'Закрыть', exact: true });
  if (await intro.count()) await intro.first().click();
  await page.getByRole('button', { name: 'Начать прогулку', exact: true }).click();
  await expectCapture(page, true);
}

test('quality profiles persist, recreate antialiasing and cap only the 3D drawing buffer', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'market', debug: true } }));
  await page.goto('/'); await enter(page);
  const buffer = () => page.locator('canvas[aria-label="Трёхмерная сцена"]').evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width, css: canvas.getBoundingClientRect().width, antialias: canvas.getContext('webgl2')!.getContextAttributes()!.antialias,
  }));
  expect((await buffer()).width).toBe(1280);
  for (const quality of ['low', 'high', 'balanced']) {
    await page.keyboard.press('Escape'); await expectCapture(page, false);
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByLabel('Качество графики').selectOption(quality);
    const old = await page.locator('canvas[aria-label="Трёхмерная сцена"]').elementHandle();
    await page.getByRole('button', { name: 'Применить и открыть карту' }).click(); await enter(page);
    expect(await old!.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('webgl2')!.isContextLost())).toBe(true); await old!.dispose();
    const info = await buffer(); expect(info.width).toBe(quality === 'high' ? 2560 : 1280); expect(info.css).toBe(1280);
    expect(info.antialias).toBe(quality !== 'low');
    expect(await page.evaluate(() => localStorage.getItem('world.graphics-quality'))).toBe(quality);
    await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w');
    await page.reload(); await enter(page);
    expect((await buffer()).antialias).toBe(quality !== 'low');
    expect((await buffer()).width).toBe(quality === 'high' ? 2560 : 1280);
  }
  await page.setViewportSize({ width: 1000, height: 700 }); await expect.poll(async () => (await buffer()).width).toBe(1000);
  await page.reload(); await enter(page); expect((await buffer()).width).toBe(1000);
  await expect(page.getByLabel('Производительность')).toContainText('GPU-пропуски');
  expect(errors).toEqual([]);
});

test('GPU backpressure lowers reported FPS while loads, controls and submitted frames keep progressing', async ({ page }) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    localStorage.setItem('world.graphics-quality', 'low');
    const original = WebGL2RenderingContext.prototype.clientWaitSync;
    let polls = 0;
    WebGL2RenderingContext.prototype.clientWaitSync = function(...args) {
      if (++polls % 4 !== 0) return this.TIMEOUT_EXPIRED;
      return original.apply(this, args);
    };
  });
  await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'market', debug: true } }));
  await page.goto('/'); await enter(page);
  await page.waitForTimeout(2500);
  const text = (await page.getByLabel('Производительность').textContent())!;
  const fps = Number(text.match(/^FPS ([\d.]+)/)![1]);
  const loop = Number(text.match(/Цикл ([\d.]+)/)![1]);
  const skips = Number(text.match(/GPU-пропуски (\d+)/)![1]);
  expect(fps).toBeGreaterThan(0); expect(fps).toBeLessThan(loop / 2); expect(skips).toBeGreaterThan(0);
  const before = await page.getByLabel('Положение игрока').textContent();
  await page.keyboard.down('s'); await page.waitForTimeout(1000); await page.keyboard.up('s');
  await expect(page.getByLabel('Положение игрока')).not.toHaveText(before!);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
});

test('optimized scenery streams pasture and tower, climbs stairs and keeps the camera and budget', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'market', debug: true, chunkRadius: 1 } }));
  await page.clock.install(); await page.goto('/'); await enter(page);
  const canvas = await page.locator('canvas').elementHandle();
  const position = async () => {
    const text = (await page.getByLabel('Положение игрока').textContent())!;
    const v = text.match(/X (-?[\d.]+) · Z (-?[\d.]+) · Y (-?[\d.]+)/)!;
    return { x: Number(v[1]), z: Number(v[2]), y: Number(v[3]) };
  };
  const walk = async (axis: 'x' | 'z', destination: number) => {
    for (let i = 0; i < 160; i++) {
      const here = (await position())[axis]; if (Math.abs(here - destination) < .2) return;
      const key = axis === 'x' ? here < destination ? 'd' : 'a' : here < destination ? 's' : 'w';
      await page.keyboard.down(key); await page.clock.runFor(Math.min(200, Math.abs(here - destination) / 3 * 1000));
      await page.keyboard.up(key); await page.clock.runFor(100);
    }
    throw new Error(`Blocked at ${JSON.stringify(await position())}`);
  };
  await walk('z', .5); await walk('x', -2.4); await page.keyboard.press('e');
  await expect(page.getByRole('dialog', { name: 'Торговец фруктами' })).toBeVisible();
  await page.getByRole('button', { name: 'Взять: Финики', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click(); await resume(page);
  await walk('x', 0); await walk('z', -26); await expect(page.getByLabel('Область мира')).toHaveText('Пастбище у рынка');
  await walk('z', 9); await walk('x', -32); await expect(page.getByLabel('Область мира')).toHaveText('Двор Вавилонской башни');
  await walk('x', -23); await walk('z', -4); expect((await position()).y).toBe(3);
  await walk('z', 9); expect((await position()).y).toBe(0); await walk('x', 0);
  await page.mouse.move(500, 350); await page.clock.runFor(200);
  expect(await canvas!.evaluate(element => element.isConnected)).toBe(true);
  const budget = (await page.getByLabel('Кеш мира').textContent())!.match(/^(\d+) \/ (\d+)/)!;
  expect(Number(budget[1])).toBeLessThanOrEqual(Number(budget[2])); expect(errors).toEqual([]);
});
