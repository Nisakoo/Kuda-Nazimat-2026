// Isolated native-Web-Audio smoke test, not game-route acceptance or listening evidence.
// From repository root: PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium node client/src/audio/browser-smoke.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const client = new URL('../../', import.meta.url);
const port = 5199;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: client, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = ''; server.stdout.on('data', chunk => { serverOutput += chunk; }); server.stderr.on('data', chunk => { serverOutput += chunk; });
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* Wait for local Vite. */ }
    if (attempt >= 100 || server.exitCode !== null) throw Error(`Vite did not start: ${serverOutput}`);
    await delay(100);
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
  const page = await browser.newPage();
  const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => requests.push(request.url()));
  await page.route(`${origin}/audio-smoke`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Native audio smoke</title><button id="unlock">User action: enable audio</button><script type="module">import {WorldAudio} from "/src/audio/WorldAudio.ts"; import {WorldBudget} from "/src/map/WorldBudget.ts"; window.AudioModule={WorldAudio,WorldBudget};</script>' }));
  await page.goto(`${origin}/audio-smoke`);
  await page.waitForFunction(() => window.AudioModule);
  await page.evaluate(() => {
    const { WorldAudio, WorldBudget } = window.AudioModule;
    window.budget = new WorldBudget(); window.starts = 0; window.contexts = [];
    window.makeAudio = () => new WorldAudio(window.budget, { createContext: () => {
      const context = new AudioContext(); window.contexts.push(context);
      const original = context.createBufferSource.bind(context);
      context.createBufferSource = () => { const source = original(); const start = source.start.bind(source); source.start = (...args) => { window.starts++; start(...args); }; return source; };
      return context;
    } });
    localStorage.removeItem('babylon.world-audio.volume.v1');
    window.audio = window.makeAudio();
    document.querySelector('#unlock').onclick = () => { window.unlocked = window.audio.unlock(); };
    window.audio.message({ id: 'before', stream: 'chat', sequence: 0, origin: 'live' });
  });
  assert.deepEqual(await page.evaluate(() => ({ contexts: window.contexts.length, sources: window.audio.stats.sources, volume: window.audio.volume })), { contexts: 0, sources: 0, volume: 0.3 });
  await page.click('#unlock'); await page.evaluate(() => window.unlocked);
  assert.equal(await page.evaluate(() => window.audio.stats.unlocked), true);
  // Show one fresh player message; native source and real local WAV must be used.
  await page.evaluate(() => window.audio.message({ id: 'first', stream: 'chat', sequence: 1, origin: 'live' }));
  await page.waitForFunction(() => window.audio.stats.buffers === 1);
  await page.waitForFunction(() => window.starts === 1);
  await page.evaluate(() => {
    window.audio.message({ id: 'first', stream: 'chat', sequence: 1, origin: 'live' });
    window.audio.message({ id: 'old', stream: 'chat', sequence: 2, origin: 'history' });
    window.audio.message({ id: 'old', stream: 'chat', sequence: 2, origin: 'live' });
    window.audio.movement({ entityId: 'p', tick: 1, position: { x: 0, y: 0, z: 0 }, grounded: true, sprinting: false, jumpStarted: false, origin: 'snapshot' });
    window.audio.movement({ entityId: 'p', tick: 2, position: { x: 0, y: 0, z: 0 }, grounded: true, sprinting: true, jumpStarted: false, origin: 'live' });
  });
  assert.equal(await page.evaluate(() => window.starts), 1);
  const movement = async (tick, x, extra = {}) => page.evaluate(({ tick, x, extra }) => window.audio.movement({ entityId: 'p', tick, position: { x, y: 0, z: 0 }, grounded: true, sprinting: false, jumpStarted: false, origin: 'live', ...extra }), { tick, x, extra });
  await movement(3, 0.8); await page.waitForFunction(() => window.audio.stats.buffers === 2);
  await movement(4, 0.8, { grounded: false, jumpStarted: true }); await page.waitForFunction(() => window.audio.stats.buffers === 3);
  await movement(5, 0.8); await movement(6, 1.8, { sprinting: true }); await page.waitForFunction(() => window.audio.stats.buffers === 4);
  for (let chunk = 0; chunk < 115; chunk++) { await page.evaluate(() => { for (let frame = 0; frame < 4; frame++) window.audio.update(0.25); }); await delay(2); }
  await page.waitForFunction(() => window.audio.stats.buffers === 7);
  const warm = await page.evaluate(() => ({ stats: window.audio.stats, budget: window.budget.stats, starts: window.starts }));
  assert.ok(warm.starts >= 7); assert.ok(warm.stats.sources <= 8); assert.ok(warm.budget.peakMemory < 4 * 1024 * 1024);
  await page.evaluate(() => window.audio.setVolume(0));
  assert.deepEqual(await page.evaluate(() => ({ volume: window.audio.volume, sources: window.audio.stats.sources })), { volume: 0, sources: 0 });
  const startsAtZero = await page.evaluate(() => window.starts);
  await page.evaluate(() => window.audio.message({ id: 'silent', stream: 'chat', sequence: 3, origin: 'live' }));
  assert.equal(await page.evaluate(() => window.starts), startsAtZero);
  const cycles = await page.evaluate(async () => {
    const results = []; window.audio.dispose();
    for (let cycle = 0; cycle < 5; cycle++) {
      const audio = window.makeAudio();
      if (audio.volume !== 0) throw Error('Persisted zero missing');
      audio.setVolume(0.3); await audio.unlock();
      audio.message({ id: `cycle-${cycle}`, stream: 'chat', sequence: cycle, origin: 'live' });
      while (audio.stats.pending) await new Promise(resolve => setTimeout(resolve, 5));
      audio.dispose(); audio.setVolume(0); // Disposed changes must do nothing.
      results.push({ ...audio.stats, budget: window.budget.stats.memory });
      localStorage.setItem('babylon.world-audio.volume.v1', '0');
    }
    return results;
  });
  for (const cycle of cycles) { assert.equal(cycle.sources, 0); assert.equal(cycle.buffers, 0); assert.equal(cycle.reservedBytes, 0); assert.equal(cycle.budget, 0); }
  await page.reload(); await page.waitForFunction(() => window.AudioModule);
  assert.equal(await page.evaluate(() => { const audio = new window.AudioModule.WorldAudio(new window.AudioModule.WorldBudget()); const volume = audio.volume; audio.dispose(); return volume; }), 0);
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => new URL(url).origin === origin));
  const audioRequests = requests.filter(url => /\/assets\/audio\/.+\.wav$/.test(url));
  assert.equal(new Set(audioRequests).size, 7);
  console.log(JSON.stringify({ result: 'PASS', browser: await browser.version(), scope: 'Isolated native Web Audio smoke; no physical listening, route integration, or target-hardware qualification', warm, cycles, localAudioRequests: audioRequests.length, uniqueAudioFiles: new Set(audioRequests).size, pageErrors: errors, externalRequests: requests.filter(url => new URL(url).origin !== origin) }, null, 2));
} finally { await browser?.close(); server.kill('SIGTERM'); }
