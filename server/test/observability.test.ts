import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger, memoryLogger, type LogRecord } from '../src/common/logger.ts';
import { MetricsRegistry } from '../src/common/metrics.ts';
import { consoleSink, fanOut, FileSink } from '../src/obs/sinks.ts';
import { FlightRecorder } from '../src/obs/recorder.ts';
import { evaluateHealth, type HealthInputs } from '../src/obs/health.ts';
import * as responders from '../src/npc/adapters/index.ts';
import { hashToken } from '../src/auth/AuthService.ts';
import { lanAddresses } from '../src/common/network.ts';
import { defer, setup } from './harness.ts';

const temp = (): string => { const dir = mkdtempSync(join(tmpdir(), 'obs-')); defer(async () => rmSync(dir, { recursive: true, force: true })); return dir; };
const lines = (file: string): Record<string, unknown>[] => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

describe('logger and sinks (OBS-001–002)', () => {
  it('writes the catalogue shape with runId, monotonic seq, bound context and serialized errors; a failing sink is contained', () => {
    const records: LogRecord[] = []; let calls = 0;
    const logger = createLogger(fanOut(() => { calls++; throw new Error('broken sink'); }, (record) => { records.push(record); }), 'run1', () => Date.UTC(2026, 10, 1));
    const child = logger.child('realtime', { playerId: 'p1' });
    child.info('realtime.join', 'Вход в мир', { mapId: 'test', event: 'spoof' });
    child.error('http.failed', 'Ошибка', { error: Object.assign(new Error('boom'), { code: 'EBOOM' }) });
    expect(calls).toBe(2);
    expect(records[0]).toMatchObject({ ts: '2026-11-01T00:00:00.000Z', seq: 1, runId: 'run1', level: 'info', module: 'realtime', event: 'realtime.join', msg: 'Вход в мир', playerId: 'p1', mapId: 'test', field_event: 'spoof' });
    expect(records[1]).toMatchObject({ seq: 2, level: 'error', error: { name: 'Error', message: 'boom', code: 'EBOOM', stack: expect.stringContaining('boom') } });
    const out: string[] = []; const sink = consoleSink('warn', (line) => out.push(line));
    for (const record of records) sink(record);
    expect(out).toHaveLength(1); expect(out[0]).toMatch(/^00:00:00\.000 ERROR \[realtime\] Ошибка \(http\.failed\)/); expect(out[0]).toContain('boom');
  });

  it('S3: the file sink rotates, keeps the directory under its limit, drops old files and survives an unwritable directory', () => {
    const dir = temp(); let now = Date.UTC(2026, 10, 1);
    writeFileSync(join(dir, 'server-20260101-old.jsonl'), 'x\n'); utimesSync(join(dir, 'server-20260101-old.jsonl'), new Date(2026, 0, 1), new Date(2026, 0, 1));
    const sink = new FileSink({ dir, runId: 'r', minLevel: 'debug', maxFileBytes: 20_000, maxTotalBytes: 60_000, retentionMs: 14 * 86_400_000, now: () => now });
    expect(existsSync(join(dir, 'server-20260101-old.jsonl'))).toBe(false);
    const logger = createLogger(sink.sink, 'r', () => now);
    for (let i = 0; i < 2000; i++) { logger.debug('test.event', 'Событие', { i, pad: 'x'.repeat(100) }); if (i % 50 === 0) sink.flush(); }
    sink.close();
    const files = readdirSync(dir);
    expect(files.some((name) => /-r-\d+\.jsonl$/.test(name))).toBe(true);
    expect(files.reduce((total, name) => total + readFileSync(join(dir, name)).length, 0)).toBeLessThanOrEqual(60_000 + 20_000);
    expect(lines(join(dir, files.sort().at(-1)!)).every((record) => record.event === 'test.event' && typeof record.seq === 'number')).toBe(true);
    const reports: string[] = [];
    writeFileSync(join(dir, 'blocker'), 'a file, not a directory');
    const broken = new FileSink({ dir: join(dir, 'blocker', 'nested'), runId: 'b', minLevel: 'debug', maxFileBytes: 1000, maxTotalBytes: 10_000, retentionMs: 1, report: (event) => reports.push(event) });
    createLogger(broken.sink, 'b').error('x.failed', 'Ошибка');
    broken.close(); now += 1;
    expect(reports).toContain('log.sink.failed');
  });

  it('S2: an error dumps the preceding debug history and a snapshot; dumps are rate-limited unless forced', () => {
    const dir = temp(); let now = 0;
    const recorder = new FlightRecorder({ dir, runId: 'r', capacity: 100, now: () => now, snapshot: () => ({ seats: 2 }) });
    const logger = createLogger(recorder.sink, 'r', () => now);
    for (let i = 0; i < 150; i++) logger.debug('http.request', 'HTTP-запрос', { i });
    logger.warn('auth.login.failed', 'Неудача'); logger.error('http.failed', 'Ошибка обработчика');
    const dumps = () => readdirSync(dir).filter((name) => name.startsWith('incident-'));
    expect(dumps()).toHaveLength(1);
    const [header, snapshot, ...records] = lines(join(dir, dumps()[0]!));
    expect(header).toMatchObject({ type: 'incident', reason: 'http.failed', records: 100 });
    expect(snapshot).toEqual({ type: 'snapshot', snapshot: { seats: 2 } });
    expect(records.at(-1)).toMatchObject({ event: 'http.failed' }); expect(records[0]).toMatchObject({ event: 'http.request', i: 52 });
    now = 1000; logger.error('http.failed', 'Ещё ошибка'); expect(dumps()).toHaveLength(1);
    now = 2000; expect(recorder.dump('operator')).toMatch(/incident-/); expect(dumps()).toHaveLength(2);
    expect(recorder.warnings().map((r) => r.event)).toEqual(['auth.login.failed', 'http.failed', 'http.failed']);
  });
});

