import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expectCapture } from './helpers';

test.beforeEach(async ({ page }) => { await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'demo' } })); });

for (const mapId of ['demo', 'market']) test(`profiles ${mapId} sixty seconds offline and checks retained resources after five complete restarts`, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const external: string[] = []; const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') { external.push(url.href); return route.abort(); }
    if (url.pathname === '/config.json') return route.fulfill({ json: { mapId, debug: true, chunkRadius: 1 } });
    return route.continue();
  });
  await page.goto('/');
  if (mapId === 'market') await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Начать прогулку' }).click(); await expectCapture(page, true);
  // Radius is an upper bound: large landmark assets may evict a distant chunk to keep the 10% cap.
  await expect.poll(async () => Number((await page.getByLabel('Кеш мира').textContent())!.match(/Чанки: (\d+)/)![1])).toBeGreaterThanOrEqual(mapId === 'market' ? 2 : 9);
  await expect(page.getByLabel('Кеш мира')).toContainText('Ожидание: 0');
  await page.waitForTimeout(5000);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize as number; };
  const resources = async () => {
    const text = (await page.getByLabel('Ресурсы сцены').textContent())!;
    return { drawCalls: Number(text.match(/Draw (\d+)/)![1]), geometries: Number(text.match(/Геометрии (\d+)/)![1]), textures: Number(text.match(/Текстуры (\d+)/)![1]) };
  };
  const baselineResources = await resources();
  const baselineHeap = await heap();
  const environment = await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!; const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string : 'unavailable', viewport: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio };
  });
  const samples: { fps: number; p95: number; drawCalls: number; cacheBytes: number; cacheLimit: number }[] = [];
  for (let step = 0; step < 12; step++) {
    const key = Math.floor(step / 3) % 2 === 0 ? 's' : 'w';
    await page.keyboard.down(key); await page.waitForTimeout(5000); await page.keyboard.up(key);
    const performance = (await page.getByLabel('Производительность').textContent())!;
    const cache = (await page.getByLabel('Кеш мира').textContent())!;
    samples.push({ fps: Number(performance.match(/FPS ([\d.]+)/)![1]), p95: Number(performance.match(/P95 ([\d.]+)/)![1]), drawCalls: (await resources()).drawCalls, cacheBytes: Number(cache.match(/^(\d+)/)![1]), cacheLimit: Number(cache.match(/\/ (\d+)/)![1]) });
    if (step % 3 === 2) { await page.mouse.move(700, 400); await page.mouse.move(715, 400); }
  }
  const heaps: number[] = [];
  const counts: Awaited<ReturnType<typeof resources>>[] = [];
  for (let cycle = 0; cycle < 5; cycle++) {
    await page.keyboard.press('Escape'); await expectCapture(page, false);
    const old = await page.locator('canvas').elementHandle();
    await page.getByRole('button', { name: 'Перезапустить сцену', exact: true }).click();
    if (mapId === 'market') await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Начать прогулку' }).click(); await expectCapture(page, true);
    // Radius is an upper bound: large landmark assets may evict a distant chunk to keep the 10% cap.
  await expect.poll(async () => Number((await page.getByLabel('Кеш мира').textContent())!.match(/Чанки: (\d+)/)![1])).toBeGreaterThanOrEqual(mapId === 'market' ? 2 : 9);
  await expect(page.getByLabel('Кеш мира')).toContainText('Ожидание: 0');
    await page.waitForTimeout(1200);
    expect(await old!.evaluate((element) => (element as HTMLCanvasElement).getContext('webgl2')!.isContextLost())).toBe(true);
    await old!.dispose();
    heaps.push(await heap()); counts.push(await resources());
  }
  const report = { measuredAt: new Date().toISOString(), environment, baselineHeap, baselineResources, samples, heaps, counts, external, errors };
  await writeFile(testInfo.outputPath('client-profile.json'), JSON.stringify(report, null, 2));
  await testInfo.attach('client-profile', { body: Buffer.from(JSON.stringify(report)), contentType: 'application/json' });
  console.log(JSON.stringify({ environment, minFps: Math.min(...samples.map((s) => s.fps)), maxP95: Math.max(...samples.map((s) => s.p95)), maxDrawCalls: Math.max(...samples.map((s) => s.drawCalls)), baselineHeap, heaps, baselineResources, counts }));
  expect(external).toEqual([]); expect(errors).toEqual([]);
  expect(Math.min(...samples.map((s) => s.fps))).toBeGreaterThanOrEqual(30);
  expect(Math.max(...samples.map((s) => s.p95))).toBeLessThanOrEqual(50);
  expect(Math.max(...samples.map((s) => s.drawCalls))).toBeLessThanOrEqual(500);
  for (const sample of samples) expect(sample.cacheBytes).toBeLessThanOrEqual(sample.cacheLimit);
  expect(heaps.at(-1)! - baselineHeap).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(counts.every((count) => count.geometries === baselineResources.geometries && count.textures === baselineResources.textures)).toBe(true);
});
