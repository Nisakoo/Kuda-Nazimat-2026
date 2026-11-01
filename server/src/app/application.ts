import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { CreateGame } from '../contracts.ts';
import type { Logger } from '../common/logger.ts';
import { systemClock, systemScheduler } from '../common/time.ts';
import { openDatabase, sqliteStores } from '../persistence/database.ts';
import { BabylonService } from '../babylon/BabylonService.ts';
import { testLanguagePort } from '../babylon/TestLanguagePort.ts';
import type { LanguagePort } from '../babylon/ports.ts';
import { sqliteBabylon } from '../persistence/babylon.ts';
import { randomId } from '../common/ids.ts';
import { createAuthService } from '../auth/AuthService.ts';
import { createResponder } from '../npc/adapters/index.ts';
import { createNpcDialogueService } from '../npc/NpcDialogueService.ts';
import { createHttpServer } from '../http/server.ts';
import type { Config } from './config.ts';

export function addresses(host: string, port: number): string[] {
  const urls = [`http://localhost:${port}/`];
  if (host === '0.0.0.0' || host === '::') for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) if (!entry.internal && entry.family === 'IPv4') urls.push(`http://${entry.address}:${port}/`);
  }
  else if (host !== '127.0.0.1' && host !== 'localhost') urls.push(`http://${host.includes(':') ? `[${host}]` : host}:${port}/`);
  return [...new Set(urls)];
}
export async function startApplication(config: Config, createGame: CreateGame, logger: Logger, languagePort: LanguagePort = testLanguagePort) {
  try { if (!(await stat(join(config.clientDir, 'index.html'))).isFile()) throw new Error(); }
  catch { throw new Error(`Нет сборки ${config.clientDir}/index.html. Выполните npm --prefix client run build`); }
  try { if (!(await stat(config.worldDir)).isDirectory()) throw new Error(); }
  catch { throw new Error(`Нет мира ${config.worldDir}. Выполните npm --prefix client run world:generate`); }
  const db = openDatabase(config.dbPath);
  const stores = sqliteStores(db);
  let game: Awaited<ReturnType<CreateGame>> | undefined;
  const auth = createAuthService(stores.accounts, stores.sessions, systemClock, config.sessionTtlMs, {
    canAdmit: accountId => game?.canAdmit ? game.canAdmit(accountId ?? '') : !game || game.activePlayers() < config.maxPlayers,
  });
  let npc: ReturnType<typeof createNpcDialogueService> | undefined;
  let http: ReturnType<typeof createHttpServer> | undefined;
  try {
    npc = createNpcDialogueService({ responder: createResponder(config.npc.adapter, config.npc.options, { clock: systemClock, scheduler: systemScheduler }), dialogue: stores.dialogue, clock: systemClock, scheduler: systemScheduler, logger: logger.child('npc') }, config.npc);
    await npc.start();
    const babylon = new BabylonService({ store: sqliteBabylon(db), language: languagePort, generate: npc.generate, now: Date.now, id: () => randomId('b'), location: accountId => game?.location?.(accountId) ?? null, peerLocation: playerId => game?.playerLocation?.(playerId) ?? null, measure: (kind, durationMs, success) => logger.info('BABEL language operation', { kind, durationMs, success }) });
    game = await createGame(config, { sessions: auth, players: stores.players, avatars: stores.avatars, equipment: stores.equipment, npc, babylon, clock: systemClock, scheduler: systemScheduler, logger: logger.child('game') });
    const npcService = npc;
    http = createHttpServer(config, { auth, game, avatars: stores.avatars, equipment: stores.equipment, npcReady: () => npcService.ready(), logger: logger.child('http'), babylon, cancelBabylon: npc.cancelConnection });
    game.attach(http.server);
    stores.sessions.prune(Date.now() - 86400000);
    await new Promise<void>((resolve, reject) => {
      http!.server.once('error', reject);
      http!.server.listen(config.port, config.host, () => { http!.server.removeListener('error', reject); resolve(); });
    });
  } catch (error) {
    http?.rejectNewRequests();
    try { await npc?.stop(); } finally {
      try { await game?.stop('startup-failure'); } finally { http?.server.close(); db.close(); }
    }
    throw error;
  }
  const runtime = game; const npcService = npc; const transport = http;
  const cleanup = setInterval(() => {
    try { stores.sessions.prune(Date.now() - 86400000); } catch { logger.error('Не удалось очистить сессии'); }
  }, 3600000);
  for (const map of runtime.maps) logger.info('Карта готова', { ...map });
  const address = transport.server.address();
  if (address && typeof address !== 'string') for (const url of addresses(config.host, address.port)) logger.info('Сервер доступен', { url });
  let stopping: Promise<void> | undefined;
  return {
    server: transport.server,
    stop(reason = 'shutdown'): Promise<void> {
      if (stopping) return stopping;
      stopping = (async () => {
        transport.rejectNewRequests(); clearInterval(cleanup);
        const closed = new Promise<void>((resolve) => transport.server.close(() => resolve()));
        try {
          const npcStopped = npcService.stop(); // Aborts synchronously before closing connections.
          const gameStopped = runtime.stop(reason);
          const results = await Promise.allSettled([npcStopped, gameStopped]);
          if (results.some((result) => result.status === 'rejected')) throw new Error('Ошибка остановки модуля');
        }
        finally { transport.server.closeAllConnections(); await closed; db.close(); }
      })();
      return stopping;
    },
  };
}
