import { readFileSync, statSync, statfsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CreateGame } from '../contracts.ts';
import type { Logger, LogRecord } from '../common/logger.ts';
import { MS_BUCKETS, MetricsRegistry } from '../common/metrics.ts';
import { systemClock, systemScheduler } from '../common/time.ts';
import { openDatabase, sqliteStores, type DatabaseObserver } from '../persistence/database.ts';
import { BabylonService, babylonNpc } from '../babylon/BabylonService.ts';
import { BABEL_NPC_IDS } from '../babylon/content.ts';
import { NpcCatalog } from '../content/NpcCatalog.ts';
import { sqliteNpcStore } from '../persistence/npcContent.ts';
import { createLanguagePort, unavailableLanguagePort } from '../babylon/adapters.ts';
import type { LanguagePort } from '../babylon/ports.ts';
import { sqliteBabylon } from '../persistence/babylon.ts';
import { sqliteWorldLife } from '../persistence/worldLife.ts';
import { randomId } from '../common/ids.ts';
import { createAuthService, REVOKE_MESSAGES } from '../auth/AuthService.ts';
import { createResponder } from '../npc/adapters/index.ts';
import { createNpcDialogueService } from '../npc/NpcDialogueService.ts';
import { createHttpServer } from '../http/server.ts';
import { CounterWindow, evaluateHealth } from '../obs/health.ts';
import { ClientPerfStore } from '../obs/clientPerf.ts';
import type { Config } from './config.ts';

/** Optional observability pieces from `createObservability`; tests run without them. */
export interface AppObservability {
  readonly metrics: MetricsRegistry;
  readonly recorder?: { warnings(): readonly LogRecord[]; dump(reason: string): string | null };
  readonly process?: () => { eventLoopP99Ms: number };
  readonly errors?: () => readonly { event: string; last5m: number; last60m: number }[];
  readonly setSnapshot?: (snapshot: () => unknown) => void;
}

const SLOW_DB_MS = 50;

/** OFFLINE-003: a busy port is a usage error with a way out, not a stack trace. */
function listenError(error: NodeJS.ErrnoException, port: number): Error {
  if (error.code === 'EADDRINUSE') return new Error(`Порт ${port} уже занят: вероятно, сервер уже запущен в другом окне. Закройте его или выберите другой порт: --port <номер> или "port" в config.json.`);
  // Windows reports a port held exclusively by another program as EACCES, not EADDRINUSE.
  if (error.code === 'EACCES') return new Error(`Порт ${port} недоступен: его занимает другая программа или он закрыт системой. Выберите другой порт (больше 1024): --port <номер> или "port" в config.json.`);
  return error;
}

/** OBS-003 `app.start`: what runs and with which settings — never the monitoring token. */
function startFields(config: Config): Record<string, unknown> {
  let version = 'unknown', commit: string | undefined;
  try { version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version; } catch { /* optional */ }
  try {
    const git = new URL('../../../.git/', import.meta.url);
    const head = readFileSync(new URL('HEAD', git), 'utf8').trim();
    commit = (head.startsWith('ref: ') ? readFileSync(new URL(head.slice(5), git), 'utf8') : head).trim().slice(0, 12);
  } catch { /* not a git checkout */ }
  const { monitoring, ...rest } = config;
  return { env: config.env, version, commit, node: process.version, platform: `${process.platform} ${process.arch}`, pid: process.pid, config: { ...rest, monitoring: { ...monitoring, token: monitoring.token ? '[задан]' : null } } };
}

