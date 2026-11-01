import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryLogger } from '../src/common/logger.ts';
import { BROADCAST_MS_BUCKETS, FAST_MS_BUCKETS, MS_BUCKETS, MetricsRegistry, RTT_MS_BUCKETS } from '../src/common/metrics.ts';
import { HISTORY_CAPACITY, MetricsHistory, frameFromJson, frameToJson, frameValue, mergeFrames, summarize } from '../src/obs/history.ts';
import { createOverview } from '../src/obs/overview.ts';
import { reportRows, reportTable } from '../src/obs/thresholds.ts';
import { parseDuration, reportFromRecords } from '../src/cli/report.ts';
import type { PlayerPresence } from '../src/contracts.ts';
import { defer } from './harness.ts';

/** A registry with the metrics the history reads, as the real modules declare them. */
function registry() {
  const metrics = new MetricsRegistry();
  return {
    metrics,
    tick: metrics.histogram('game_tick_duration_ms', 'Шаг', FAST_MS_BUCKETS),
    broadcast: metrics.histogram('game_broadcast_interval_ms', 'Рассылка', BROADCAST_MS_BUCKETS),
    rtt: metrics.histogram('game_rtt_ms', 'RTT', RTT_MS_BUCKETS),
    first: metrics.histogram('npc_first_partial_ms', 'Первый текст', MS_BUCKETS),
    generation: metrics.histogram('npc_generation_ms', 'Генерация', MS_BUCKETS),
    npc: metrics.counter('npc_requests_total', 'NPC'),
    levels: metrics.counter('log_records_total', 'Журнал'),
    http: metrics.counter('http_requests_total', 'HTTP'),
  };
}
const presence = (playerId: string, name: string, extra: Partial<PlayerPresence> = {}): PlayerPresence => ({ playerId, name, mapId: 'market', connected: true, releaseInMs: null, rttMs: 40, reconnects: 0, seatedSeconds: 60, ...extra });

describe('history (OBS-013)', () => {
  it('S11: windows count only their own increments; the ring keeps 4 hours within 1 MB; no data stays null', () => {
    let now = 0; const r = registry();
    const players = [{ playerId: 'p1', connected: true, rttMs: 30, fps: 60, frameMs: 17 }, { playerId: 'p2', connected: true, rttMs: null, fps: null, frameMs: null }, { playerId: 'p3', connected: false, rttMs: 300, fps: 25, frameMs: 40 }, { playerId: 'p4', connected: true, rttMs: 10, fps: 144, frameMs: 7 }];
    const history = new MetricsHistory({ registry: r.metrics, players: () => players, diskFreeBytes: () => 5e9, memory: () => ({ rss: 1e8, heapUsed: 5e7 }) }, { now: () => now });
    // One hour of slow steps (30 ms), then five minutes of fast ones (1 ms).
    for (let i = 0; i < 360; i++) { for (let k = 0; k < 200; k++) r.tick.observe(30); now += 10_000; history.sample(); }
    for (let i = 0; i < 30; i++) { for (let k = 0; k < 200; k++) r.tick.observe(1); r.broadcast.observe(100); now += 10_000; history.sample(); }
    expect(summarize(history.window(5 * 60_000)).tick.p95).toBe(1);
    expect(summarize(history.window(60 * 60_000)).tick.p95).toBe(50);
    expect(r.metrics.snapshot().game_tick_duration_ms).toMatchObject([{ p95: 50 }]); // the cumulative view would hide the recovery
    for (let i = 0; i < 2000; i++) { now += 10_000; history.sample(); }
    expect(history.frames()).toHaveLength(HISTORY_CAPACITY);
    expect(history.frames()[0]!.players).toHaveLength(4);
    expect(history.approxBytes()).toBeLessThanOrEqual(1024 * 1024);
    const idle = summarize(history.window(60_000));
    expect(idle.tick).toEqual({ p50: null, p95: null, max: null });
    expect(idle.npc.timeoutShare).toBeNull();
    expect(idle.fps).toEqual({ min: 25, p50: 60 });
    expect(summarize([]).errors).toBeNull();
    expect(frameValue(history.frames().at(-1)!, 'seated')).toBe(4);
    expect(frameValue(history.frames().at(-1)!, 'connected')).toBe(3);
  });

  it('counts NPC outcomes, server errors and HTTP 5xx; frames merge and survive JSON', () => {
    let now = 0; const r = registry();
    const history = new MetricsHistory({ registry: r.metrics, players: () => [] }, { now: () => now });
    r.npc.inc({ kind: 'npc', outcome: 'completed' }, 6); r.npc.inc({ kind: 'npc', outcome: 'timeout' }, 2); r.npc.inc({ kind: 'npc', outcome: 'player-busy' });
    r.npc.inc({ kind: 'npc', outcome: 'model-error' }); r.levels.inc({ level: 'error' }); r.levels.inc({ level: 'fatal' }); r.levels.inc({ level: 'warn' }, 3);
    r.http.inc({ route: '/api/x', status: '500' }); r.http.inc({ route: '/api/x', status: '404' }); r.first.observe(700); r.generation.observe(3000);
    now = 10_000; const a = history.sample(); now = 20_000; r.levels.inc({ level: 'error' }); const b = history.sample();
    const s = summarize([a, b]);
    expect(s.npc).toMatchObject({ accepted: 9, completed: 6, timeouts: 2, busy: 1, failed: 1, firstPartialP95: 1000, generationP95: 5000 });
    expect(s.npc.timeoutShare).toBeCloseTo(2 / 9);
    expect(s).toMatchObject({ errors: 3, warnings: 3, http5xx: 1, frames: 2, from: 0, to: 20_000 });
    const merged = mergeFrames([a, b])!;
    expect(frameValue(merged, 'errors')).toBe(3);
    const copy = frameFromJson(JSON.parse(JSON.stringify(frameToJson(merged))))!;
    expect(summarize([copy])).toEqual(summarize([merged]));
    expect(frameFromJson({ at: 'x' })).toBeNull();
  });
});

