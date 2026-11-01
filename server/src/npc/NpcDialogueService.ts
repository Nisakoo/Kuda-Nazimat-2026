import type { NpcQuestions } from '../contracts.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import { MS_BUCKETS, MetricsRegistry, type Metrics } from '../common/metrics.ts';
import type { NpcResponder } from './NpcResponder.ts';
import type { DialogueStore } from './ports.ts';
import { createGenerationQueue } from './GenerationQueue.ts';
import { isNpcFailureCode } from './failureCodes.ts';
import { NPC_TIMING } from '../../../shared/protocol/npcTiming.ts';

export function normalizeAnswer(text: string): string { return text.replace(/\r\n/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '').trim().slice(0, 4000); }
export function createNpcDialogueService(deps: { responder: NpcResponder; dialogue: DialogueStore; clock: Clock; scheduler: Scheduler; logger: Logger; metrics?: Metrics }, config: { maxConcurrent: number; maxUnfinished: number; timeoutMs: number; streamTimeoutMs?: number }) {
  const { responder, dialogue, clock, scheduler } = deps;
  const logger = deps.logger.child('npc');
  const firstPartial = (deps.metrics ?? new MetricsRegistry()).histogram('npc_first_partial_ms', 'Время от приёма вопроса до первого временного текста', MS_BUCKETS);
  const queue = createGenerationQueue({ ...deps, onIdle: scheduleRecovery }, config);
  /** ADMIN-SRV-005: unfinished game-channel questions per NPC, so a withdrawn NPC can cancel them. */
  const inflight = new Map<string, Set<{ connectionId: string; requestId: string }>>();
  let available = false, stopped = false;
  let starting: Promise<void> | undefined;
  let recoveryTimer: TimerHandle | undefined;
  let recoveryAttempted = false;
  let runtimeFailureLogged = true;
  const backendReady = () => responder.status?.() !== 'unavailable';
  function logRuntimeFailure(): void {
    if (stopped || runtimeFailureLogged) return;
    const failure = responder.lastFailure?.();
    // Explicit cancellation/shutdown is normal, not an inference failure.
    if (failure === 'aborted' || failure === 'stopped') return;
    runtimeFailureLogged = true;
    logger.error('npc.responder.failed', 'NpcResponder недоступен во время игры', { code: isNpcFailureCode(failure) ? failure : 'unavailable' });
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
      logger.info('npc.answer.timing', 'Этапы ответа NPC', fields);
    } catch { /* Diagnostic failure cannot extend a deadline or affect delivery. */ }
  }
  async function startResponder(): Promise<void> {
    if (starting) return starting;
    const operation = (async () => {
      try {
        await responder.start(); available = !stopped && backendReady();
        if (available) {
          runtimeFailureLogged = false;
          logger.info('npc.responder.ready', 'NPC готов к вопросам', { status: 'ready' });
          recoveryAttempted = false;
        }
      }
      catch {
        available = false; runtimeFailureLogged = true;
        const code = responder.lastFailure?.();
        logger.error('npc.responder.unavailable', 'NpcResponder недоступен: проверьте локальные пакеты, модель, платформу и профиль', { code: isNpcFailureCode(code) ? code : 'unavailable' });
      }
    })();
    starting = operation;
    try { await operation; } finally { if (starting === operation) starting = undefined; }
  }
  function scheduleRecovery(): void {
    // Only an adapter with live health opts into recovery. Never retry a player's question.
    if (!responder.status || stopped || queue.state().running > 0 || available || starting || recoveryTimer || recoveryAttempted) return;
    recoveryAttempted = true;
    recoveryTimer = scheduler.setTimeout(() => {
      recoveryTimer = undefined;
      if (stopped) return;
      if (queue.state().running === 0) void startResponder();
      else recoveryAttempted = false; // A Babylon job took the shared slot; onIdle can schedule recovery later.
    }, 2000);
  }

  function observeFailure(): void {
    if (backendReady()) return;
    logRuntimeFailure(); available = false;
    queue.failQueuedNpc(); scheduleRecovery();
  }
  const ask: NpcQuestions['ask'] = (q, onPartial) => {
    const authorized = () => typeof q.sessionId === 'string' && q.sessionId.length > 0 && q.authorize?.() === true;
    if (!authorized()) return Promise.resolve({ ok: false, reason: 'cancelled' });
    observeFailure();
    if (!available || stopped || !backendReady()) {
      scheduleRecovery();
      return Promise.resolve({ ok: false, reason: 'unavailable' });
    }
    const accepted = clock.now();
    const job = { connectionId: q.connectionId, requestId: q.requestId };
    const jobs = inflight.get(q.npc.id) ?? new Set(); jobs.add(job); inflight.set(q.npc.id, jobs);
    const done = () => { jobs.delete(job); if (!jobs.size && inflight.get(q.npc.id) === jobs) inflight.delete(q.npc.id); };
    return queue.generate(q.player.playerId, q.connectionId, async (signal, _deadline, budget) => {
      let finished = false;
      try {
        if (!available || !backendReady()) throw new Error('unavailable');
        if (!authorized()) throw new Error('Access lost');
        const history = dialogue.history(q.player.playerId, q.npc.id, q.sessionId).slice(-6);
        // Synchronous history IO consumes the original queue budget. Re-read immediately before dispatch.
        if (!authorized() || budget.expired()) throw new Error('Expired or access lost');
        const deadlineAt = budget.deadlineAt();
        let partials = 0;
        const partial = onPartial && ((text: string) => {
          const clean = normalizeAnswer(text);
          if (finished || !clean || signal.aborted || budget.expired() || !authorized()) return;
          if (partials++ === 0) {
            const ms = Math.max(0, clock.now() - accepted);
            firstPartial.observe(ms);
            logger.debug('npc.request.first_partial', 'Первый временный текст', { playerId: q.player.playerId, requestId: q.requestId, npcId: q.npc.id, ms });
          }
          onPartial(clean);
        });
        const result = await responder.answer({ requestKey: q.connectionId + ':' + q.requestId, playerId: q.player.playerId, playerName: q.player.displayName, npc: q.npc, question: q.question, history, locale: 'ru', deadlineAt }, signal, partial);
        finished = true;
        const text = normalizeAnswer(result.text);
        if (budget.expired()) throw new Error('Expired');
        if (!text) throw new Error('Empty answer');
        if (!authorized() || budget.expired()) throw new Error('Access lost');
        // Deadline check and SQLite append are synchronous; cancellation cannot interleave.
        try { dialogue.append(q.player.playerId, q.npc.id, q.question, text, clock.now(), q.sessionId); }
        catch (error) { logger.error('db.transaction.failed', 'Не удалось сохранить ответ NPC', { operation: 'dialogue.append', playerId: q.player.playerId, npcId: q.npc.id, error }); throw error; }
        logTiming('completed');
        return text;
      } finally {
        finished = true;
        // The real adapter settles only after confirmed physical cleanup. Queue quotas remain held until here.
        observeFailure();
      }
    }, {
      requestId: q.requestId, kind: onPartial ? 'npc-stream' : 'npc',
      ...(onPartial ? { timeoutMs: config.streamTimeoutMs ?? config.timeoutMs } : {}),
      onTimeout() {
        logTiming('timeout');
        if (responder.status) logger.error('npc.answer.deadline', 'Истёк deadline ответа NPC', { code: 'timeout' });
      },
    }).finally(done);
  };
  return {
    async start() { stopped = false; recoveryAttempted = false; queue.start(); await startResponder(); },
    ready: () => available && !stopped && backendReady(),
    /** Borrowed BABEL operations use the same health/recovery path, never replaying their request. */
    observeRuntimeFailure: observeFailure,
    ask,
    generate: queue.generate,
    cancel: queue.cancel,
    cancelConnection: queue.cancelConnection,
    cancelNpc(npcId: string) { for (const job of [...inflight.get(npcId) ?? []]) queue.cancel(job.connectionId, job.requestId); },
    state: queue.state,
    async stop() {
      stopped = true; available = false;
      if (recoveryTimer) scheduler.clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
      queue.stop(); await responder.stop(); await starting; available = false;
    },
  };
}
