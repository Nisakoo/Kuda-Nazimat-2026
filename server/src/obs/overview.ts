import type { PlayerPresence } from '../contracts.ts';
import type { Logger } from '../common/logger.ts';
import type { MetricsRegistry } from '../common/metrics.ts';
import { ClientPerf, type PerfView } from './clientPerf.ts';
import { evaluateHealth, type Health } from './health.ts';
import { HISTORY_STEP_MS, MetricsHistory, frameToJson, median, mergeFrames, summarize, type Frame, type Summary, type ValueName, frameValue } from './history.ts';
import { THRESHOLDS, reportTable } from './thresholds.ts';

export interface OverviewDeps {
  readonly metrics: MetricsRegistry;
  readonly logger: Logger;
  readonly runId: string;
  readonly env: string;
  readonly version: string;
  readonly maxPlayers: number;
  readonly maxUnfinished: number;
  presence(): readonly PlayerPresence[];
  /** Exact p95 of the last game minute (`game.tick.stats`). */
  stats(): { readonly tickP95Ms: number; readonly broadcastP95Ms: number } | null;
  npcReady(): boolean;
  languageReady(): boolean;
  eventLoopP99Ms(): number | null;
  diskFreeBytes(): number | null;
  dbBytes(): number;
  readonly now?: () => number;
  readonly stepMs?: number;
}

/** A seated player as the admin sees it: presence (OFFLINE-010, OBS-010) plus the last client report (OBS-011). */
export type PlayerStatus = PlayerPresence & PerfView;

const MINUTE_FRAMES = 6;
/** Upper bound of the history response (OBS-014 ≤ 256 KiB): longer buffers are merged into wider points. */
const MAX_POINTS = 480;
/** Infinity (only the overflow bucket) cannot be JSON; the page shows «выше шкалы». */
const out = (value: number | null): number | string | null => (value === Infinity ? 'inf' : value);

/**
 * OBS-013–015 runtime: samples the history every 10 s, writes `metrics.minute`, and answers the admin
 * screen (status groups and history series) and the report printed at shutdown (OBS-017).
 */