describe('metrics and health (OBS-007, 010)', () => {
  it('keeps counters, gauges and histograms with bucket counts and a JSON snapshot', () => {
    const metrics = new MetricsRegistry();
    metrics.counter('auth_attempts_total', 'Попытки').inc({ method: 'login', outcome: 'ok' }, 2);
    metrics.gauge('game_players', 'Игроки', () => [{ labels: { state: 'connected' }, value: 3 }]);
    const tick = metrics.histogram('game_tick_duration_ms', 'Шаг', [1, 5, 10]);
    for (const value of [0.5, 0.7, 3, 20]) tick.observe(value);
    expect(metrics.histogramCounts('game_tick_duration_ms')).toEqual({ buckets: [1, 5, 10], counts: [2, 1, 0, 1] });
    expect(metrics.value('game_players', { state: 'connected' })).toBe(3);
    expect(metrics.total('auth_attempts_total', (labels) => labels.method === 'login')).toBe(2);
    expect(metrics.has('game_players')).toBe(true); expect(metrics.has('missing')).toBe(false);
    expect(metrics.snapshot().game_tick_duration_ms).toEqual([{ labels: {}, count: 4, sum: 24.2, p50: 1, p95: Infinity }]);
    expect(metrics.value('auth_attempts_total', { outcome: 'ok' })).toBe(2);
    expect(() => metrics.gauge('auth_attempts_total', 'x')).toThrow();
  });

  it('applies the OBS-010 rules, including slow network and low FPS per player', () => {
    const base: HealthInputs = { tickP95Ms: 1, broadcastP95Ms: 100, eventLoopP99Ms: 5, npcReady: true, languageReady: true, timeoutShare: 0, dbErrors5m: 0, logDropped5m: 0, diskFreeBytes: 10 * 1024 ** 3, players: [] };
    expect(evaluateHealth(base)).toEqual({ level: 'green', reasons: [] });
    expect(evaluateHealth({ ...base, tickP95Ms: 8, npcReady: false }).level).toBe('yellow');
    expect(evaluateHealth({ ...base, tickP95Ms: 25 }).level).toBe('red');
    expect(evaluateHealth({ ...base, dbErrors5m: 1 }).level).toBe('red');
    expect(evaluateHealth({ ...base, diskFreeBytes: 100 * 1024 ** 2 }).level).toBe('red');
    const unstable = evaluateHealth({ ...base, players: [{ name: 'Аня', rttMs: 20, reconnects: 3 }] });
    expect(unstable.reasons.map((r) => r.text)).toEqual([expect.stringContaining('Нестабильная связь у игрока Аня')]);
    const slow = evaluateHealth({ ...base, players: [{ name: 'Соня', rttMs: 172, reconnects: 0, fps: 27 }, { name: 'Мира', rttMs: 150, reconnects: 0, fps: 30 }, { name: 'Артём', rttMs: null, reconnects: 0, fps: null }] });
    expect(slow.level).toBe('yellow');
    expect(slow.reasons.map((r) => r.text)).toEqual(['Медленная сеть у игрока Соня (ping 172 мс)', 'У игрока Соня тормозит картинка (27 FPS)']);
  });
});