describe('admin data and minute record (OBS-014, 015)', () => {
  function overview(players: () => PlayerPresence[]) {
    let now = 1_000_000; const r = registry(); const logger = memoryLogger();
    r.metrics.gauge('game_npcs', 'NPC', () => 6);
    const view = createOverview({
      metrics: r.metrics, logger, runId: 'run1', env: 'test', version: '0.1.0', maxPlayers: 4, maxUnfinished: 4, presence: players,
      stats: () => ({ tickP95Ms: 1.3, broadcastP95Ms: 101 }), npcReady: () => true, languageReady: () => true, eventLoopP99Ms: () => 4, diskFreeBytes: () => 5e9, dbBytes: () => 1e6,
      now: () => now, stepMs: 3_600_000,
    });
    defer(async () => view.stop());
    return { view, r, logger, tick: (ms: number) => { now += ms; } };
  }

  it('S13: status groups and full-buffer series with per-player rows fit 256 KiB', () => {
    const list = [presence('p1', 'Мира'), presence('p2', 'Соня', { rttMs: 172, reconnects: 3 }), presence('p3', 'Артём'), presence('p4', 'Лукас')];
    const { view, r, tick } = overview(() => list);
    view.perf.record('p2', { fps: 27, visible: true, frameMs: 40, drawCalls: 300 });
    for (let i = 0; i < HISTORY_CAPACITY; i++) { r.tick.observe(1.5); r.rtt.observe(40); tick(10_000); view.sample(); view.perf.record('p1', { fps: 60, visible: true }); }
    const status = view.status() as Record<string, any>;
    expect(status.overview).toMatchObject({ seats: { used: 4, max: 4 }, connected: 4, avgPingMs: 40, unstable: 1, npcCount: 6 });
    expect(status.tick).toMatchObject({ lastMinuteP95Ms: 1.3, p95Ms: 2 });
    expect(status.npcStats).toMatchObject({ queued: 0, maxUnfinished: 4 });
    expect(status.players.find((p: { name: string }) => p.name === 'Мира')).toMatchObject({ fps: 60, reportAgeSeconds: 0 });
    expect(status.players.find((p: { name: string }) => p.name === 'Соня')).toMatchObject({ fps: null, reportAgeSeconds: expect.any(Number) }); // older than 30 s
    expect(view.health().reasons.map((x) => x.text)).toEqual(expect.arrayContaining([expect.stringContaining('Нестабильная связь у игрока Соня'), 'Медленная сеть у игрока Соня (ping 172 мс)']));
    expect(view.recent()).toHaveLength(60); // OBS-004: the last 10 minutes go into incident dumps
    const body = JSON.stringify(view.series());
    expect(body.length).toBeLessThanOrEqual(256 * 1024);
    const series = JSON.parse(body) as { stepMs: number; series: Record<string, [number, number | null][]>; players: Record<string, { name: string; rtt: unknown[]; fps: unknown[] }> };
    expect(series.stepMs).toBe(30_000);
    expect(series.series.seated).toHaveLength(480);
    for (const name of ['connected', 'tickP95Ms', 'broadcastP95Ms', 'rssBytes', 'heapBytes', 'npcFirstPartialP95Ms', 'npcGenerationP95Ms', 'npcQueued', 'npcTimeouts', 'npcErrors', 'errors', 'warnings']) expect(series.series[name], name).toHaveLength(480);
    expect(series.series.tickP95Ms!.at(-1)![1]).toBe(2);
    expect(series.series.broadcastP95Ms!.at(-1)![1]).toBeNull();
    expect(Object.values(series.players).map((p) => p.name).sort()).toEqual(['Артём', 'Лукас', 'Мира', 'Соня']);
    expect(series.players.p1!.fps.at(-1)).toEqual([expect.any(Number), 60]);
  });

  it('S14: every sixth frame writes metrics.minute with the merged minute and no names', () => {
    const { view, r, logger, tick } = overview(() => [presence('p1', 'Мира')]);
    for (let i = 0; i < 18; i++) { r.tick.observe(1); tick(10_000); view.sample(); }
    const minutes = logger.records.filter((rec) => rec.event === 'metrics.minute');
    expect(minutes).toHaveLength(3);
    for (const minute of minutes) {
      expect(JSON.stringify(minute).length).toBeLessThanOrEqual(2048);
      expect(JSON.stringify(minute)).not.toContain('Мира');
      expect(minute).toMatchObject({ level: 'info', spanMs: 60_000, values: { seated: 1, errors: 0 }, hist: { tick: expect.any(Array) }, players: [{ playerId: 'p1', rttMs: 40, fps: null }] });
    }
  });
});

