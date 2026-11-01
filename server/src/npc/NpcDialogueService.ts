import type { NpcAnswer, NpcQuestion, NpcQuestions } from '../contracts.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import type { NpcResponder } from './NpcResponder.ts';
import type { DialogueStore } from './ports.ts';
import { isNpcFailureCode } from './failureCodes.ts';
import { NPC_TIMING } from '../../../shared/protocol/npcTiming.ts';

interface Job {
  question: NpcQuestion; deadline: number; monotonicDeadline: number; controller: AbortController; running: boolean; settled: boolean;
  resolve: (answer: NpcAnswer) => void; timeout?: TimerHandle; stuck?: TimerHandle;
}
export function normalizeAnswer(text: string): string { return text.replace(/\r\n/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '').trim().slice(0, 4000); }
export function createNpcDialogueService(deps: { responder: NpcResponder; dialogue: DialogueStore; clock: Clock; scheduler: Scheduler; logger: Logger }, config: { maxConcurrent: number; maxUnfinished: number; timeoutMs: number }): NpcQuestions & { start(): Promise<void>; stop(): Promise<void>; ready(): boolean } {
  const { responder, dialogue, clock, scheduler, logger } = deps;
  const jobs = new Set<Job>(); const queue: Job[] = [];
  const monotonicNow = () => clock.monotonicNow?.() ?? clock.now();
  function remainingMs(job: Job, wall = clock.now()): number {
    const mono = monotonicNow();
    // Queue time consumes the original budget. A forward wall jump can shorten it,
    // but a later rollback cannot restore budget already observed as consumed.
    job.monotonicDeadline = Math.min(job.monotonicDeadline, mono + (job.deadline - wall));
    return Math.min(job.deadline - wall, job.monotonicDeadline - mono);
  }
  let active = 0; let available = false; let stopped = false;
  let recoveryTimer: TimerHandle | undefined;
  let starting: Promise<void> | undefined;
  let runtimeFailureLogged = true;
  const backendReady = () => responder.status?.() !== 'unavailable';
  function logRuntimeFailure(): void {
    if (stopped || runtimeFailureLogged) return;
    const failure = responder.lastFailure?.();
    // Explicit cancellation/shutdown is normal, not an inference failure.
    if (failure === 'aborted' || failure === 'stopped') return;
    runtimeFailureLogged = true;
    logger.error('NpcResponder недоступен во время игры', { code: isNpcFailureCode(failure) ? failure : 'unavailable' });
  }
  function logTiming(reason: 'timeout' | 'completed'): void {
    // Diagnostics are local and numeric only. Optional adapter hooks must not
    // break cancellation or disclose arbitrary data from another adapter.
    try {
      const sample = responder.diagnostics?.();
      if (!sample || !['preparing', 'prefill', 'decoding', 'complete'].includes(sample.stage)) return;
      const fields: Record<string, string | number> = { reason, stage: sample.stage };
      for (const [key, max] of [['elapsedMs', NPC_TIMING.maxMs], ['promptTokens', 1792], ['firstTokenMs', NPC_TIMING.maxMs], ['outputChunks', 4096]] as const) {
        const value = sample[key];
        if (value !== undefined) {
          if (!Number.isSafeInteger(value) || value < 0 || value > max) return;
          fields[key] = value;
        }
      }
      if (!Object.hasOwn(fields, 'elapsedMs')) return;
      logger.info('Этапы ответа NPC', fields);
    } catch { /* Diagnostic failure cannot extend a deadline or affect delivery. */ }
  }
  async function startResponder(): Promise<void> {
    if (starting) return starting;
    const operation = (async () => {
      try {
        await responder.start(); available = !stopped && backendReady();
        if (available) {
          runtimeFailureLogged = false;
          if (responder.status) logger.info('NPC готов к вопросам', { status: 'ready' });
        }
      }
      catch {
        available = false; runtimeFailureLogged = true;
        const code = responder.lastFailure?.();
        logger.error('NpcResponder недоступен: проверьте локальные пакеты, модель, платформу и профиль', { code: isNpcFailureCode(code) ? code : 'unavailable' });
      }
    })();
    starting = operation;
    try { await operation; } finally { if (starting === operation) starting = undefined; }
  }
  function scheduleRecovery(): void {
    // Only an adapter with live health opts into recovery. Never retry a player's question.
    if (!responder.status || stopped || active > 0 || starting || recoveryTimer) return;
    recoveryTimer = scheduler.setTimeout(() => {
      recoveryTimer = undefined;
      if (!stopped && active === 0) void startResponder();
    }, 2000);
  }
  function failQueued(): void {
    for (const job of [...queue]) {
      job.controller.abort(); settle(job, { ok: false, reason: 'unavailable' }); remove(job);
    }
  }
  const settle = (job: Job, answer: NpcAnswer) => { if (!job.settled) { job.settled = true; job.resolve(answer); } };
  function remove(job: Job): void {
    jobs.delete(job);
    if (job.timeout) scheduler.clearTimeout(job.timeout);
    if (job.stuck) scheduler.clearTimeout(job.stuck);
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
  }
  function abort(job: Job, reason: 'cancelled' | 'timeout'): void {
    if (job.controller.signal.aborted) return;
    if (reason === 'timeout' && job.running) logTiming('timeout');
    job.controller.abort(); settle(job, { ok: false, reason });
    if (reason === 'timeout' && job.running && responder.status) {
      logger.error('Истёк deadline ответа NPC', { code: 'timeout' });
    }
    if (!job.running) { remove(job); pump(); }
    else job.stuck = scheduler.setTimeout(() => logger.error('NPC не завершился после abort', { playerId: job.question.player.playerId }), 2000);
  }
  async function run(job: Job): Promise<void> {
    const q = job.question;
    try {
      const history = dialogue.history(q.player.playerId, q.npc.id).slice(-6);
      if (job.controller.signal.aborted) return;
      // Read the remaining budget after synchronous history IO, immediately before dispatch.
      const wall = clock.now(); const remaining = remainingMs(job, wall);
      if (remaining <= 0) { abort(job, 'timeout'); return; }
      const deadlineAt = Math.min(job.deadline, wall + remaining);
      const result = await responder.answer({ requestKey: `${q.connectionId}:${q.requestId}`, playerId: q.player.playerId, playerName: q.player.displayName, npc: q.npc, question: q.question, history, locale: 'ru', deadlineAt }, job.controller.signal);
      if (job.controller.signal.aborted) return;
      const text = normalizeAnswer(result.text);
      if (!text) throw new Error('Empty answer');
      if (remainingMs(job) <= 0) { abort(job, 'timeout'); return; }
      // Synchronous deadline check + SQLite commit: cancellation cannot interleave here.
      dialogue.append(q.player.playerId, q.npc.id, q.question, text, clock.now());
      settle(job, { ok: true, text });
      logTiming('completed');
    } catch {
      if (!job.controller.signal.aborted) settle(job, { ok: false, reason: 'unavailable' });
    } finally {
      active--; remove(job);
      if (!backendReady()) { logRuntimeFailure(); available = false; failQueued(); scheduleRecovery(); }
      pump();
    }
  }
  function pump(): void {
    while (!stopped && available && backendReady() && active < config.maxConcurrent && queue.length) {
      const job = queue.shift()!;
      if (remainingMs(job) <= 0) { abort(job, 'timeout'); continue; }
      job.running = true; active++; void run(job);
    }
  }
  return {
    async start() {
      stopped = false;
      await startResponder();
    },
    ready: () => available && !stopped && backendReady(),
    ask(question) {
      if (!available || stopped || !backendReady()) {
        if (!backendReady()) logRuntimeFailure();
        available = false; failQueued(); scheduleRecovery();
        return Promise.resolve({ ok: false, reason: 'unavailable' });
      }
      if ([...jobs].some((job) => job.question.player.playerId === question.player.playerId)) return Promise.resolve({ ok: false, reason: 'player-busy' });
      if (jobs.size >= config.maxUnfinished) return Promise.resolve({ ok: false, reason: 'server-busy' });
      return new Promise((resolve) => {
        const job: Job = { question, deadline: clock.now() + config.timeoutMs, monotonicDeadline: monotonicNow() + config.timeoutMs, controller: new AbortController(), running: false, settled: false, resolve };
        jobs.add(job); queue.push(job);
        job.timeout = scheduler.setTimeout(() => abort(job, 'timeout'), config.timeoutMs);
        pump();
      });
    },
    cancelConnection(connectionId) { for (const job of [...jobs]) if (job.question.connectionId === connectionId) abort(job, 'cancelled'); },
    async stop() {
      stopped = true; available = false;
      if (recoveryTimer) scheduler.clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
      for (const job of [...jobs]) abort(job, 'cancelled');
      await responder.stop();
      await starting;
      available = false;
    },
  };
}