/** `languagePort` overrides config.language for tests; production selects the adapter by config. */
export async function startApplication(config: Config, createGame: CreateGame, logger: Logger, languagePort?: LanguagePort, obs: AppObservability = { metrics: new MetricsRegistry() }) {
  const log = logger.child('app');
  const { metrics } = obs;
  log.info('app.start', 'Запуск сервера', startFields(config));
  try { if (!(await stat(join(config.clientDir, 'index.html'))).isFile()) throw new Error(); }
  catch { throw new Error(`Нет сборки ${config.clientDir}/index.html. Выполните npm --prefix client run build`); }
  try { if (!(await stat(config.worldDir)).isDirectory()) throw new Error(); }
  catch { throw new Error(`Нет мира ${config.worldDir}. Выполните npm --prefix client run world:generate`); }

  const dbLog = logger.child('db');
  const dbTime = metrics.histogram('db_operation_ms', 'Длительность операции хранилища', MS_BUCKETS);
  const dbErrors = metrics.counter('db_errors_total', 'Ошибки операций хранилища');
  const observe: DatabaseObserver = (operation, durationMs, error) => {
    dbTime.observe(durationMs, { operation });
    if (error) { dbErrors.inc({ operation }); dbLog.warn('db.operation.failed', 'Операция хранилища не выполнена', { operation, durationMs: Math.round(durationMs), error }); }
    else if (durationMs > SLOW_DB_MS) dbLog.warn('db.slow', 'Медленная операция хранилища', { operation, durationMs: Math.round(durationMs) });
  };
  const db = openDatabase(config.dbPath);
  const schema = Number((db.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number }).version);
  dbLog.info('db.opened', 'База данных открыта', { path: config.dbPath, schema });
  metrics.gauge('db_size_bytes', 'Размер файла БД и WAL', () => databaseBytes(config.dbPath));
  const stores = sqliteStores(db, Date.now, observe);
  const clientPerf = new ClientPerfStore(systemClock);
  metrics.gauge('auth_sessions_active', 'Действующие сессии по области', () => (['game', 'admin'] as const).map((scope) => ({ labels: { scope }, value: Number((db.prepare('SELECT count(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ? AND scope = ?').get(Date.now(), scope) as { n: number }).n) })));
  metrics.gauge('disk_free_bytes', 'Свободно на диске в каталоге БД', () => { try { const fs = statfsSync(dirname(config.dbPath)); return fs.bavail * fs.bsize; } catch { return 0; } });
  const auth = createAuthService({ accounts: stores.accounts, sessions: stores.sessions, clock: systemClock, ttlMs: config.sessionTtlMs, canAdmit: accountId => game?.canAdmit ? game.canAdmit(accountId ?? '') : !game || game.activePlayers() < config.maxPlayers, maxSessions: config.auth.maxSessions, adminTtlMs: config.admin.sessionTtlMs, passwordless: config.auth.passwordless, logger: logger.child('auth'), metrics });
  if (config.auth.passwordless) log.warn('auth.passwordless.enabled', `Вход без пароля включён (${config.env}); в production он запрещён`);
  let npc: ReturnType<typeof createNpcDialogueService> | undefined;
  let language: LanguagePort | undefined;
  let languageReady = false;
  let game: Awaited<ReturnType<CreateGame>> | undefined;
  let http: ReturnType<typeof createHttpServer> | undefined;
  const languageTime = metrics.histogram('babylon_language_ms', 'Длительность языковой операции BABEL', MS_BUCKETS);
  try {
    npc = createNpcDialogueService({ responder: createResponder(config.npc.adapter, config.npc.options, { clock: systemClock, scheduler: systemScheduler }), dialogue: stores.dialogue, clock: systemClock, scheduler: systemScheduler, logger, metrics }, config.npc);
    await npc.start();
    language = languagePort ?? createLanguagePort(config.language.adapter, config.language.options);
    try { await language.start(); languageReady = true; logger.child('language').info('language.ready', 'Переводчик готов', { mode: language.mode, languages: language.languages }); }
    catch (error) { logger.child('language').error('language.unavailable', 'LanguagePort недоступен', { error }); language = unavailableLanguagePort(language); }
    // CONTENT: one live catalogue for the world, NPC dialogue and BABEL; seeded from npcs.json once the maps are loaded.
    let catalog: NpcCatalog | undefined;
    const babylonLog = logger.child('babylon');
    const babylon = new BabylonService({
      store: sqliteBabylon(db), language, generate: npc.generate, now: Date.now, id: () => randomId('b'), location: accountId => game?.location?.(accountId) ?? null, npc: id => babylonNpc(catalog?.get(id)), peerLocation: playerId => game?.playerLocation?.(playerId) ?? null,
      measure: (kind, durationMs, success) => {
        languageTime.observe(durationMs, { kind, success: String(success) });
        if (success) babylonLog.debug('babylon.language', 'Языковая операция BABEL', { kind, durationMs });
        else babylonLog.warn('babylon.translation.failed', 'Языковая операция BABEL не выполнена', { kind, durationMs });
      },
    });
    game = await createGame(config, { sessions: auth, players: stores.players, worldLife: sqliteWorldLife(db), avatars: stores.avatars, equipment: stores.equipment, npc, babylon, clock: systemClock, scheduler: systemScheduler, logger, metrics, pingIntervalMs: config.monitoring.pingIntervalMs, validateOutgoing: config.monitoring.validateOutgoing, clientPerf: (playerId) => clientPerf.latest(playerId),
      npcSource: (maps, seed) => {
        catalog = new NpcCatalog({ store: sqliteNpcStore(db), maps: (mapId) => maps.get(mapId), clock: systemClock, babelRequired: BABEL_NPC_IDS, mapFiguresFromServer: config.content.mapFiguresFromServer, logger: logger.child('content'), metrics });
        catalog.seed(seed);
        return catalog;
      } });
    const runtime = game;
    auth.onRevoked((hashes, reason) => runtime.closeSessions(hashes, REVOKE_MESSAGES[reason]));
    const npcService = npc;
    metrics.gauge('npc_responder_ready', 'Ответчик NPC готов (1/0)', () => npcService.ready() ? 1 : 0);
    metrics.gauge('language_ready', 'Переводчик готов (1/0)', () => languageReady ? 1 : 0);
    const counters = new CounterWindow();
    const sample = () => counters.sample(Date.now(), {
      timeouts: metrics.value('npc_requests_total', { outcome: 'timeout' }),
      requests: metrics.value('npc_requests_total'),
      dbErrors: metrics.value('db_errors_total'),
      logDropped: metrics.value('log_dropped_total'),
      completed: metrics.value('npc_requests_total', { outcome: 'completed' }),
      busy: metrics.value('npc_requests_total', { outcome: 'player-busy' }) + metrics.value('npc_requests_total', { outcome: 'server-busy' }),
      http5xx: (((metrics.snapshot().http_requests_total ?? []) as { labels: Record<string, string>; value: number }[]).filter((s) => s.labels.status?.startsWith('5')).reduce((sum, s) => sum + s.value, 0)),
    });
    sample();
    const sampler = setInterval(sample, 30_000); sampler.unref();
    const health = () => {
      const stats = runtime.stats();
      const requests = counters.delta('requests');
      let diskFreeBytes: number | null = null;
      try { const fs = statfsSync(dirname(config.dbPath)); diskFreeBytes = fs.bavail * fs.bsize; } catch { /* unknown */ }
      return evaluateHealth({
        tickP95Ms: stats?.tickP95Ms ?? null, broadcastP95Ms: stats?.broadcastP95Ms ?? null, eventLoopP99Ms: obs.process?.().eventLoopP99Ms ?? null,
        npcReady: npcService.ready(), languageReady, timeoutShare: requests ? counters.delta('timeouts') / requests : null,
        dbErrors5m: counters.delta('dbErrors'), logDropped5m: counters.delta('logDropped'), diskFreeBytes, players: runtime.presence(),
      });
    };
    // ADMIN-004–006: one snapshot for the panel, built from what is already collected (OBS-013/014).
    const about = startFields(config);
    const p95 = (name: string): number | null => {
      const series = (metrics.snapshot()[name] ?? []) as { count: number; p95: number | null }[];
      const values = series.filter((s) => s.count > 0 && s.p95 !== null).map((s) => s.p95 as number);
      return values.length ? Math.max(...values) : null;
    };
    const adminStatus = () => {
      const stats = runtime.stats(); const players = runtime.presence(); const errors = obs.errors?.() ?? [];
      return {
        env: config.env, version: about.version, commit: about.commit ?? null, uptimeSeconds: Math.floor(process.uptime()),
        health: health(), seats: { used: players.length, max: config.maxPlayers }, npcReady: npcService.ready(), languageReady,
        server: {
          tick: stats && { p50: stats.tickP50Ms, p95: stats.tickP95Ms, max: stats.tickMaxMs },
          broadcast: stats && { p95: stats.broadcastP95Ms, max: stats.broadcastMaxMs },
          npc: { ...npcService.state(), requests5m: counters.delta('requests'), completed5m: counters.delta('completed'), timeouts5m: counters.delta('timeouts'), busy5m: counters.delta('busy'), firstPartialP95: p95('npc_first_partial_ms'), generationP95: p95('npc_generation_ms') },
          memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, eventLoopP99: obs.process?.().eventLoopP99Ms ?? null },
          errors: { last5m: errors.reduce((n, e) => n + e.last5m, 0), last60m: errors.reduce((n, e) => n + e.last60m, 0), byEvent: errors, http5xx5m: counters.delta('http5xx'), db5m: counters.delta('dbErrors'), logDropped5m: counters.delta('logDropped') },
          diskFreeBytes: metrics.value('disk_free_bytes') || null, dbBytes: metrics.value('db_size_bytes') || null,
        },
        players, warnings: (obs.recorder?.warnings() ?? []).map((r) => ({ ts: r.ts, level: r.level, event: r.event, msg: r.msg })).reverse(),
      };
    };
    http = createHttpServer(config, {
      admin: { catalog: () => catalog, status: adminStatus },
      auth, game, avatars: stores.avatars, equipment: stores.equipment, logger, clock: systemClock, metrics, clientPerf, npcReady: () => npcService.ready(), babylon, cancelBabylon: npc.cancelConnection,
      operator: { languageReady: () => languageReady, health, warnings: () => obs.recorder?.warnings() ?? [], dump: (reason) => obs.recorder?.dump(reason) ?? null },
    });
    obs.setSnapshot?.(() => ({ game: runtime.state(), npc: npcService.state() }));
    game.attach(http.server);
    stores.sessions.prune(Date.now() - 86400000);
    await new Promise<void>((resolve, reject) => {
      const failed = (error: NodeJS.ErrnoException) => reject(listenError(error, config.port));
      http!.server.once('error', failed);
      http!.server.listen(config.port, config.host, () => { http!.server.removeListener('error', failed); resolve(); });
    });
    const stopSampler = () => clearInterval(sampler);
    http.server.once('close', stopSampler);
  } catch (error) {
    log.error('app.start.failed', 'Запуск не удался', { error });
    http?.rejectNewRequests();
    try { await language?.stop().catch(() => {}); await npc?.stop(); } finally {
      try { await game?.stop('startup-failure'); } finally { http?.server.close(); db.close(); }
    }
    throw error;
  }
  const runtime = game; const npcService = npc; const transport = http; const languageService = language!;
  const cleanup = setInterval(() => {
    try { stores.sessions.prune(Date.now() - 86400000); } catch (error) { log.error('db.transaction.failed', 'Не удалось очистить сессии', { operation: 'sessions.prune', error }); }
  }, 3600000);
  const address = transport.server.address();
  log.info('app.ready', 'Сервер готов', { host: config.host, port: address && typeof address !== 'string' ? address.port : config.port, maps: runtime.maps.map((map) => map.mapId) });
  let stopping: Promise<void> | undefined;
  return {
    server: transport.server,
    stop(reason = 'shutdown'): Promise<void> {
      if (stopping) return stopping;
      stopping = (async () => {
        const began = performance.now();
        const phase = (name: string) => log.info('app.stop.phase', 'Остановка: фаза завершена', { phase: name, durationMs: Math.round(performance.now() - began) });
        log.info('app.stop', 'Остановка сервера', { reason });
        transport.rejectNewRequests(); clearInterval(cleanup);
        const closed = new Promise<void>((resolve) => transport.server.close(() => resolve()));
        try {
          const npcStopped = npcService.stop(); // Aborts synchronously before closing connections.
          const gameStopped = runtime.stop(reason);
          const results = await Promise.allSettled([npcStopped, gameStopped, languageService.stop()]);
          phase('modules');
          for (const result of results) if (result.status === 'rejected') log.error('app.stop.failed', 'Модуль не остановился', { error: result.reason });
          if (results.some((result) => result.status === 'rejected')) throw new Error('Ошибка остановки модуля');
        }
        finally { transport.server.closeAllConnections(); await closed; db.close(); phase('closed'); log.info('app.stop.done', 'Сервер остановлен', { durationMs: Math.round(performance.now() - began) }); }
      })();
      return stopping;
    },
  };
}

/** Database file plus WAL, for the db_size_bytes gauge. */
function databaseBytes(path: string): number {
  let total = 0;
  for (const file of [path, `${path}-wal`]) { try { total += statSync(file).size; } catch { /* missing */ } }
  return total;
}
