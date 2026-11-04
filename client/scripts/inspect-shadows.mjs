import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [origin, destination, mode = 'all'] = process.argv.slice(2);
if (!origin || !destination) throw new Error('Usage: node scripts/inspect-shadows.mjs URL DIRECTORY');
const output = resolve(destination); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const quality of mode === 'cache' ? [] : ['low', 'balanced', 'high']) {
    for (const variant of ['baseline', 'tight', 'snap']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
      const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/e2e/shadow-harness.html?quality=${quality}&shadow=${variant}`); await page.waitForFunction(() => !!window.shadowHarness);
      await page.evaluate(() => {
        const stream = document.querySelector('canvas').captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 2000000 });
        const chunks = []; recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        window.shadowFixtureRecording = { recorder, stream, chunks }; recorder.start();
      });
      await page.waitForTimeout(1500);
      const first = await page.evaluate(() => window.shadowHarness.stats());
      const inventory = await page.evaluate(() => window.shadowHarness.inventory());
      await page.screenshot({ path: resolve(output, `${quality}-${variant}-first.png`) });
      await page.evaluate(() => window.shadowHarness.pose(0, false)); await page.waitForTimeout(700);
      await page.screenshot({ path: resolve(output, `${quality}-${variant}-third.png`) });
      await page.evaluate(() => window.shadowHarness.pose(0, true));
      const matrices = [];
      for (let step = 0; step < 15; step++) {
        await page.evaluate(x => window.shadowHarness.pose(x, true), (step - 7) * .002);
        await page.waitForTimeout(80);
        const state = await page.evaluate(() => window.shadowHarness.stats()); matrices.push({ x: (step - 7) * .002, matrix: state.shadowMatrix });
      }
      const video = await page.evaluate(async () => {
        const { recorder, stream, chunks } = window.shadowFixtureRecording;
        const result = new Promise(resolve => { recorder.onstop = () => { stream.getTracks().forEach(track => track.stop());
          const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
        }; }); recorder.stop(); return result;
      });
      await writeFile(resolve(output, `${quality}-${variant}-motion.webm`), Buffer.from(video, 'base64'));
      const closed = await page.evaluate(() => window.shadowHarness.dispose()); await context.close();
      await writeFile(resolve(output, `${quality}-${variant}.json`), JSON.stringify({ quality, variant, fixture: 'synthetic receiver, behind-camera wall and far visible wall; quality only, video encoding affects timings', first, inventory, matrices, closed, errors }));
      if (errors.length || closed.budget.memory || first.behindVisibleInMain || (quality !== 'low' && !inventory.groups.some(group => group.pass === 'shadow' && group.path.includes('behind-camera-caster')))) throw new Error(`Shadow fixture failed ${quality}/${variant}`);
      console.log(`${quality}/${variant}: behind-camera caster verified; disposed; video saved`);
    }
  }
  for (const quality of ['balanced', 'high']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }); const page = await context.newPage();
    await page.goto(`${origin}/e2e/measurement-harness.html?quality=${quality}`); await page.waitForFunction(() => !!window.measurementHarness);
    await page.evaluate(() => window.measurementHarness.open(false)); await page.waitForTimeout(1500);
    await page.evaluate(() => window.measurementHarness.startCacheAudit()); await page.waitForTimeout(2500);
    const standing = await page.evaluate(() => window.measurementHarness.stopCacheAudit());
    await page.evaluate(() => { window.measurementHarness.start(false); window.measurementHarness.seekRoute(15); window.measurementHarness.startCacheAudit(); });
    await page.waitForTimeout(2500);
    const moving = await page.evaluate(() => { const result = window.measurementHarness.stopCacheAudit(); window.measurementHarness.stop(); return result; });
    await writeFile(resolve(output, `${quality}-cache.json`), JSON.stringify({ standing, movingFromRouteSecond15: moving, note: 'Subset of invalidators on real market; cache not installed; no timing claim.' }, null, 2));
    await page.evaluate(() => window.measurementHarness.close()); await context.close();
    if (standing.overflow || moving.overflow || !standing.frames || !moving.frames) throw new Error('Cache audit unavailable');
    console.log(`${quality}: cache audit ${standing.unchanged}/${standing.frames} unchanged standing frames`);
  }
} finally { await browser.close(); }
