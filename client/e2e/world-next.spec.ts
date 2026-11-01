import { expect as baseExpect, test, type Page, type Locator } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
async function expectCapture(page: Page, captured: boolean) {
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(captured);
  if (captured) {
    await expect(page.getByLabel('Руки')).toBeVisible();
    await expect(page.getByLabel('Состояние связи')).toHaveText('Подключён');
  }
}
import type { HandResultMessage, SceneStateMessage, WorldLifeClientMessage } from '../../shared/world-life/types.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import type { MotionStatus } from '../../shared/world/types.ts';
const expect = baseExpect.configure({ timeout: 30000 });
test.use({ actionTimeout: 30000 });
const observedPositions = new WeakMap<Page, { current: { x: number; z: number } | null }>();
async function activate(button: Locator) {
  await expect(button).toBeEnabled();
  // A real keyboard activation keeps user activation without mouse hit-target retries
  // when native Pointer Lock or a native dialog changes the clicked surface.
  await button.press('Enter');
}

declare global {
  interface Window {
    worldAudioProbe: { contexts: number; closed: number; active: number; peak: number; starts: { duration: number; time: number }[] };
    worldPointerProbe: unknown[];
  }
}

// Four simultaneous software-encoded videos distort this functional scenario on small hosts.
// Hardware qualification can opt in; MOVE render videos have their own cadence checks.
test.use({ video: process.env.NEXT_BROWSER_VIDEO === '1' ? 'on' : 'off' });
test.beforeEach(async ({ context, page }) => {
  const log = (target: Page) => target.on('console', message => { if (message.text().startsWith('NEXT pointer probe')) console.log(message.text()); });
  log(page); context.on('page', log);
  await context.addInitScript(() => {
    window.worldPointerProbe = [];
    const record = (kind: string, extra: Record<string, unknown> = {}) => {
      const event = { kind, at: performance.now(), focus: document.hasFocus(), visibility: document.visibilityState, active: navigator.userActivation.isActive, ...extra };
      window.worldPointerProbe.push(event); if (window.worldPointerProbe.length > 128) window.worldPointerProbe.shift();
      console.info('NEXT pointer probe', JSON.stringify(event));
    };
    const request = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function(options) {
      record('request');
      try {
        const result = request.call(this, options);
        result?.then(() => record('resolve'), error => record('reject', { name: error.name, message: error.message }));
        return result;
      } catch (error) { record('throw', { message: String(error) }); throw error; }
    };
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(options?: AudioContextOptions) { const began = performance.now(); super(options); record('audio-init', { durationMs: performance.now() - began }); }
    };
    for (const kind of ['focus','blur']) window.addEventListener(kind, () => record(kind));
    document.addEventListener('visibilitychange', () => record('visibility'));
    document.addEventListener('pointerlockchange', () => record('change', { locked: Boolean(document.pointerLockElement) }));
  });
});
test.afterEach(async ({ context }, info) => {
  const backendPath = info.outputPath('backend-log.txt'); await writeFile(backendPath, serverOutput);
  await info.attach('backend-log', { path: backendPath, contentType: 'text/plain' });
  for (const [index, page] of context.pages().entries()) {
    const probe = await page.evaluate(() => window.worldPointerProbe).catch(() => null);
    const ui = await page.locator('body').innerText({ timeout: 5000 }).catch(() => 'UI unavailable during cleanup');
    const uiPath = info.outputPath(`final-ui-${index}.txt`); const pointerPath = info.outputPath(`native-pointer-${index}.json`);
    await writeFile(uiPath, ui); await writeFile(pointerPath, JSON.stringify(probe));
    await info.attach(`final-ui-${index}`, { path: uiPath, contentType: 'text/plain' });
    await info.attach(`native-pointer-${index}`, { path: pointerPath, contentType: 'application/json' });
  }
});
function observe(page: Page) {
  const position: { current: { x: number; z: number } | null } = { current: null };
  observedPositions.set(page, position);
  const data: { state: SceneStateMessage | null; results: HandResultMessage[]; sent: WorldLifeClientMessage[]; playerId: string; motion: MotionStatus | null } = { state: null, results: [], sent: [], playerId: '', motion: null };
  const decode = (payload: string | Buffer) => {
    const text = payload.toString(); if (!text.startsWith('42')) return null;
    try { return JSON.parse(text.slice(text.indexOf('['))) as [string, unknown]; } catch { return null; }
  };
  page.on('websocket', socket => {
    socket.on('framereceived', frame => {
      const message = decode(frame.payload);
      if (message?.[0] === 'game') {
        const game = message[1] as ServerMessage;
        if (game.type === 'error') console.log('NEXT game error', JSON.stringify(game));
        if (game.type === 'joined') data.playerId = game.playerId;
        const entities = game.type === 'joined' || game.type === 'snapshot' ? game.snapshot.entities : game.type === 'delta' ? game.upsert : [];
        const self = entities.find(entity => entity.id === data.playerId);
        if (self?.motion) data.motion = self.motion;
        if (self?.transform) position.current = { x: self.transform.position.x, z: self.transform.position.z };
      }
      if (message?.[0] !== 'world-life') return;
      const packet = message[1] as SceneStateMessage | HandResultMessage;
      if (packet.type === 'scene-state') data.state = packet;
      if (packet.type === 'hand-result') data.results.push(packet);
    });
    socket.on('framesent', frame => {
      const message = decode(frame.payload); if (message?.[0] === 'world-life') data.sent.push(message[1] as WorldLifeClientMessage);
    });
  });
  return data;
}

