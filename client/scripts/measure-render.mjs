import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { summarize } from './render-summary.mjs';

const [origin, directory, mode = 'baseline'] = process.argv.slice(2);
if (!origin || !directory || !['baseline', 'overhead', 'smoke', 'lifecycle', 'batching', 'shadows', 'experiment'].includes(mode)) throw new Error('Usage: node client/scripts/measure-render.mjs URL OUTPUT_DIR [baseline|overhead|smoke|lifecycle|batching|shadows|experiment]');
const output = resolve(directory); await mkdir(output, { recursive: true });
const repetitions = Number(process.env.MEASURE_REPEATS ?? 3);
const warmupSeconds = Number(process.env.MEASURE_WARMUP ?? 0);
if (!Number.isFinite(warmupSeconds) || warmupSeconds < 0 || warmupSeconds > 600) throw new Error('Invalid profile warmup');
const selectedProfiles = (process.env.MEASURE_PROFILES ?? 'low,balanced,high').split(',');
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || (repetitions < 3 && process.env.MEASURE_EXTENSION !== '1') || selectedProfiles.some(profile => !['low', 'balanced', 'high'].includes(profile))) throw new Error('At least three repeats, or an explicit extension; profiles low,balanced,high');
const label = process.env.MEASURE_LABEL ?? mode;
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid label');
if (repetitions < 3 && !label.includes('extension')) throw new Error('An extension must be labelled');
const parameter = process.env.MEASURE_PARAMETER ?? 'detail', candidate = process.env.MEASURE_CANDIDATE ?? 'wind';
if (!['detail', 'frame', 'occlusion', 'cascades'].includes(parameter) || !/^[a-z0-9-]+$/.test(candidate)) throw new Error('Invalid experiment');
const sampleSeconds = Number(process.env.MEASURE_SECONDS ?? 60);
if (!Number.isFinite(sampleSeconds) || sampleSeconds < 2 || sampleSeconds > 60 || (sampleSeconds < 60 && !label.includes('screen'))) throw new Error('Short runs must be labelled screening');
const run = (command, args) => { try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); } catch { return 'unavailable'; } };
const environment = { commit: run('git', ['rev-parse', 'HEAD']), diff: run('git', ['diff', '--stat']),
  os: run('sw_vers', []), hardware: run('system_profiler', ['SPHardwareDataType', 'SPDisplaysDataType']).split('\n').filter(line => !/Serial Number|UUID|UDID/.test(line)).join('\n'),
  power: run('pmset', ['-g', 'batt']), node: process.version, mode, warmupSeconds, repetitions, sampleSeconds, extension: process.env.MEASURE_EXTENSION === '1', capturedAt: new Date().toISOString(),
  scene: 'market; radius 2; isolated renderer, 1 synthetic player; no network/LLM; real local assets; authored presentation route, no simulation',
  cache: 'fresh browser context per profile; Playwright routing disables HTTP cache throughout; new AssetManager/GltfLibrary per open; repeated entry retains browser shader/driver/OS caches',
};
const sourcePaths = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'e2e', 'scripts']).split('\n').filter(Boolean);
environment.sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(resolve(output, `${label}-environment.json`), JSON.stringify(environment, null, 2));
await writeFile(resolve(output, `${label}-working.patch`), run('git', ['diff', '--binary']));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
try {
  const profiles = ['baseline', 'batching', 'shadows', 'experiment'].includes(mode) ? selectedProfiles : ['balanced'];
  for (const quality of profiles) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await context.newPage(); const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origin).origin && /^https?:$/.test(url.protocol)) { external.push(url.href); return route.abort(); }
      return route.continue();
    });
    const location = new URL(`/e2e/measurement-harness.html?quality=${quality}`, origin);
    if (mode === 'shadows') { location.searchParams.set('passes', '1'); location.searchParams.set('shadow', process.env.MEASURE_SHADOW ?? 'baseline'); }
    await page.goto(location.href);
    await page.waitForFunction(() => !!window.measurementHarness);
    const cdp = await context.newCDPSession(page);
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return cdp.send('Runtime.getHeapUsage'); };
    const initial = await page.evaluate(() => window.measurementHarness.open(true));
    await writeFile(resolve(output, `${label}-${quality}-loading.json`), JSON.stringify(initial));
    if (initial.render.errors.length || initial.chunks.errors.length || !initial.render.models) throw new Error('Initial scene incomplete');
    const graphics = await page.evaluate(() => {
      const canvas = document.querySelector('canvas'); const gl = canvas.getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { userAgent: navigator.userAgent, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable', backend: gl.getParameter(gl.VERSION),
        dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], antialias: gl.getContextAttributes().antialias };
    });
    for (let elapsed = 0; elapsed < warmupSeconds; elapsed += 60) {
      await page.evaluate(() => window.measurementHarness.start(false));
      for (let seconds = 0; seconds < Math.min(60, warmupSeconds - elapsed); seconds += 10) {
        await page.waitForTimeout(Math.min(10, warmupSeconds - elapsed - seconds) * 1000);
        console.log(`${mode} ${quality} additional warmup ${elapsed + seconds + 10}s/${warmupSeconds}s`);
      }
      await page.evaluate(() => window.measurementHarness.stop());
    }
    const summaries = [];
    const shadowPairs = mode === 'shadows' && quality !== 'low';
    const rounds = mode === 'smoke' ? [true] : mode === 'lifecycle' ? [] : ['overhead', 'batching', 'experiment'].includes(mode) || shadowPairs ? Array.from({ length: repetitions * 2 }, (_, index) => index % 2 === 1) : Array(repetitions).fill(true);
    for (const [index, toggle] of rounds.entries()) {
      const enabled = ['batching', 'shadows', 'experiment'].includes(mode) ? true : toggle;
      const variant = mode === 'experiment' ? toggle ? candidate : 'baseline' : mode === 'shadows' ? shadowPairs && toggle ? 'snap' : 'baseline' : mode === 'batching' && toggle ? 'instanced' : 'legacy';
      if (mode === 'shadows' || mode === 'experiment') {
        location.searchParams.set(mode === 'shadows' ? 'shadow' : parameter, variant); await page.goto(location.href); await page.waitForFunction(() => !!window.measurementHarness);
        await page.evaluate(() => window.measurementHarness.open(true));
      }
      const entry = mode === 'batching' ? await page.evaluate(variant => window.measurementHarness.open(true, variant), variant) : null;
      // Warm all route windows before steady recording. Chunk transitions during the
      // recorded path remain marked by the live resource/phase data.
      for (const at of [0, 18, 24, 40, 56]) {
        await page.evaluate(t => window.measurementHarness.at(t), at);
        await page.waitForTimeout(750);
      }
      await page.evaluate(() => window.measurementHarness.at(0)); await page.waitForTimeout(5000);
      await page.evaluate(({ enabled, outer }) => window.measurementHarness.start(enabled, outer), { enabled, outer: ['overhead', 'batching', 'shadows', 'experiment'].includes(mode) });
      const seconds = mode === 'smoke' ? 2 : sampleSeconds;
      const checkpoints = [];
      for (let s = 0; s < seconds; s += 10) {
        await page.waitForTimeout(Math.min(10, seconds - s) * 1000);
        checkpoints.push({ seconds: Math.min(s + 10, seconds), stats: await page.evaluate(() => window.measurementHarness.stats()) });
        console.log(`${mode} ${quality} ${index + 1}/${rounds.length} diagnostics=${enabled} variant=${variant}: ${Math.min(s + 10, seconds)}s`);
      }
      const raw = await page.evaluate(() => window.measurementHarness.stop());
      if (['overhead', 'batching'].includes(mode) && !raw.outerRenderCpu?.length) throw new Error('Outer CPU capture missing');
      const result = { quality, enabled, variant, entry, graphics, route: await page.evaluate(() => window.measurementHarness.route), checkpoints, ...raw, summary: summarize(raw), errors: [...errors], external: [...external] };
      summaries.push({ index, enabled, variant, ...result.summary });
      await writeFile(resolve(output, `${label}-${quality}-${index + 1}.json`), JSON.stringify(result));
      if (raw.overflow || raw.measurement?.dropped || errors.length || external.length || checkpoints.some(c => c.stats.render.errors.length || c.stats.chunks.errors.length)) throw new Error('Capture invalid: overflow, incomplete scene, page error or external request');
    }
    const lifecycle = [];
    // Baseline heap is taken after a warm entry, with no retained measurement payload.
    await page.evaluate(() => { window.measurementHarness.start(false); window.measurementHarness.stop(); });
    const warmHeap = await heap();
    for (let cycle = 0; cycle < 5; cycle++) {
      const closed = await page.evaluate(() => window.measurementHarness.close());
      const closedHeap = await heap();
      const cycleMarks = mode === 'batching' || quality !== 'high' ? 'instanced' : 'legacy';
      const reopened = await page.evaluate(marks => window.measurementHarness.open(false, marks), cycleMarks);
      await page.waitForTimeout(1000);
      const openedHeap = await heap();
      lifecycle.push({ cycle: cycle + 1, closed, closedHeap, reopened, openedHeap });
      if (closed.releasedBudget.resources || closed.releasedBudget.memory || closed.render.models || closed.render.instances || closed.render.geometries || closed.render.textures || closed.resources.instanceBytes || closed.resources.shadowTargets || closed.render.chunks.length) throw new Error('Resources retained after close');
      if (openedHeap.usedSize - warmHeap.usedSize > 8 * 1024 * 1024) throw new Error('Retained heap grew by more than 8 MiB');
      console.log(`${mode} ${quality} lifecycle ${cycle + 1}/5`);
    }
    await writeFile(resolve(output, `${label}-${quality}-summary.json`), JSON.stringify({ graphics, summaries, warmHeap, lifecycle, errors, external, powerAtEnd: run('pmset', ['-g', 'batt']) }, null, 2));
    for (const [name, seconds] of [['market', 0], ['courtyard', 18], ['stairs', 24], ['pasture', 40], ['first-person', 52]]) {
      await page.evaluate(seconds => window.measurementHarness.at(seconds), seconds); await page.waitForTimeout(1000);
      await page.screenshot({ path: resolve(output, `${label}-${quality}-${name}.png`) });
    }
    await page.evaluate(() => window.measurementHarness.close()); await context.close();
  }
} finally { await browser.close(); }
