import type { Server as HttpServer } from 'node:http';
import type { CreateGame, GameConfig, GameDeps, GameRuntime, WorldFileAccess } from '../contracts.ts';
import type { TimerHandle } from '../common/time.ts';
import { FAST_MS_BUCKETS, MS_BUCKETS, MetricsRegistry } from '../common/metrics.ts';
import { attachGateway } from '../realtime/gateway.ts';
import { canAccess } from '../world/access.ts';
import { loadWorld } from '../world/loader.ts';
import { GameService } from './GameService.ts';
import { DEFAULT_WORLD_SETTINGS, World } from './World.ts';

const MAX_CATCH_UP = 5;
const STATS_EVERY_MS = 60_000;
const SLOW_TICK_MS = 50;

const quantile = (sorted: readonly number[], q: number): number => Number((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0).toFixed(3));

/** Part A entry point (contracts.ts): validated world, authoritative game and Socket.IO /game. */
export const createGame: CreateGame = async (config: GameConfig, deps: GameDeps): Promise<GameRuntime> => {
  if (config.tickHz % config.broadcastHz !== 0) throw new Error('tickHz должен делиться на broadcastHz');
  const log = deps.logger.child('game');
  const metrics = deps.metrics ?? new MetricsRegistry();
  const began = performance.now();
  const loaded = await loadWorld({ worldDir: config.worldDir, maps: config.maps, contentDir: config.contentDir });
  for (const map of loaded.maps.values()) log.info('world.loaded', 'Карта готова', { mapId: map.id, chunks: map.manifest.chunks.length, worldBytes: map.manifest.worldBytes, durationMs: Math.round(performance.now() - began) });
  const recoveries = metrics.counter('game_motion_recovered_total', 'Восстановления движения по причине (MOVE)');
  const world = new World(loaded.maps, loaded.npcs, { ...DEFAULT_WORLD_SETTINGS, aoiRadius: config.aoiRadius }, {
    invariant: (name, fields) => log.error('invariant.violated', 'Нарушен инвариант мира', { invariant: name, ...fields }),
    recovered: (playerId, reason) => { recoveries.inc({ reason }); log.warn('game.motion.recovered', 'Движение восстановлено после застревания', { playerId, reason }); },
    aoiTruncated: (playerId, candidates) => log.warn('game.aoi.truncated', 'AOI усечена до 256 сущностей', { playerId, candidates }),
  });
  const broadcastEvery = config.tickHz / config.broadcastHz;
  const game = new GameService(world, deps.players, deps.clock, deps.scheduler, {
    maxPlayers: config.maxPlayers, disconnectGraceMs: config.disconnectGraceMs, broadcastEvery, initialSpawn: deps.babylon?.spawn.bind(deps.babylon), didSpawn: deps.babylon?.entered.bind(deps.babylon),
  }, log, metrics);
  const tickHistogram = metrics.histogram('game_tick_duration_ms', 'Длительность шага симуляции', FAST_MS_BUCKETS);
  const broadcastHistogram = metrics.histogram('game_broadcast_interval_ms', 'Интервал между рассылками AOI', MS_BUCKETS);
  let stats: { tickP95Ms: number; broadcastP95Ms: number; players: number } | null = null;

  const timers: TimerHandle[] = [];
  let gateway: { close(): Promise<void> } | null = null;
  let running = false;

  /** REALTIME-004: fixed step with drift compensation, bounded catch-up, timing stats. */
  const startLoop = (): void => {
    const stepMs = 1000 / config.tickHz;
    let next = performance.now();
    let durations: number[] = [];
    let intervals: number[] = [];
    let lastBroadcast = 0;
    let statsAt = performance.now();
    const run = (): void => {
      if (!running) return;
      const now = performance.now();
      let steps = 0;
      while (next <= now && steps < MAX_CATCH_UP) {
        const start = performance.now();
        game.tick(1 / config.tickHz);
        const end = performance.now(); const duration = end - start;
        durations.push(duration); tickHistogram.observe(duration);
        if (duration > SLOW_TICK_MS) log.warn('game.tick.slow', 'Медленный шаг симуляции', { durationMs: Number(duration.toFixed(1)), players: game.activePlayers });
        if (world.tick % broadcastEvery === 0) {
          if (lastBroadcast) { const interval = end - lastBroadcast; intervals.push(interval); broadcastHistogram.observe(interval); }
          lastBroadcast = end;
        }
        next += stepMs; steps++;
      }
      if (next <= now) next = now + stepMs; // drop missed steps beyond the catch-up limit
      if (now - statsAt >= STATS_EVERY_MS && durations.length) {
        const ticks = [...durations].sort((a, b) => a - b); const sent = [...intervals].sort((a, b) => a - b);
        stats = { tickP95Ms: quantile(ticks, 0.95), broadcastP95Ms: quantile(sent, 0.95), players: game.activePlayers };
        log.info('game.tick.stats', 'Длительность шага и интервал рассылки, мс', { p50: quantile(ticks, 0.5), p95: stats.tickP95Ms, max: quantile(ticks, 1), broadcastP95: stats.broadcastP95Ms, broadcastMax: quantile(sent, 1), players: stats.players });
        durations = []; intervals = []; statsAt = now;
      }
      timers[0] = deps.scheduler.setTimeout(run, Math.max(0, next - performance.now()));
    };
    timers[0] = deps.scheduler.setTimeout(run, 0);
    const save = (): void => { if (!running) return; game.saveMoved(); timers[1] = deps.scheduler.setTimeout(save, config.saveIntervalMs); };
    timers[1] = deps.scheduler.setTimeout(save, config.saveIntervalMs);
  };

  return {
    canAct: (accountId, sessionKey) => game.canAct(accountId, sessionKey),
    location: accountId => game.locate(accountId),
    maps: [...loaded.maps.values()].map((map) => ({ mapId: map.id, worldBytes: map.manifest.worldBytes, chunks: map.manifest.chunks.length })),
    worldFile(path: string, accountId: string): WorldFileAccess {
      const file = loaded.files.get(path);
      if (!file || !canAccess(file, game.locate(accountId), loaded.maps, config.staticChunkRadius)) return { ok: false };
      return { ok: true, file: { absolutePath: file.absolutePath, bytes: file.bytes, contentType: file.contentType } };
    },
    attach(server: HttpServer): void {
      if (gateway) throw new Error('Игровой канал уже подключён');
      gateway = attachGateway(server, { game, sessions: deps.sessions, npc: deps.npc, clock: deps.clock, scheduler: deps.scheduler, logger: deps.logger, metrics, corsOrigins: config.corsOrigins, babylon: deps.babylon, ...(deps.pingIntervalMs ? { pingIntervalMs: deps.pingIntervalMs } : {}), validateOutgoing: deps.validateOutgoing ?? false });
      running = true;
      startLoop();
    },
    activePlayers: () => game.activePlayers,
    presence: () => game.presence(),
    closeSessions: (tokenHashes, message) => game.closeSessions(new Set(tokenHashes), message),
    state: () => ({ ...game.state(), stats }),
    stats: () => stats,
    async stop(reason: string): Promise<void> {
      running = false;
      for (const timer of timers) if (timer) deps.scheduler.clearTimeout(timer);
      game.shutdown(reason);
      await gateway?.close();
      gateway = null;
    },
  };
};
