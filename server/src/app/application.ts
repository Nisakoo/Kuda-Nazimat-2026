import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreateGame } from '../contracts.ts';
import type { Logger } from '../common/logger.ts';
import { systemClock, systemScheduler } from '../common/time.ts';
import { openDatabase, sqliteStores } from '../persistence/database.ts';
import { BabylonService } from '../babylon/BabylonService.ts';
import { createLanguagePort, unavailableLanguagePort } from '../babylon/adapters.ts';
import type { LanguagePort } from '../babylon/ports.ts';
import { sqliteBabylon } from '../persistence/babylon.ts';
import { randomId } from '../common/ids.ts';
import { createAuthService } from '../auth/AuthService.ts';
import { createResponder } from '../npc/adapters/index.ts';
import { createNpcDialogueService } from '../npc/NpcDialogueService.ts';
import { createHttpServer } from '../http/server.ts';
import type { Config } from './config.ts';

/** OFFLINE-003: a busy port is a usage error with a way out, not a stack trace. */
function listenError(error: NodeJS.ErrnoException, port: number): Error {
  if (error.code === 'EADDRINUSE') return new Error(`Порт ${port} уже занят: вероятно, сервер уже запущен в другом окне. Закройте его или выберите другой порт: --port <номер> или "port" в config.json.`);
  // Windows reports a port held exclusively by another program as EACCES, not EADDRINUSE.
  if (error.code === 'EACCES') return new Error(`Порт ${port} недоступен: его занимает другая программа или он закрыт системой. Выберите другой порт (больше 1024): --port <номер> или "port" в config.json.`);
  return error;
}
/** `languagePort` overrides config.language for tests; production selects the adapter by config. */
export async function startApplication(config: Config, createGame: CreateGame, logger: Logger, languagePort?: LanguagePort) {
  try { if (!(await stat(join(config.clientDir, 'index.html'))).isFile()) throw new Error(); }
  catch { throw new Error(`Нет сборки ${config.clientDir}/index.html. Выполните npm --prefix client run build`); }
  try { if (!(await stat(config.worldDir)).isDirectory()) throw new Error(); }
  catch { throw new Error(`Нет мира ${config.worldDir}. Выполните npm --prefix client run world:generate`); }
  const db = openDatabase(config.dbPath);
  const stores = sqliteStores(db);
  let language: LanguagePort | undefined;
  let game: Awaited<ReturnType<CreateGame>> | undefined;
  const auth = createAuthService(stores.accounts, stores.sessions, systemClock, config.sessionTtlMs, {
    canAdmit: accountId => game?.canAdmit ? game.canAdmit(accountId ?? '') : !game || game.activePlayers() < config.maxPlayers,
  });
  let npc: ReturnType<typeof createNpcDialogueService> | undefined;
  let http: ReturnType<typeof createHttpServer> | undefined;
  try {
    npc = createNpcDialogueService({ responder: createResponder(config.npc.adapter, config.npc.options, { clock: systemClock, scheduler: systemScheduler }), dialogue: stores.dialogue, clock: systemClock, scheduler: systemScheduler, logger: logger.child('npc') }, config.npc);
    await npc.start();
    language = languagePort ?? createLanguagePort(config.language.adapter, config.language.options);
    try { await language.start(); } catch { logger.error('LanguagePort недоступен'); language = unavailableLanguagePort(language); }
    const babylon = new BabylonService({ store: sqliteBabylon(db), language, generate: npc.generate, now: Date.now, id: () => randomId('b'), location: accountId => game?.location?.(accountId) ?? null, peerLocation: playerId => game?.playerLocation?.(playerId) ?? null, measure: (kind, durationMs, success) => logger.info('BABEL language operation', { kind, durationMs, success }) });
    game = await createGame(config, { sessions: auth, players: stores.players, avatars: stores.avatars, equipment: stores.equipment, npc, babylon, clock: systemClock, scheduler: systemScheduler, logger: logger.child('game') });
    const npcService = npc;
    http = createHttpServer(config, { auth, game, avatars: stores.avatars, equipment: stores.equipment, npcReady: () => npcService.ready(), logger: logger.child('http'), babylon, cancelBabylon: npc.cancelConnection });
    game.attach(http.server);
    stores.sessions.prune(Date.now() - 86400000);
    await new Promise<void>((resolve, reject) => {
      const failed = (error: NodeJS.ErrnoException) => reject(listenError(error, config.port));
      http!.server.once('error', failed);
      http!.server.listen(config.port, config.host, () => { http!.server.removeListener('error', failed); resolve(); });
    });
  } catch (error) {
    http?.rejectNewRequests();
    try { await language?.stop().catch(() => {}); await npc?.stop(); } finally {
      try { await game?.stop('startup-failure'); } finally { http?.server.close(); db.close(); }
    }
    throw error;
  }
  const runtime = game; const npcService = npc; const transport = http; const languageService = language!;
  const cleanup = setInterval(() => {
    try { stores.sessions.prune(Date.now() - 86400000); } catch { logger.error('Не удалось очистить сессии'); }
  }, 3600000);
  for (const map of runtime.maps) logger.info('Карта готова', { ...map });
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
          const results = await Promise.allSettled([npcStopped, gameStopped, languageService.stop()]);
          if (results.some((result) => result.status === 'rejected')) throw new Error('Ошибка остановки модуля');
        }
        finally { transport.server.closeAllConnections(); await closed; db.close(); }
      })();
      return stopping;
    },
  };
}