describe('invariants and crashes (OBS-003, 005)', () => {
  it('an uncaught exception is logged as fatal with its stack and a dump, then the process exits with 1', () => {
    const dir = temp();
    const obs = new URL('../src/obs/index.ts', import.meta.url).href;
    const script = join(dir, 'crash.mjs');
    writeFileSync(script, `import { createObservability, installProcessHooks } from ${JSON.stringify(obs)};
      const o = createObservability({ consoleLevel: 'fatal', fileLevel: 'debug', dir: ${JSON.stringify(dir)}, maxFileMb: 1, maxTotalMb: 10, retentionDays: 1 }, { runId: 'crash' });
      installProcessHooks(o); o.logger.debug('before.crash', 'Перед падением');
      setTimeout(() => { throw new Error('неожиданная ошибка'); }, 10);`);
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 20_000 });
    expect(result.status).toBe(1);
    const log = lines(join(dir, readdirSync(dir).find((name) => name.startsWith('server-'))!));
    expect(log.find((r) => r.event === 'process.uncaught')).toMatchObject({ level: 'fatal', error: { message: 'неожиданная ошибка', stack: expect.stringContaining('crash.mjs') } });
    const incident = readdirSync(dir).find((name) => name.startsWith('incident-'))!;
    expect(lines(join(dir, incident)).some((r) => r.event === 'before.crash')).toBe(true);
  });
});

