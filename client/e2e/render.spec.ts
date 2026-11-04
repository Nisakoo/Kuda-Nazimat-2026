import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.goto('/e2e/render-harness.html'); await page.waitForFunction(() => Boolean(window.renderHarness)); });

test('opt-in market measurements bound queries and release world, instances and targets', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/e2e/measurement-harness.html?quality=balanced');
  await page.waitForFunction(() => !!window.measurementHarness);
  const cold = await page.evaluate(() => window.measurementHarness.open(false));
  expect(cold.queries?.status).toBe('disabled');
  expect(cold.budget.memory).toBeLessThanOrEqual(128 * 1024 * 1024);
  expect(cold.render!.chunks.length).toBeLessThanOrEqual(25);
  await page.evaluate(() => window.measurementHarness.start(true));
  await page.waitForTimeout(1000);
  const captured = await page.evaluate(() => window.measurementHarness.stop());
  expect(captured.measurement!.samples.some(sample => sample.submitted && sample.calls > 0 && sample.triangles > 0)).toBe(true);
  expect(captured.measurement!.gpu.queries).toBeLessThanOrEqual(4);
  if (captured.measurement!.gpu.status === 'unavailable') expect(captured.measurement!.samples.every(sample => sample.gpuMs === null)).toBe(true);
  for (let cycle = 0; cycle < 5; cycle++) {
    const closed = await page.evaluate(() => window.measurementHarness.close());
    expect(closed.render!.models).toBe(0); expect(closed.render!.instances).toBe(0);
    expect(closed.render!.geometries).toBe(0); expect(closed.render!.textures).toBe(0);
    expect(closed.resources!.instanceBytes).toBe(0); expect(closed.resources!.shadowTargets).toBe(0);
    expect(closed.releasedBudget.memory).toBe(0); expect(closed.releasedBudget.resources).toBe(0);
    expect(closed.chunks!.ready).toBe(0); expect(closed.render!.chunks).toEqual([]);
    if (cycle < 4) await page.evaluate(() => window.measurementHarness.open(true));
  }
  expect(errors).toEqual([]);
});

test('instanced marks use one surface draw without multi-draw and release the shared budget', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const getExtension = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = new Proxy(getExtension, { apply(target, context, args) {
      if (/multi_draw/i.test(String(args[0]))) return null;
      return Reflect.apply(target, context, args);
    } });
  });
  await page.goto('/e2e/measurement-harness.html?quality=balanced&marks=instanced');
  await page.waitForFunction(() => !!window.measurementHarness);
  await page.evaluate(() => window.measurementHarness.open(false));
  await page.evaluate(() => window.measurementHarness.start(false));
  await page.waitForTimeout(10000);
  await page.evaluate(() => { window.measurementHarness.stop(); window.measurementHarness.at(0); });
  const inventory = await page.evaluate(() => window.measurementHarness.inventory());
  const batches = inventory.groups.filter(group => group.path.at(-1) === 'pellet-batch');
  expect(inventory.resources!.pelletMarks).toBe(96); expect(batches).toHaveLength(1);
  expect(batches[0]!.instances).toBe(96); expect(batches[0]!.calls).toBe(1);
  expect(inventory.render!.chunks.length).toBeLessThanOrEqual(25);
  expect(inventory.budget.memory).toBeLessThanOrEqual(128 * 1024 * 1024);
  await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    gl.clientWaitSync = () => gl.TIMEOUT_EXPIRED;
  });
  const unloaded = await page.evaluate(() => window.measurementHarness.unloadVisual('0_0'));
  expect(unloaded.resources!.pelletMarks).toBe(0);
  for (let cycle = 0; cycle < 5; cycle++) {
    const closed = await page.evaluate(() => window.measurementHarness.close());
    expect(closed.releasedBudget.memory).toBe(0); expect(closed.render!.instances).toBe(0);
    expect(closed.resources!.instanceBytes).toBe(0); expect(closed.render!.geometries).toBe(0);
    if (cycle < 4) await page.evaluate(() => window.measurementHarness.open(false, 'instanced'));
  }
});

for (const quality of ['low', 'balanced', 'high'] as const) test(`split shadow/main timers recover from real WebGL context loss (${quality})`, async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/e2e/shadow-harness.html?quality=${quality}&shadow=baseline`);
  await page.waitForFunction(() => !!window.shadowHarness);
  await expect.poll(() => page.evaluate(() => window.shadowHarness.stats().submissions)).toBeGreaterThan(3);
  const initial = await page.evaluate(() => window.shadowHarness.stats());
  expect(initial.behindVisibleInMain).toBe(false);
  const inventory = await page.evaluate(() => window.shadowHarness.inventory());
  expect(inventory!.groups.some(group => group.pass === 'shadow' && group.path.includes('behind-camera-caster'))).toBe(quality !== 'low');
  const beforeLoss = initial.frames;
  const lostAt = await page.evaluate(() => { const at = performance.now(); window.shadowHarness.lose(); return at; });
  await expect.poll(() => page.evaluate(() => window.shadowHarness.stats().render.errors.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.shadowHarness.stats().frames)).toBeGreaterThan(beforeLoss + 3);
  await page.waitForTimeout(100);
  await page.evaluate(() => window.shadowHarness.restore());
  await expect.poll(() => page.evaluate(() => window.shadowHarness.stats().render.errors)).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.shadowHarness.stats().submissions)).toBeGreaterThan(initial.submissions + 3);
  await expect.poll(() => page.evaluate(({ lostAt, enabled }) => window.shadowHarness.stats().measurement!.samples.some(sample => sample.at > lostAt && sample.gpuMainMs !== null && (!enabled || sample.gpuShadowMs !== null)), { lostAt, enabled: quality !== 'low' })).toBe(true);
  const restored = await page.evaluate(() => window.shadowHarness.stats());
  const size = quality === 'low' ? 0 : quality === 'balanced' ? 1024 : 2048;
  expect(restored.resources.shadow!.mapSize).toEqual([size, size]); expect(restored.resources.shadowTargets).toBe(quality === 'low' ? 0 : 1);
  expect(restored.measurement!.gpu.queries).toBeLessThanOrEqual(4);
  const closed = await page.evaluate(() => window.shadowHarness.dispose());
  expect(closed.budget.memory).toBe(0); expect(closed.resources.shadowTargets).toBe(0); expect(errors).toEqual([]);
});

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
