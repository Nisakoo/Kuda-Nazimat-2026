import type { NpcAnswer } from '../contracts.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
/** requestId lets one question be cancelled; timeoutMs overrides the queue default (streamed answers). */
export interface GenerationOptions { readonly requestId?: string; readonly timeoutMs?: number }
interface Job {
  playerId: string; connectionId: string; requestId?: string; deadline: number; controller: AbortController;
  work: (signal: AbortSignal, deadline: number) => Promise<string>;
  running: boolean; settled: boolean; resolve: (answer: NpcAnswer) => void;
  timeout?: TimerHandle; stuck?: TimerHandle;
}
/** Shared admission for NPC, chat translation and dictionary suggestions. */
export function createGenerationQueue(deps: { clock: Clock; scheduler: Scheduler; logger: Logger }, config: { maxConcurrent: number; maxUnfinished: number; timeoutMs: number }) {
  const { clock, scheduler, logger } = deps;
  const jobs = new Set<Job>(), queue: Job[] = [];
  let active = 0, stopped = false;
  const settle = (job: Job, answer: NpcAnswer) => { if (!job.settled) { job.settled = true; job.resolve(answer); } };
  function remove(job: Job): void {
    jobs.delete(job);
    if (job.timeout) scheduler.clearTimeout(job.timeout);
    if (job.stuck) scheduler.clearTimeout(job.stuck);
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
  }
  function abort(job: Job, reason: 'cancelled' | 'timeout'): void {
    if (job.controller.signal.aborted) return;
    job.controller.abort(); settle(job, { ok: false, reason });
    if (!job.running) { remove(job); pump(); }
    else job.stuck = scheduler.setTimeout(() => logger.error('Генерация не завершилась после abort', { playerId: job.playerId }), 2000);
  }
  async function run(job: Job): Promise<void> {
    try {
      const text = await job.work(job.controller.signal, job.deadline);
      if (job.controller.signal.aborted) return;
      if (clock.now() >= job.deadline) { abort(job, 'timeout'); return; }
      if (!text.trim()) throw new Error('Empty answer');
      settle(job, { ok: true, text });
    } catch { if (!job.controller.signal.aborted) settle(job, { ok: false, reason: 'unavailable' }); }
    finally { active--; remove(job); pump(); }
  }
  function pump(): void {
    while (!stopped && active < config.maxConcurrent && queue.length) {
      const job = queue.shift()!;
      if (clock.now() >= job.deadline) { abort(job, 'timeout'); continue; }
      job.running = true; active++; void run(job);
    }
  }
  return {
    start() { stopped = false; },
    generate(playerId: string, connectionId: string, work: Job['work'], options: GenerationOptions = {}): Promise<NpcAnswer> {
      if (stopped) return Promise.resolve({ ok: false, reason: 'unavailable' });
      if ([...jobs].some(job => job.playerId === playerId)) return Promise.resolve({ ok: false, reason: 'player-busy' });
      if (jobs.size >= config.maxUnfinished) return Promise.resolve({ ok: false, reason: 'server-busy' });
      return new Promise(resolve => {
        const timeoutMs = options.timeoutMs ?? config.timeoutMs;
        const job: Job = { playerId, connectionId, ...(options.requestId ? { requestId: options.requestId } : {}), work, deadline: clock.now() + timeoutMs, controller: new AbortController(), running: false, settled: false, resolve };
        jobs.add(job); queue.push(job);
        job.timeout = scheduler.setTimeout(() => abort(job, 'timeout'), timeoutMs);
        pump();
      });
    },
    cancel(connectionId: string, requestId: string) { for (const job of [...jobs]) if (job.connectionId === connectionId && job.requestId === requestId) abort(job, 'cancelled'); },
    cancelConnection(connectionId: string) { for (const job of [...jobs]) if (job.connectionId === connectionId) abort(job, 'cancelled'); },
    stop() { stopped = true; for (const job of [...jobs]) abort(job, 'cancelled'); },
  };
}