describe('end to end (OBS-006, 008, 010, 011)', () => {
  it('S5/S6/S7/S13: no secrets or texts anywhere; status groups, history and dumps work; health explains problems', async () => {
    const factory = vi.spyOn(responders, 'createResponder').mockReturnValue({ async start() { throw new Error('no model'); }, async stop() {}, async answer() { throw new Error('unused'); } });
    const dir = temp(); const metrics = new MetricsRegistry(); const records: LogRecord[] = [];
    let state: () => unknown = () => null;
    const recorder = new FlightRecorder({ dir, runId: 'e2e', snapshot: () => ({ metrics: metrics.snapshot(), state: state() }) });
    const logger = createLogger(fanOut((r) => { records.push(r); }, recorder.sink), 'e2e');
    let server: Awaited<ReturnType<typeof setup>>;
    try { server = await setup({ host: '0.0.0.0', auth: { passwordless: false }, monitoring: { pingIntervalMs: 1000 } }, undefined, 'test', logger, { metrics, recorder, setSnapshot: (next) => { state = next; } }); }
    finally { factory.mockRestore(); }
    const { post, connect, origin, port } = server;
    const registered = (await post('/api/auth/register', { name: 'Аня', password: 'секрет12' })).body as { token: string };
    await fetch(`${origin}/api/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId: 'ksu' }) });
    for (let i = 0; i < 3; i++) { const c = await connect(registered.token); c.command('join', { mapId: 'test' }); await c.wait((p) => p.type === 'joined'); if (i < 2) c.socket.disconnect(); }
    const live = await connect(registered.token); live.command('join', { mapId: 'test' }); await live.wait((p) => p.type === 'joined');
    const chat = live.command('chat-send', { text: 'тайное слово' }); await live.wait((p) => p.type === 'chat' && p.requestId === chat);
    live.command('npc-question', { targetId: 'guide', text: 'секретный вопрос' }); await live.wait((p) => p.type === 'error');
    await expect.poll(async () => ((await (await fetch(`${origin}/api/operator/status`)).json()) as { players: { rttMs: number | null }[] }).players[0]?.rttMs, { timeout: 5000 }).not.toBeNull();
    const status = await (await fetch(`${origin}/api/operator/status`)).json() as { health: { level: string; reasons: { text: string }[] }; players: { reconnects: number }[]; warnings: unknown[] };
    expect(status.health.level).toBe('yellow');
    expect(status.health.reasons.map((r) => r.text)).toEqual(expect.arrayContaining(['Персонажи (NPC) недоступны', expect.stringContaining('Нестабильная связь у игрока Аня')]));
    expect(status.warnings.length).toBeGreaterThan(0);
    const self = `http://127.0.0.1:${port}`;
    expect(status).toMatchObject({
      server: { env: 'test', uptimeSeconds: expect.any(Number) }, overview: { seats: { used: 1, max: 4 }, connected: 1, unstable: 1, npcCount: 1 },
      tick: { p95Ms: null }, memory: { rssBytes: expect.any(Number) }, npcStats: { maxUnfinished: 4 }, errors: { hour: { total: null } },
      thresholds: { rttMs: 150, fps: 30 },
    });
    expect((status as unknown as { players: Record<string, unknown>[] }).players[0]).toMatchObject({ name: 'Аня', fps: null, reportAgeSeconds: null });
    const dump = await post('/api/operator/actions/dump', {}, { Origin: self, 'X-Operator': '1' });
    expect(dump.status).toBe(200); expect(existsSync(dump.body!.file)).toBe(true);
    expect(lines(dump.body!.file)[1]).toMatchObject({ type: 'snapshot', snapshot: { metrics: expect.any(Object), state: { game: expect.any(Object), history: expect.any(Array) } } });
    const history = await (await fetch(`${origin}/api/operator/history`)).text();
    expect(JSON.parse(history)).toMatchObject({ stepMs: 10_000, series: { seated: [], tickP95Ms: [], rssBytes: [] }, players: {}, thresholds: { seats: 4 } });
    expect((await fetch(`${origin}/metrics`)).status).toBe(404);
    const lan = lanAddresses().find((a) => a.kind !== 'link-local');
    if (lan) {
      for (const path of ['/metrics', '/api/operator/metrics', '/api/operator/history', '/api/operator/status']) {
        expect((await fetch(`http://${lan.address}:${port}${path}`, { headers: { Authorization: 'Bearer anything' } })).status, path).toBe(404);
      }
    }
    const outputs = [JSON.stringify(records), history, JSON.stringify(status), await (await fetch(`${origin}/api/operator/metrics`)).text(), ...readdirSync(dir).map((name) => readFileSync(join(dir, name), 'utf8'))].join('\n');
    for (const secret of ['секрет12', registered.token, hashToken(registered.token), 'тайное слово', 'секретный вопрос', 'scrypt$']) expect(outputs, secret).not.toContain(secret);
    expect(records.map((r) => r.event)).toEqual(expect.arrayContaining(['app.start', 'auth.register', 'realtime.connect', 'realtime.join', 'game.seat.attach', 'realtime.disconnect', 'http.request', 'npc.responder.unavailable', 'app.ready']));
  });

  it('S8: client reports are authenticated, validated, rate-limited per kind and logged without control characters', async () => {
    const logger = memoryLogger();
    const { post } = await setup({}, undefined, 'test', logger);
    const { token } = (await post('/api/auth/dev', {})).body as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    expect((await post('/api/telemetry/client', { v: 1, kind: 'error', message: 'x' })).status).toBe(401);
    for (const invalid of [{ v: 1, kind: 'error', extra: 1 }, { v: 2, kind: 'error' }, { v: 1, kind: 'perf', fps: 60 }, { v: 1, kind: 'perf', visible: true }, { v: 1, kind: 'perf', fps: 2000, visible: true }, { v: 1, kind: 'perf', fps: 60, visible: 'yes' }, { v: 1, kind: 'perf', fps: 60, visible: true, drawCalls: 1.5 }])
      expect((await post('/api/telemetry/client', invalid, auth)).status, JSON.stringify(invalid)).toBe(400);
    const errors: number[] = []; const perf: number[] = [];
    for (let i = 0; i < 12; i++) errors.push((await post('/api/telemetry/client', { v: 1, kind: 'error', message: 'TypeError: x\u0007', stack: 'at y', fps: 58 }, auth)).status);
    for (let i = 0; i < 13; i++) perf.push((await post('/api/telemetry/client', { v: 1, kind: 'perf', fps: 58, visible: true, frameMs: 21, drawCalls: 140, map: 'test' }, auth)).status);
    expect(errors).toEqual([...Array(10).fill(204), 429, 429]);
    expect(perf).toEqual([...Array(12).fill(204), 429]);
    expect(logger.records.find((r) => r.event === 'client.error')).toMatchObject({ level: 'warn', message: 'TypeError: x', stack: 'at y', fps: 58 });
    expect(logger.records.find((r) => r.event === 'client.perf')).toMatchObject({ level: 'debug', fps: 58, visible: true, frameMs: 21, drawCalls: 140 });
  });

  it('S10: the last visible perf report shows per player; a hidden tab does not count; no report means no data', async () => {
    const { post, connect, origin } = await setup();
    const join = async (name: string) => {
      const { token } = (await post('/api/auth/dev', { name })).body as { token: string };
      const c = await connect(token); c.command('join', { mapId: 'test' }); await c.wait((p) => p.type === 'joined');
      return { Authorization: `Bearer ${token}` };
    };
    const fast = await join('Мира'); const slow = await join('Соня'); await join('Артём');
    expect((await post('/api/telemetry/client', { v: 1, kind: 'perf', fps: 58, visible: true, frameMs: 18, drawCalls: 120 }, fast)).status).toBe(204);
    expect((await post('/api/telemetry/client', { v: 1, kind: 'perf', fps: 22, visible: true }, slow)).status).toBe(204);
    const status = async () => (await (await fetch(`${origin}/api/operator/status`)).json()) as { health: { reasons: { text: string }[] }; players: { name: string; fps: number | null; frameMs: number | null; drawCalls: number | null; visible: boolean | null; reportAgeSeconds: number | null }[]; overview: { avgFps: number | null } };
    let current = await status();
    const by = (name: string) => current.players.find((p) => p.name === name)!;
    expect(by('Мира')).toMatchObject({ fps: 58, frameMs: 18, drawCalls: 120, visible: true, reportAgeSeconds: 0 });
    expect(by('Соня')).toMatchObject({ fps: 22, visible: true });
    expect(by('Артём')).toMatchObject({ fps: null, visible: null, reportAgeSeconds: null });
    expect(current.overview.avgFps).toBe(40);
    expect(current.health.reasons.map((r) => r.text)).toContain('У игрока Соня тормозит картинка (22 FPS)');
    expect((await post('/api/telemetry/client', { v: 1, kind: 'perf', fps: 3, visible: false }, slow)).status).toBe(204);
    current = await status();
    expect(by('Соня')).toMatchObject({ fps: null, visible: false });
    expect(current.health.reasons.map((r) => r.text).some((text) => text.includes('тормозит'))).toBe(false);
  });
});