describe('report (OBS-017)', () => {
  const minute = (at: number, overrides: { errors?: number; fps?: number | null; tickSlow?: boolean } = {}) => {
    const r = registry(); let now = at - 60_000;
    const history = new MetricsHistory({ registry: r.metrics, players: () => [{ playerId: 'p1', connected: true, rttMs: 40, fps: overrides.fps === undefined ? 60 : overrides.fps, frameMs: 16 }] }, { now: () => now });
    for (let k = 0; k < 100; k++) { r.tick.observe(overrides.tickSlow ? 8 : 1); r.broadcast.observe(100); r.rtt.observe(40); }
    r.levels.inc({ level: 'error' }, overrides.errors ?? 0); r.npc.inc({ outcome: 'completed' }, 4);
    now = at; return frameToJson(history.sample());
  };
  const records = (runId: string, start: number, frames: Record<string, unknown>[]) => [
    { ts: new Date(start).toISOString(), runId, event: 'app.start', env: 'production' },
    ...frames.map((f) => ({ ts: new Date(f.at as number).toISOString(), runId, event: 'metrics.minute', ...f })),
  ];

  it('S16: one table for the last run or a period; missing data is never «в норме»', () => {
    const t0 = Date.UTC(2026, 10, 1, 10);
    const ok = records('good', t0, [minute(t0 + 60_000), minute(t0 + 120_000)]);
    const bad = records('bad', t0 + 3_600_000, [minute(t0 + 3_660_000, { errors: 1, fps: null, tickSlow: true })]);
    const good = reportFromRecords([...ok, ...bad], { runId: 'good' });
    expect(good).toContain('Запуск: good · окружение: production');
    expect(good).toContain('| p95 шага сервера | 1 мс | ≤ 5 мс | ✅ в норме |');
    expect(good).toContain('| p95 интервала рассылки | 100 мс | ≤ 120 мс | ✅ в норме |');
    expect(good).toContain('| Минимальный FPS клиента (видимые вкладки) | 60 | ≥ 30 | ✅ в норме |');
    expect(good).toContain('пик игроков: 1');
    const failing = reportFromRecords([...ok, ...bad], { runId: 'bad' });
    expect(failing).toContain('| p95 шага сервера | 10 мс | ≤ 5 мс | ❌ превышен |');
    expect(failing).toContain('| Ошибки сервера (error, fatal) | 1 | 0 | ❌ превышен |');
    expect(failing).toContain('| Минимальный FPS клиента (видимые вкладки) | нет данных | ≥ 30 | — нет данных |');
    const period = reportFromRecords([...ok, ...bad], { since: t0 });
    expect(period).toContain('Запуск: good, bad');
    expect(period).toContain('| Ошибки сервера (error, fatal) | 1 |');
    const empty = summarize([]);
    expect(reportRows(empty).every((row) => row.verdict === 'nodata')).toBe(true);
    expect(reportTable(empty, { runIds: [], env: null, from: null, to: null, peakPlayers: null })).toContain('пик игроков: нет данных');
    expect(parseDuration('2h')).toBe(7_200_000); expect(parseDuration('30m')).toBe(1_800_000); expect(() => parseDuration('2 hours')).toThrow();
  });

  it('S16: the CLI reads a journal file and fails only on bad arguments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'report-')); defer(async () => rmSync(dir, { recursive: true, force: true }));
    const t0 = Date.UTC(2026, 10, 1, 10);
    const file = join(dir, 'server-20261101-good.jsonl');
    writeFileSync(file, [...records('good', t0, [minute(t0 + 60_000)]), { ts: new Date(t0).toISOString(), runId: 'good', event: 'http.request' }].map((r) => JSON.stringify(r)).join('\n') + '\n{"torn');
    const cli = fileURLToPath(new URL('../src/cli/report.ts', import.meta.url));
    const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20_000 });
    const result = run(['--file', file]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('| p95 шага сервера | 1 мс | ≤ 5 мс | ✅ в норме |');
    expect(run(['--file', file, '--last', 'soon']).status).toBe(1);
  });
});
