import type { NpcAnswer } from '../contracts.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import { MS_BUCKETS, MetricsRegistry, type Metrics } from '../common/metrics.ts';

/** Internal per-job budget. Reading it never restores time consumed by a wall-clock jump. */
export interface GenerationBudget {
  deadlineAt(): number;
  expired(): boolean;
}
export interface GenerationOptions {
  readonly requestId?: string; readonly timeoutMs?: number; readonly kind?: string;
  /** Synchronous local diagnostics, called before abort clears the adapter snapshot. */
  readonly onTimeout?: () => void;
}
type Work = (signal: AbortSignal, deadline: number, budget: GenerationBudget) => Promise<string>;
interface Job {
  playerId: string; connectionId: string; requestId?: string; kind: string; deadline: number; monotonicDeadline: number; controller: AbortController;
  work: Work; onTimeout?: () => void;
  running: boolean; settled: boolean; resolve: (answer: NpcAnswer) => void;
  acceptedAt: number; startedAt: number;
  timeout?: TimerHandle; stuck?: TimerHandle;
}
/** One admission queue for NPC, chat translation and dictionary suggestions. */
export function createGenerationQueue(deps: { clock: Clock; scheduler: Scheduler; logger: Logger; metrics?: Metrics; onIdle?: () => void }, config: { maxConcurrent: number; maxUnfinished: number; timeoutMs: number }) {
  const { clock, scheduler } = deps;
  const logger = deps.logger.child('npc');
  const metrics = deps.metrics ?? new MetricsRegistry();
  const outcomes = metrics.counter('npc_requests_total', 'Запросы к модели по виду и исходу');
  const waitTime = metrics.histogram('npc_queue_wait_ms', 'Ожидание в очереди генераций', MS_BUCKETS);
  const runTime = metrics.histogram('npc_generation_ms', 'Длительность генерации', MS_BUCKETS);
  const stuckSlots = metrics.counter('npc_stuck_slots_total', 'Генерации, не завершившиеся за 2 с после abort');
  const jobs = new Set<Job>(), queue: Job[] = [];
  let active = 0, stopped = false;
  const monotonicNow = () => clock.monotonicNow?.() ?? clock.now();
  function remainingMs(job: Job, wall = clock.now()): number {
    const mono = monotonicNow();
    job.monotonicDeadline = Math.min(job.monotonicDeadline, mono + job.deadline - wall);
    return Math.min(job.deadline - wall, job.monotonicDeadline - mono);
  }
  metrics.gauge('npc_queue', 'Задачи очереди генераций по состоянию', () => [{ labels: { state: 'queued' }, value: queue.length }, { labels: { state: 'running' }, value: active }]);
  const fields = (job: Job) => ({ playerId: job.playerId, connectionId: job.connectionId, requestId: job.requestId, kind: job.kind });
  const check = (): void => {
    const players = new Set([...jobs].map(job => job.playerId));
    if (active < 0 || active > config.maxConcurrent || jobs.size > config.maxUnfinished || players.size !== jobs.size) {
      logger.error('invariant.violated', 'Счётчики очереди генераций не сходятся', { invariant: 'npc.queue.counters', active, jobs: jobs.size, queued: queue.length, players: players.size });
    }
  };
  const settle = (job: Job, answer: NpcAnswer) => {
    if (job.settled) return;
    job.settled = true; job.resolve(answer);
    const now = clock.now();
    outcomes.inc({ kind: job.kind, outcome: answer.ok ? 'completed' : answer.reason });
    const durations = { waitMs: (job.startedAt || now) - job.acceptedAt, runMs: job.startedAt ? now - job.startedAt : 0 };
    if (answer.ok) logger.info('npc.request.completed', 'Ответ готов', { ...fields(job), ...durations, chars: answer.text.length });
    else if (answer.reason === 'timeout') logger.warn('npc.request.timeout', 'Генерация не уложилась в дедлайн', { ...fields(job), ...durations });
    else if (answer.reason === 'cancelled') logger.info('npc.request.cancelled', 'Генерация отменена', { ...fields(job), ...durations });
    else logger.warn('npc.request.failed', 'Генерация завершилась ошибкой', { ...fields(job), ...durations, reason: answer.reason });
  };
  function remove(job: Job): void {
    jobs.delete(job);
    if (job.timeout) scheduler.clearTimeout(job.timeout);
    if (job.stuck) scheduler.clearTimeout(job.stuck);
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
  }
  function abort(job: Job, reason: 'cancelled' | 'timeout'): void {
    if (job.controller.signal.aborted) return;
    if (reason === 'timeout' && job.running) { try { job.onTimeout?.(); } catch { /* Diagnostics cannot prevent cancellation. */ } }
    job.controller.abort(); settle(job, { ok: false, reason });
    if (!job.running) { remove(job); pump(); }
    // A settled player result is not proof of physical stop. Keep both quotas until work settles.
    else job.stuck = scheduler.setTimeout(() => { stuckSlots.inc(); logger.error('npc.slot.stuck', 'Генерация не завершилась после abort', fields(job)); }, 2000);
  }
  async function run(job: Job): Promise<void> {
    const budget: GenerationBudget = {
      deadlineAt() { const wall = clock.now(); return Math.min(job.deadline, wall + remainingMs(job, wall)); },
      expired() { if (remainingMs(job) <= 0) abort(job, 'timeout'); return job.controller.signal.aborted; },
    };
    try {
      const text = await job.work(job.controller.signal, budget.deadlineAt(), budget);
      if (budget.expired()) return;
      if (!text.trim()) throw new Error('Empty answer');
      settle(job, { ok: true, text });
    } catch {
      if (!job.controller.signal.aborted) {
        // Never serialize an arbitrary model exception, prompt, stderr or local path.
        logger.warn('npc.request.error', 'Ответчик бросил исключение', { ...fields(job), code: 'unavailable' });
        settle(job, { ok: false, reason: 'unavailable' });
      }
    } finally {
      runTime.observe(Math.max(0, clock.now() - job.startedAt), { kind: job.kind });
      active--; remove(job); pump(); check();
      if (active === 0) deps.onIdle?.();
    }
  }
  function pump(): void {
    while (!stopped && active < config.maxConcurrent && queue.length) {
      const job = queue.shift()!;
      if (remainingMs(job) <= 0) { abort(job, 'timeout'); continue; }
      job.running = true; job.startedAt = clock.now(); active++;
      waitTime.observe(Math.max(0, job.startedAt - job.acceptedAt), { kind: job.kind });
      logger.debug('npc.request.started', 'Генерация началась', { ...fields(job), waitMs: job.startedAt - job.acceptedAt, active });
      void run(job);
    }
  }
  const reject = (playerId: string, connectionId: string, options: GenerationOptions, reason: 'player-busy' | 'server-busy' | 'unavailable'): Promise<NpcAnswer> => {
    outcomes.inc({ kind: options.kind ?? 'npc', outcome: reason });
    logger.info('npc.rejected', 'Запрос к модели не принят', { playerId, connectionId, requestId: options.requestId, kind: options.kind ?? 'npc', reason, unfinished: jobs.size });
    return Promise.resolve({ ok: false, reason });
  };
  return {
    start() { stopped = false; },
    generate(playerId: string, connectionId: string, work: Work, options: GenerationOptions = {}): Promise<NpcAnswer> {
      if (stopped) return reject(playerId, connectionId, options, 'unavailable');
      if ([...jobs].some(job => job.playerId === playerId)) return reject(playerId, connectionId, options, 'player-busy');
      if (jobs.size >= config.maxUnfinished) return reject(playerId, connectionId, options, 'server-busy');
      return new Promise(resolve => {
        const timeoutMs = options.timeoutMs ?? config.timeoutMs;
        const now = clock.now();
        const job: Job = { playerId, connectionId, ...(options.requestId ? { requestId: options.requestId } : {}), kind: options.kind ?? 'npc', work, ...(options.onTimeout ? { onTimeout: options.onTimeout } : {}), deadline: now + timeoutMs, monotonicDeadline: monotonicNow() + timeoutMs, controller: new AbortController(), running: false, settled: false, resolve, acceptedAt: now, startedAt: 0 };
        jobs.add(job); queue.push(job);
        logger.debug('npc.request.accepted', 'Запрос к модели принят', { ...fields(job), timeoutMs, queued: queue.length });
        job.timeout = scheduler.setTimeout(() => abort(job, 'timeout'), timeoutMs);
        pump(); check();
      });
    },
    /** Runtime health affects NPC jobs only; Babylon can use a separate healthy LanguagePort. */
    failQueuedNpc() {
      for (const job of [...queue]) if (job.kind === 'npc' || job.kind === 'npc-stream') {
        job.controller.abort(); settle(job, { ok: false, reason: 'unavailable' }); remove(job);
      }
    },
    cancel(connectionId: string, requestId: string) { for (const job of [...jobs]) if (job.connectionId === connectionId && job.requestId === requestId) abort(job, 'cancelled'); },
    cancelConnection(connectionId: string) { for (const job of [...jobs]) if (job.connectionId === connectionId) abort(job, 'cancelled'); },
    stop() { stopped = true; for (const job of [...jobs]) abort(job, 'cancelled'); },
    state: () => ({ queued: queue.length, running: active, unfinished: jobs.size }),
  };
}