let child: ChildProcess, directory: string, origin: string, configFile: string;
let serverReady = false;
let serverOutput = '';
let expectedServerStop = false;
async function start() {
  serverReady = false; expectedServerStop = false;
  child = spawn(process.execPath, ['../server/src/app/main.ts', '--config', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error(output || 'Server startup timeout')), 60000);
    child.once('exit', code => { clearTimeout(timeout); if (!expectedServerStop) console.error('NEXT unexpected backend exit', code, output); reject(new Error(`Server exited ${code}: ${output}`)); });
    const record = (data: Buffer) => { const text = data.toString(); output += text; serverOutput = (serverOutput + text).slice(-200000); console.log('NEXT backend', text.trim()); };
    child.stderr!.on('data', record);
    child.stdout!.on('data', data => { record(data); if (output.includes('Сервер доступен')) { serverReady = true; clearTimeout(timeout); done(); } });
  });
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const wasReady = serverReady; serverReady = false; expectedServerStop = true;
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 11000);
  const [code] = await exited; clearTimeout(timer); if (wasReady) expect(code).toBe(0);
}
test.beforeAll(async () => {
  test.setTimeout(90000);
  directory = await mkdtemp(join(tmpdir(), 'world-next-browser-'));
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>(done => listener.close(() => done()));
  origin = `http://127.0.0.1:${port}`; configFile = join(directory, 'config.json');
  await writeFile(configFile, JSON.stringify({ host: '127.0.0.1', port, clientDir: resolve('dist'), worldDir: resolve('public'), contentDir: resolve('../server/content'), dbPath: join(directory, 'game.sqlite'), defaultMap: 'market', disconnectGraceMs: 100, saveIntervalMs: 100 }));
  await start();
});
test.afterAll(async () => { await stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function releaseOtherCaptures(page: Page) {
  for (const other of page.context().pages()) if (other !== page && await other.evaluate(() => Boolean(document.pointerLockElement)).catch(() => false)) {
    await other.bringToFront(); await other.keyboard.press('Escape'); await expectCapture(other, false);
  }
}
async function login(page: Page, name: string, size?: string, chunkRadius: number | null = null) {
  await releaseOtherCaptures(page);
  await page.route('**/config.json', route => route.fulfill({ json: { session: 'online', serverUrl: origin, mapId: 'market', debug: true, chunkRadius } }));
  await page.goto(origin); await page.getByLabel('Имя игрока').fill(name);
  await activate(page.getByRole('button', { name: 'Войти', exact: true }));
  if (size) {
    await expect(page.getByRole('dialog', { name: 'Подготовка путешествия' })).toBeVisible();
    const select = page.getByLabel('Число игроков'); if (await select.isEnabled()) await select.selectOption(size);
    await activate(page.getByRole('button', { name: 'Далее: языки' }));
    await page.getByLabel('Изучаемый язык').selectOption('en');
    await activate(page.getByRole('button', { name: 'Войти в Вавилон' }));
    await expect(page.getByRole('dialog', { name: 'Добро пожаловать в Вавилон' })).toBeVisible();
    await activate(page.getByRole('button', { name: 'Закрыть', exact: true }));
  }
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  await page.bringToFront(); await activate(page.getByRole('button', { name: 'Начать прогулку' }));
  await expectCapture(page, true);
}
async function position(page: Page) {
  const observed = observedPositions.get(page)?.current;
  if (observed) return observed;
  const text = (await page.getByLabel('Положение игрока').textContent())!;
  const values = text.match(/X (-?[\d.]+) · Z (-?[\d.]+)/)!;
  return { x: Number(values[1]), z: Number(values[2]) };
}
async function walk(page: Page, axis: 'x' | 'z', target: number) {
  console.log('NEXT walk start', JSON.stringify({ axis, target, position: await position(page) }));
  for (let n = 0; n < 40; n++) {
    const here = (await position(page))[axis]; const distance = Math.abs(here - target);
    if (distance <= .35) { console.log('NEXT walk done', JSON.stringify({ axis, target, position: await position(page) })); return; }
    const direction = Math.sign(target - here);
    const key = axis === 'x' ? (direction > 0 ? 'd' : 'a') : (direction > 0 ? 's' : 'w');
    // Keep the real key down until a real backend delta proves progress. Short pulses
    // can fall entirely between frames on software WebGL and do not prove movement.
    try {
      await page.keyboard.down(key);
      await expect.poll(async () => direction * ((await position(page))[axis] - here), {
        intervals: [50, 100], message: `No authoritative ${key} progress from ${JSON.stringify(await position(page))} toward ${axis}=${target}`,
      }).toBeGreaterThan(distance > 1.5 ? Math.min(2, distance - 1) : .12);
    } finally { await page.keyboard.up(key).catch(() => {}); }
    await page.waitForTimeout(400);
  }
  throw new Error(`Blocked at ${JSON.stringify(await position(page))}, ${axis}=${target}`);
}

async function resume(page: Page) {
  await releaseOtherCaptures(page);
  await page.bringToFront();
  if (!await page.evaluate(() => Boolean(document.pointerLockElement))) {
    await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
    await activate(page.getByRole('button', { name: 'Продолжить', exact: true }));
  }
  await expectCapture(page, true);
}

test('NEXT: four real roles share the scene; physical F carries one durable apple without repeats', async ({ page, context }, testInfo) => {
  test.setTimeout(600000);
  const pages = [page, await context.newPage(), await context.newPage(), await context.newPage()];
  const observed = pages.map(observe);
  const errors: string[] = []; const external: string[] = [];
  for (const player of pages) {
    player.on('pageerror', error => errors.push(error.message));
    player.on('websocket', socket => { if (new URL(socket.url()).host !== new URL(origin).host) external.push(socket.url()); });
    player.on('request', request => { const url = new URL(request.url()); if (url.protocol.startsWith('http') && url.origin !== origin) external.push(url.href); });
  }
  for (let index = 0; index < pages.length; index++) await login(pages[index]!, `NEXT role ${index + 1}`, '4', index === 1 ? null : 0);
  for (const data of observed) await expect.poll(() => data.state?.apples.length).toBe(5);
  const initial = observed.map(data => data.state!);
  expect(new Set(initial.map(state => state.sceneId)).size).toBe(1);
  expect(new Set(initial.map(state => state.epochMs)).size).toBe(1);
  for (const state of initial) {
    expect(state.definition).toEqual(initial[0]!.definition);
    expect(state.definition.cats.map(cat => cat.behavior).sort()).toEqual(['sleep', 'walk', 'wash']);
    expect(state.pots).toHaveLength(4);
    expect(new Set(state.apples.map(apple => apple.id)).size).toBe(5);
    expect(state.definition.flock.count).toBeGreaterThanOrEqual(4);
    expect(state.definition.flock.count).toBeLessThanOrEqual(6);
    expect(state.definition.flock.schedule.periodMs).toBeGreaterThanOrEqual(90000);
    expect(state.definition.flock.schedule.periodMs).toBeLessThanOrEqual(150000);
  }
  const carrier = pages[1]!; const data = observed[1]!;
  await resume(carrier);
  await expect(carrier.getByLabel('Кеш мира')).toContainText('Чанки: 25 · Ожидание: 0 · Отложено: 0');
  const apple = data.state!.apples.find(item => item.state === 'world' && item.position.z > 5 && item.position.z < 15 && Math.abs(item.position.x) < 8);
  if (!apple || apple.state !== 'world') throw new Error('No reachable market route apple');
  // Role2 starts within 2m and has an unobstructed pickup sweep in the production map.
  expect(Math.hypot((await position(carrier)).x - apple.position.x, (await position(carrier)).z - apple.position.z)).toBeLessThanOrEqual(2);
  const before = data.sent.filter(packet => packet.type === 'hand').length;
  await carrier.keyboard.down('f'); await carrier.waitForTimeout(400);
  await carrier.keyboard.down('f'); await carrier.waitForTimeout(600);
  await expect(carrier.getByLabel('Руки')).toContainText('В руках: яблоко');
  expect(data.sent.filter(packet => packet.type === 'hand')).toHaveLength(before + 1);
  await carrier.keyboard.up('f');
  const held = data.state!.apples.find(item => item.state === 'held');
  if (!held || held.state !== 'held') throw new Error('No backend-confirmed held apple');
  expect(held.id).toBe(apple.id);
  for (const other of observed) await expect.poll(() => other.state!.apples.find(item => item.id === held.id)).toEqual(held);
  await carrier.keyboard.down('s'); await carrier.waitForTimeout(350); await carrier.keyboard.up('s');
  await carrier.keyboard.down('ShiftLeft'); await carrier.keyboard.down('s'); await carrier.waitForTimeout(400);
  await carrier.keyboard.press('Space'); await carrier.waitForTimeout(300); await carrier.keyboard.up('s'); await carrier.keyboard.up('ShiftLeft');
  await carrier.screenshot({ path: testInfo.outputPath('carry-move.png') });
  await carrier.waitForTimeout(1000);
  await carrier.keyboard.press('Escape'); await expectCapture(carrier, false);
  await carrier.keyboard.down('f'); await carrier.keyboard.up('f');
  expect(data.sent.filter(packet => packet.type === 'hand')).toHaveLength(before + 1);
  await resume(carrier); await carrier.waitForTimeout(250);
  expect(data.sent.filter(packet => packet.type === 'hand')).toHaveLength(before + 1);
  // Restart while held. The database must preserve the unique apple and its owner.
  await stop(); await start(); await login(carrier, 'NEXT role 2');
  await expect(carrier.getByLabel('Руки')).toContainText('В руках: яблоко');
  await expect.poll(() => data.state?.apples.find(item => item.id === held.id)).toEqual(held);
  expect(data.state!.apples).toHaveLength(5);
  await carrier.screenshot({ path: testInfo.outputPath('restored-hand.png') });
  await carrier.keyboard.press('f');
  await expect(carrier.getByLabel('Руки')).toContainText('Руки свободны');
  await expect.poll(() => data.state!.apples.find(item => item.id === held.id)?.state).toBe('world');
  await carrier.screenshot({ path: testInfo.outputPath('placed-apple.png') });
  await walk(carrier, 'x', 0); await walk(carrier, 'z', -25);
  await expect(carrier.getByRole('heading', { name: 'Пастбище у рынка', exact: true })).toBeVisible();
  await carrier.screenshot({ path: testInfo.outputPath('pasture-live-scene.png') });
  await walk(carrier, 'z', 9); await walk(carrier, 'x', -32);
  await expect(carrier.getByRole('heading', { name: 'Двор Вавилонской башни', exact: true })).toBeVisible();
  await carrier.screenshot({ path: testInfo.outputPath('courtyard-live-scene.png') });
  await walk(carrier, 'x', 0);
  await expect(carrier.getByRole('heading', { name: 'Рынок Вавилона', exact: true })).toBeVisible();
  await expect(carrier.getByLabel('Кеш мира')).toContainText('Чанки: 25 · Ожидание: 0 · Отложено: 0');
  await expect(carrier.getByLabel('Состояние связи')).toContainText('Подключён');
  const scenePath = testInfo.outputPath('scene-contract.json'); await writeFile(scenePath, JSON.stringify({ initial, restored: data.state }));
  await testInfo.attach('scene-contract', { path: scenePath, contentType: 'application/json' });
  expect(errors).toEqual([]); expect(external).toEqual([]);
  for (const player of pages.slice(1)) await player.close();
});

test('NEXT audio: real WebAudio unlock, volume persistence, no repeated jump, and five lifecycle restarts', async ({ page, context }, testInfo) => {
  test.setTimeout(600000);
  const observed = observe(page);
  await page.addInitScript(() => {
    const probe = window.worldAudioProbe = { contexts: 0, closed: 0, active: 0, peak: 0, starts: [] as { duration: number; time: number }[] };
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(options?: AudioContextOptions) { super(options); probe.contexts++; }
      override createBufferSource() {
        const source = super.createBufferSource(); const start = source.start.bind(source);
        source.start = (when = 0, offset = 0, duration?: number) => {
          probe.starts.push({ duration: source.buffer?.duration ?? 0, time: performance.now() });
          probe.active++; probe.peak = Math.max(probe.peak, probe.active);
          source.addEventListener('ended', () => { probe.active--; }, { once: true });
          if (duration === undefined) start(when, offset); else start(when, offset, duration);
        };
        return source;
      }
      override async close() { await super.close(); probe.closed++; }
    };
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, 'NEXT audio', '1');
  await page.keyboard.press('Escape');
  await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Настройки', exact: true }));
  const volume = page.getByRole('slider', { name: 'Громкость', exact: true });
  await expect(volume).toHaveValue('30');
  await volume.focus(); await page.keyboard.press('Home');
  await expect(volume).toHaveValue('0');
  await page.reload(); await page.getByLabel('Имя игрока').fill('NEXT audio');
  await activate(page.getByRole('button', { name: 'Войти', exact: true }));
  await activate(page.getByRole('button', { name: 'Начать прогулку' })); await expectCapture(page, true);
  await page.keyboard.press('Space'); await page.waitForTimeout(1400);
  expect(await page.evaluate(() => window.worldAudioProbe.starts)).toEqual([]);
  console.log('NEXT audio: muted jump is silent; opening settings');
  await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Настройки', exact: true }));
  await expect(volume).toHaveValue('0');
  await volume.evaluate(element => { const slider = element as HTMLInputElement; slider.value = '45'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(volume).toHaveValue('45');
  console.log('NEXT audio: volume45; close settings and resume');
  await activate(page.getByRole('button', { name: 'Закрыть настройки', exact: true })); await resume(page);
  await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Общение', exact: true }));
  const countMumbles = () => page.evaluate(() => window.worldAudioProbe.starts.filter(item => Math.abs(item.duration - .57) < .005).length);
  const mumbleLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/mumble.wav') && response.ok());
  await page.getByLabel('Сообщение группе').fill('Прогрев');
  await activate(page.getByRole('button', { name: 'Отправить', exact: true }));
  await (await mumbleLoaded).finished();
  await page.waitForTimeout(400);
  const oldMumbles = await countMumbles();
  await page.getByLabel('Сообщение группе').fill('Привет');
  await activate(page.getByRole('button', { name: 'Отправить', exact: true }));
  await expect.poll(countMumbles).toBe(oldMumbles + 1);
  await page.waitForTimeout(2200); expect(await countMumbles()).toBe(oldMumbles + 1);
  await activate(page.getByRole('button', { name: 'Закрыть', exact: true })); await resume(page);
  await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Общение', exact: true }));
  await page.waitForTimeout(1300); expect(await countMumbles()).toBe(oldMumbles + 1);
  await activate(page.getByRole('button', { name: 'Закрыть', exact: true })); await resume(page);
  // Warm the local jump clip, then hold the next press through a complete jump.
  await page.keyboard.press('Space'); await page.waitForTimeout(1400);
  const countJumps = () => page.evaluate(() => window.worldAudioProbe.starts.filter(item => Math.abs(item.duration - .28) < .005).length);
  const before = await countJumps(); const beforeAck = observed.motion!.jumpAck;
  await page.keyboard.down('Space');
  await expect.poll(() => observed.motion?.jumpAck ?? 0).toBeGreaterThan(beforeAck);
  await expect.poll(() => observed.motion?.grounded).toBe(true);
  // Repeated keydown after authoritative landing must not become a new press.
  await page.keyboard.down('Space'); await page.waitForTimeout(1400); await page.keyboard.up('Space');
  expect(await countJumps()).toBe(before + 1);
  const steps = await page.evaluate(() => window.worldAudioProbe.starts.filter(item => item.duration < .2).length);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.worldAudioProbe.starts.filter(item => item.duration < .2).length)).toBe(steps);
  const audioMemory = async () => {
    const text = (await page.getByLabel('Звук', { exact: true }).textContent())!;
    const values = text.match(/Источники: (\d+) · Буферы: (\d+) · Загрузки: (\d+) · Память: (\d+)/)!;
    return { sources: Number(values[1]), buffers: Number(values[2]), pending: Number(values[3]), bytes: Number(values[4]) };
  };
  // A new shown question/answer pair and a remote jump produce distinct causal sources.
  await walk(page, 'z', .5); await walk(page, 'x', -2);
  await page.keyboard.press('e');
  await expect(page.getByRole('dialog', { name: 'Торговец фруктами', exact: true })).toBeVisible();
  await page.waitForTimeout(400); const beforeReply = await countMumbles();
  await page.getByLabel('Вопрос NPC').fill('Расскажи о финиках');
  await activate(page.getByRole('button', { name: 'Спросить', exact: true }));
  await expect(page.locator('.dialog-history')).toContainText('test merchant reply');
  await expect.poll(countMumbles).toBe(beforeReply + 2);
  await activate(page.getByRole('button', { name: 'Закрыть', exact: true })); await resume(page);
  const remote = await context.newPage(); await login(remote, 'NEXT audio remote', '1', 0);
  await page.waitForTimeout(1000); const beforeRemote = await countJumps();
  await remote.keyboard.press('Space');
  await expect.poll(countJumps).toBe(beforeRemote + 1);
  await remote.close(); await resume(page);
  // A real backend restart must restore history silently through automatic reconnect.
  const beforeReconnect = await countMumbles(); await stop(); await start();
  await expect(page.getByLabel('Состояние связи')).toContainText('Подключён', { timeout: 30000 });
  await page.waitForTimeout(1400); expect(await countMumbles()).toBe(beforeReconnect);
  await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  await activate(page.getByRole('button', { name: 'Начать прогулку' })); await expectCapture(page, true);
  const audioCycles: (Awaited<ReturnType<typeof audioMemory>> & { worldBytesWithoutAudio: number })[] = [];
  for (let cycle = 0; cycle < 5; cycle++) {
    await page.keyboard.press('Escape'); await activate(page.getByRole('button', { name: 'Перезапустить сцену', exact: true }));
    await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
    await activate(page.getByRole('button', { name: 'Начать прогулку' })); await expectCapture(page, true);
    await expect(page.getByLabel('Звук', { exact: true })).toContainText('Буферы: 0');
    const warmAck = observed.motion!.jumpAck;
    await page.keyboard.press('Space');
    await expect.poll(() => observed.motion?.jumpAck ?? 0).toBeGreaterThan(warmAck);
    await expect.poll(() => observed.motion?.grounded).toBe(true);
    await expect.poll(async () => (await audioMemory()).pending).toBe(0);
    // Cold playback may expire after 250ms. The second jump uses the prepared buffer.
    const prior = await countJumps(); const ack = observed.motion!.jumpAck;
    await page.keyboard.press('Space');
    await expect.poll(() => observed.motion?.jumpAck ?? 0).toBeGreaterThan(ack);
    await expect.poll(() => observed.motion?.grounded).toBe(true);
    await expect.poll(countJumps).toBe(prior + 1);
    await expect.poll(() => page.evaluate(() => window.worldAudioProbe.active)).toBe(0);
    await expect.poll(audioMemory).toMatchObject({ sources: 0, pending: 0 });
    await expect(page.getByLabel('Кеш мира')).toContainText('Чанки: 25 · Ожидание: 0 · Отложено: 0');
    await page.waitForTimeout(300);
    const memory = await audioMemory(); expect(memory.buffers).toBeGreaterThanOrEqual(1); expect(memory.buffers).toBeLessThanOrEqual(7);
    expect(memory.bytes).toBeGreaterThan(0);
    const cache = (await page.getByLabel('Кеш мира').textContent())!.match(/^(\d+) \/ (\d+)/)!;
    expect(Number(cache[1])).toBeLessThanOrEqual(Number(cache[2]));
    expect(Number(cache[2])).toBe(64 * 1024 * 1024);
    audioCycles.push({ ...memory, worldBytesWithoutAudio: Number(cache[1]) - memory.bytes });
  }
  expect(new Set(audioCycles.map(cycle => cycle.worldBytesWithoutAudio)).size).toBe(1);
  const probe = await page.evaluate(() => window.worldAudioProbe);
  expect(probe.contexts - probe.closed).toBe(1); expect(probe.peak).toBeLessThanOrEqual(8);
  await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Настройки', exact: true }));
  await expect(volume).toHaveValue('45');
  await page.screenshot({ path: testInfo.outputPath('volume-persisted.png') });
  await page.reload(); await page.getByLabel('Имя игрока').fill('NEXT audio');
  await activate(page.getByRole('button', { name: 'Войти', exact: true }));
  await activate(page.getByRole('button', { name: 'Начать прогулку' })); await expectCapture(page, true);
  await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Настройки', exact: true }));
  await expect(volume).toHaveValue('45');
  const audioPath = testInfo.outputPath('audio-browser-probe.json'); await writeFile(audioPath, JSON.stringify({ probe, audioCycles }));
  await testInfo.attach('audio-browser-probe', { path: audioPath, contentType: 'application/json' });
  expect(errors).toEqual([]);
});
