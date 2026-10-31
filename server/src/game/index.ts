import type { Server as HttpServer } from 'node:http';
import type { CreateGame, GameConfig, GameDeps, GameRuntime, WorldFileAccess } from '../contracts.ts';
import type { TimerHandle } from '../common/time.ts';
import { attachGateway } from '../realtime/gateway.ts';
import { canAccess } from '../world/access.ts';
import { loadWorld } from '../world/loader.ts';
import { GameService } from './GameService.ts';
import { DEFAULT_WORLD_SETTINGS, World } from './World.ts';

const MAX_CATCH_UP = 5;
const STATS_EVERY_MS = 60_000;

/** Part A entry point (contracts.ts): validated world, authoritative game and Socket.IO /game. */
export const createGame: CreateGame = async (config: GameConfig, deps: GameDeps): Promise<GameRuntime> => {
  if (config.tickHz % config.broadcastHz !== 0) throw new Error('tickHz должен делиться на broadcastHz');
  const loaded = await loadWorld({ worldDir: config.worldDir, maps: config.maps, contentDir: config.contentDir });
  const world = new World(loaded.maps, loaded.npcs, { ...DEFAULT_WORLD_SETTINGS, aoiRadius: config.aoiRadius });
  const log = deps.logger.child('game');
  const game = new GameService(world, deps.players, deps.clock, deps.scheduler, {
    maxPlayers: config.maxPlayers, disconnectGraceMs: config.disconnectGraceMs, broadcastEvery: config.tickHz / config.broadcastHz, initialSpawn: deps.babylon?.spawn.bind(deps.babylon), didSpawn: deps.babylon?.entered.bind(deps.babylon),
  }, log);

  const timers: TimerHandle[] = [];
  let gateway: { close(): Promise<void> } | null = null;
  let running = false;

  /** REALTIME-004: fixed step with drift compensation, bounded catch-up, timing stats. */
  const startLoop = (): void => {
    const stepMs = 1000 / config.tickHz;
    let next = performance.now();
    let durations: number[] = [];
    let statsAt = performance.now();
    const run = (): void => {
      if (!running) return;
      const now = performance.now();
      let steps = 0;
      while (next <= now && steps < MAX_CATCH_UP) {
        const began = performance.now();
        game.tick(1 / config.tickHz);
        durations.push(performance.now() - began);
        next += stepMs; steps++;
      }
      if (next <= now) next = now + stepMs; // drop missed steps beyond the catch-up limit
      if (now - statsAt >= STATS_EVERY_MS && durations.length) {
        const sorted = [...durations].sort((a, b) => a - b);
        const at = (q: number) => Number(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!.toFixed(3));
        log.info('Длительность шага, мс', { p50: at(0.5), p95: at(0.95), max: at(1), players: game.activePlayers });
        durations = []; statsAt = now;
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
      gateway = attachGateway(server, { game, sessions: deps.sessions, npc: deps.npc, clock: deps.clock, scheduler: deps.scheduler, logger: deps.logger, corsOrigins: config.corsOrigins, babylon: deps.babylon });
      running = true;
      startLoop();
    },
    activePlayers: () => game.activePlayers,
    async stop(reason: string): Promise<void> {
      running = false;
      for (const timer of timers) if (timer) deps.scheduler.clearTimeout(timer);
      game.shutdown(reason);
      await gateway?.close();
      gateway = null;
    },
  };
};
