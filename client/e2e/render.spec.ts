import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.goto('/e2e/render-harness.html'); await page.waitForFunction(() => Boolean(window.renderHarness)); });

test('shares real GPU resources across two static groups and a dynamic model, then releases the last owner', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => { if (request.url().endsWith('tablet.glb')) requests++; });
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().geometries)).toBeGreaterThan(0);
  const baseline = await page.evaluate(() => window.renderHarness.stats().geometries);
  const baselineTextures = await page.evaluate(() => window.renderHarness.stats().textures);
  await page.evaluate(() => { window.renderHarness.entity(true); });
  expect(await page.evaluate(() => Promise.all([window.renderHarness.load('west'), window.renderHarness.load('east')]))).toEqual(['ready', 'ready']);
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().instances)).toBe(3);
  expect(requests).toBe(1);
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().geometries)).toBeGreaterThan(baseline);
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().textures)).toBeGreaterThan(baselineTextures);
  const loaded = await page.evaluate(() => window.renderHarness.stats().geometries);
  await page.evaluate(() => window.renderHarness.unload('west'));
  expect(await page.evaluate(() => window.renderHarness.stats().instances)).toBe(2);
  expect(await page.evaluate(() => window.renderHarness.stats().geometries)).toBe(loaded);
  await page.evaluate(() => window.renderHarness.unload('east'));
  expect(await page.evaluate(() => window.renderHarness.stats().entities)).toContain('dynamic');
  expect(await page.evaluate(() => window.renderHarness.stats().instances)).toBe(1);
  await page.evaluate(() => window.renderHarness.entity(false));
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().models)).toBe(0);
  expect(await page.evaluate(() => window.renderHarness.stats().geometries)).toBe(baseline);
  expect(await page.evaluate(() => window.renderHarness.stats().textures)).toBe(baselineTextures);
  await page.evaluate(() => window.renderHarness.dispose());
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('imports glTF with a local external buffer and spreads many cloned visuals across frames', async ({ page }) => {
  const frames = await page.evaluate(() => window.renderHarness.stats().frames);
  expect(await page.evaluate(() => window.renderHarness.load('json', 'tablet-json', 32))).toBe('ready');
  const stats = await page.evaluate(() => window.renderHarness.stats());
  expect(stats.frames - frames).toBeGreaterThanOrEqual(4);
  expect(stats.instances).toBe(32);
  expect(stats.models).toBe(1);
  expect(stats.errors).toEqual([]);
});

test('a failed model load keeps frames running and a fresh attempt succeeds', async ({ page }) => {
  let failed = false;
  await page.route('**/tablet.glb', (route) => { if (!failed) { failed = true; return route.fulfill({ status: 503 }); } return route.continue(); });
  expect(await page.evaluate(() => window.renderHarness.load('west'))).toBe('Error');
  expect(await page.evaluate(() => window.renderHarness.stats().errors.length)).toBe(1);
  const frames = await page.evaluate(() => window.renderHarness.stats().frames);
  expect(await page.evaluate(() => window.renderHarness.load('west'))).toBe('ready');
  expect(await page.evaluate(() => window.renderHarness.stats().frames)).toBeGreaterThan(frames);
  expect(await page.evaluate(() => window.renderHarness.stats().errors)).toEqual([]);
});

test('unloading while HTTP is pending prevents a late visual from appearing', async ({ page }) => {
  let finish: (() => void) | undefined;
  await page.route('**/tablet.glb', async (route) => { await new Promise<void>((resolve) => { finish = resolve; }); await route.continue().catch(() => {}); });
  const request = page.waitForRequest('**/tablet.glb');
  const pending = page.evaluate(() => window.renderHarness.load('west'));
  await request;
  await page.evaluate(() => window.renderHarness.unload('west'));
  finish?.();
  expect(await pending).toBe('AbortError');
  expect(await page.evaluate(() => window.renderHarness.stats().chunks)).toEqual([]);
  expect(await page.evaluate(() => window.renderHarness.stats().instances)).toBe(0);
});

test('NEXT data-only catalogue placement shares duplicate prefabs and releases their owners', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => window.renderHarness.catalogueFrame());
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().pending)).toBe(0);
  const loaded = await page.evaluate(() => window.renderHarness.stats());
  expect(loaded.instances).toBe(6); expect(loaded.models).toBe(5); expect(loaded.errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('catalogue-placement.png') });
  await page.evaluate(() => window.renderHarness.unload('catalogue-preview'));
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().models)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().instances)).toBe(0);
  expect(errors).toEqual([]);
});

test('NEXT shared-scene fixture renders three cats and one flock, then releases unloaded chunk owners', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => window.renderHarness.lifeFrame('cats'));
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().pending)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().entities.filter(id => id.startsWith('cat-')).length)).toBe(3);
  await page.screenshot({ path: testInfo.outputPath('three-cat-states.png') });
  await page.evaluate(() => window.renderHarness.lifeFrame('flock'));
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().entities.filter(id => id.startsWith('flock:')).length)).toBe(5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('shared-flock.png') });
  const loaded = await page.evaluate(() => window.renderHarness.stats());
  // The scheduled flock can expire while a software-rendered screenshot is captured.
  expect(loaded.models).toBeGreaterThanOrEqual(4); expect(loaded.models).toBeLessThanOrEqual(5); expect(loaded.errors).toEqual([]);
  await page.evaluate(() => window.renderHarness.unload('0_0'));
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().entities)).toEqual(['preview']);
  await expect.poll(() => page.evaluate(() => window.renderHarness.stats().models)).toBe(1);
  expect(errors).toEqual([]);
});

test.describe('MOVE poses', () => {
  for (const carrying of [false, true]) for (const fps of [30, 60]) for (const view of ['front', 'side']) test(`four player ${carrying ? 'pickup-carry-place' : 'poses'} at ${fps} FPS from ${view}`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const running = page.evaluate(({ fps, yaw, carrying }) => window.renderHarness.movement(fps, yaw, carrying), { fps, yaw: view === 'front' ? 0 : Math.PI / 2, carrying });
    await page.waitForTimeout(1750); await page.screenshot({ path: testInfo.outputPath('sprint.png') });
    await page.waitForTimeout(600); await page.screenshot({ path: testInfo.outputPath('jump.png') });
    const { video, ...profile } = await running;
    const videoPath = testInfo.outputPath('movement.webm'); await writeFile(videoPath, Buffer.from(video, 'base64'));
    await testInfo.attach('movement', { path: videoPath, contentType: 'video/webm' });
    await testInfo.attach('cadence', { body: JSON.stringify(profile), contentType: 'application/json' });
    await writeFile(testInfo.outputPath('cadence.json'), JSON.stringify(profile, null, 2));
    console.log('Render cadence:', JSON.stringify(profile));
    expect(profile.completed).toBe(true);
    expect(profile.actualFps).toBeGreaterThan(fps * .8);
    expect(profile.simulatedFrames).toBeGreaterThanOrEqual(fps * 4);
    const entities = (await page.evaluate(() => window.renderHarness.stats())).entities;
    expect(entities.filter(id => id.startsWith('move-'))).toHaveLength(4);
    if (carrying) {
      expect(entities.filter(id => id.startsWith('apple-'))).toHaveLength(5);
      expect(entities.filter(id => id.startsWith('cat-'))).toHaveLength(3);
      expect(entities.filter(id => id.startsWith('pot-'))).toHaveLength(4);
    }
    expect(errors).toEqual([]);
  });
});