export function createOverview(deps: OverviewDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.logger.child('obs');
  const perf = new ClientPerf(now);
  const players = (): PlayerStatus[] => deps.presence().map((p) => ({ ...p, ...perf.view(p.playerId) }));
  const history = new MetricsHistory({
    registry: deps.metrics, diskFreeBytes: deps.diskFreeBytes, memory: () => process.memoryUsage(),
    players: () => players().map((p) => ({ playerId: p.playerId, connected: p.connected, rttMs: p.rttMs, fps: p.fps, frameMs: p.frameMs })),
  }, { now });
  const startedAt = now();
  let samples = 0;

  const sample = (): void => {
    perf.retain(new Set(deps.presence().map((p) => p.playerId)));
    history.sample();
    if (++samples % MINUTE_FRAMES === 0) {
      const minute = mergeFrames(history.frames().slice(-MINUTE_FRAMES))!;
      log.info('metrics.minute', 'Метрики за минуту', frameToJson(minute));
    }
  };
  const timer = setInterval(sample, deps.stepMs ?? HISTORY_STEP_MS); timer.unref();

  /** Median FPS of the last minute per player (OBS-010), falling back to the current report. */
  const minuteFps = (player: PlayerStatus): number | null => {
    const values = history.window(60_000).flatMap((f) => f.players.filter((p) => p.playerId === player.playerId && p.fps !== null).map((p) => p.fps!));
    return values.length ? median(values) : player.fps;
  };

  function health(): Health {
    const w5 = summarize(history.window(5 * 60_000));
    const list = players();
    return evaluateHealth({
      tickP95Ms: w5.tick.p95, broadcastP95Ms: w5.broadcast.p95, eventLoopP99Ms: deps.eventLoopP99Ms(),
      npcReady: deps.npcReady(), languageReady: deps.languageReady(), timeoutShare: w5.npc.timeoutShare,
      dbErrors5m: w5.dbErrors ?? 0, logDropped5m: w5.logDropped ?? 0, diskFreeBytes: deps.diskFreeBytes(),
      players: list.map((p) => ({ name: p.name, reconnects: p.reconnects, rttMs: p.rttMs, fps: minuteFps(p) })),
    });
  }

  /** OBS-014 groups for the tiles and cards of «Обзор», «Сервер», «Клиенты». */
  function status(): Record<string, unknown> {
    const list = players();
    const w5 = summarize(history.window(5 * 60_000)); const w60 = summarize(history.window(60 * 60_000));
    const rss = process.memoryUsage();
    const connected = list.filter((p) => p.connected);
    const queue = (state: string) => deps.metrics.value('npc_queue', { state });
    const npcErrors = (s: Summary) => (s.npc.failed === null ? null : s.npc.failed + (s.npc.timeouts ?? 0));
    const stats = deps.stats();
    return {
      server: { env: deps.env, version: deps.version, runId: deps.runId, uptimeSeconds: Math.floor((now() - startedAt) / 1000) },
      overview: {
        seats: { used: list.length, max: deps.maxPlayers }, connected: connected.length,
        avgPingMs: median(connected.map((p) => p.rttMs).filter((v): v is number => v !== null)),
        avgFps: median(connected.map((p) => p.fps).filter((v): v is number => v !== null)),
        unstable: list.filter((p) => p.reconnects >= 3).length,
        npcCount: deps.metrics.has('game_npcs') ? deps.metrics.value('game_npcs') : null, activeGenerations: queue('running'),
        errorsHour: w60.errors,
      },
      tick: { lastMinuteP95Ms: stats?.tickP95Ms ?? null, p50Ms: out(w5.tick.p50), p95Ms: out(w5.tick.p95), maxMs: out(w5.tick.max), broadcastP95Ms: out(w5.broadcast.p95), broadcastMaxMs: out(w5.broadcast.max) },
      memory: { rssBytes: rss.rss, heapBytes: rss.heapUsed, diskFreeBytes: deps.diskFreeBytes(), dbBytes: deps.dbBytes(), logDroppedHour: w60.logDropped, eventLoopP99Ms: deps.eventLoopP99Ms() },
      npcStats: {
        queued: queue('queued'), running: queue('running'), unfinished: queue('queued') + queue('running'), maxUnfinished: deps.maxUnfinished,
        window5m: { accepted: w5.npc.accepted, completed: w5.npc.completed, timeouts: w5.npc.timeouts, busy: w5.npc.busy, firstPartialP95Ms: out(w5.npc.firstPartialP95), generationP95Ms: out(w5.npc.generationP95) },
      },
      errors: {
        hour: { total: w60.errors, http5xx: w60.http5xx, db: w60.dbErrors },
        window5m: { http5xx: w5.http5xx, db: w5.dbErrors, npc: npcErrors(w5) },
        window60m: { http5xx: w60.http5xx, db: w60.dbErrors, npc: npcErrors(w60) },
      },
      thresholds: THRESHOLDS,
      players: list,
    };
  }

  /** OBS-014 series over the whole buffer; points are merged when the buffer is longer than MAX_POINTS. */
  function series(): Record<string, unknown> {
    const frames = history.frames();
    const group = Math.max(1, Math.ceil(frames.length / MAX_POINTS));
    const points: Frame[] = [];
    for (let i = 0; i < frames.length; i += group) points.push(mergeFrames(frames.slice(i, i + group))!);
    const step = (frames.at(-1)?.spanMs || (deps.stepMs ?? HISTORY_STEP_MS)) * group;
    const pick = (name: ValueName) => points.map((f) => [f.at, frameValue(f, name)]);
    const summaries = points.map((f) => summarize([f]));
    const from = (get: (s: Summary) => number | null) => points.map((f, i) => [f.at, out(get(summaries[i]!))]);
    const names = new Map(deps.presence().map((p) => [p.playerId, p.name]));
    const byPlayer: Record<string, { name: string | null; rtt: unknown[]; fps: unknown[] }> = {};
    for (const frame of points) for (const p of frame.players) {
      const entry = byPlayer[p.playerId] ??= { name: names.get(p.playerId) ?? null, rtt: [], fps: [] };
      entry.rtt.push([frame.at, p.rttMs]); entry.fps.push([frame.at, p.fps]);
    }
    return {
      stepMs: step, from: frames[0] ? frames[0].at - frames[0].spanMs : null, to: frames.at(-1)?.at ?? null,
      series: {
        seated: pick('seated'), connected: pick('connected'),
        tickP95Ms: from((s) => s.tick.p95), broadcastP95Ms: from((s) => s.broadcast.p95),
        rssBytes: pick('rssBytes'), heapBytes: pick('heapBytes'),
        npcFirstPartialP95Ms: from((s) => s.npc.firstPartialP95), npcGenerationP95Ms: from((s) => s.npc.generationP95),
        npcQueued: pick('queued'), npcTimeouts: pick('npcTimeouts'), npcErrors: pick('npcFailed'),
        errors: pick('errors'), warnings: pick('warnings'),
      },
      players: byPlayer,
      thresholds: { ...THRESHOLDS, seats: deps.maxPlayers },
    };
  }

  return {
    perf,
    sample,
    health,
    status,
    series,
    /** Last 10 minutes of frames for incident dumps (OBS-004). */
    recent: () => history.window(10 * 60_000).map(frameToJson),
    approxBytes: () => history.approxBytes(),
    /** OBS-017 table for this run, printed at a clean shutdown. */
    report: (): string => {
      history.sample();
      const summary = summarize(history.frames());
      return reportTable(summary, { runIds: [deps.runId], env: deps.env, from: summary.from, to: summary.to, peakPlayers: summary.seatedPeak });
    },
    stop: () => clearInterval(timer),
  };
}

export type Overview = ReturnType<typeof createOverview>;
