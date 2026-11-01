import type { NpcQuestions } from '../contracts.ts';
import type { Clock, Scheduler } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import { MS_BUCKETS, MetricsRegistry, type Metrics } from '../common/metrics.ts';
import type { NpcResponder } from './NpcResponder.ts';
import type { DialogueStore } from './ports.ts';
import { createGenerationQueue } from './GenerationQueue.ts';
export function normalizeAnswer(text: string): string { return text.replace(/\r\n/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '').trim().slice(0, 4000); }
export function createNpcDialogueService(deps: { responder: NpcResponder; dialogue: DialogueStore; clock: Clock; scheduler: Scheduler; logger: Logger; metrics?: Metrics }, config: { maxConcurrent: number; maxUnfinished: number; timeoutMs: number; streamTimeoutMs?: number }) {
  const { responder, dialogue, clock } = deps;
  const logger = deps.logger.child('npc');
  const firstPartial = (deps.metrics ?? new MetricsRegistry()).histogram('npc_first_partial_ms', 'Время от приёма вопроса до первого временного текста', MS_BUCKETS);
  const queue = createGenerationQueue(deps, config);
  let available = false, stopped = false;
  const ask: NpcQuestions['ask'] = (q, onPartial) => {
    if (!available || stopped) return Promise.resolve({ ok: false, reason: 'unavailable' });
    return queue.generate(q.player.playerId, q.connectionId, async (signal, deadline) => {
      // Partials are display-only: normalized like the answer, silenced once the job is aborted or expired.
      const accepted = clock.now(); let partials = 0;
      const partial = onPartial && ((text: string) => {
        const clean = normalizeAnswer(text);
        if (!clean || signal.aborted || clock.now() >= deadline) return;
        if (partials++ === 0) { firstPartial.observe(clock.now() - accepted); logger.debug('npc.request.first_partial', 'Первый временный текст', { playerId: q.player.playerId, requestId: q.requestId, npcId: q.npc.id, ms: clock.now() - accepted }); }
        onPartial(clean);
      });
      const result = await responder.answer({ requestKey: `${q.connectionId}:${q.requestId}`, playerId: q.player.playerId, playerName: q.player.displayName, npc: q.npc, question: q.question, history: dialogue.history(q.player.playerId, q.npc.id).slice(-6), locale: 'ru', deadlineAt: deadline }, signal, partial);
      if (signal.aborted || clock.now() >= deadline) throw new Error('Expired');
      const text = normalizeAnswer(result.text); if (!text) throw new Error('Empty answer');
      try { dialogue.append(q.player.playerId, q.npc.id, q.question, text, clock.now()); }
      catch (error) { logger.error('db.transaction.failed', 'Не удалось сохранить ответ NPC', { operation: 'dialogue.append', playerId: q.player.playerId, npcId: q.npc.id, error }); throw error; }
      return text;
    }, { requestId: q.requestId, kind: onPartial ? 'npc-stream' : 'npc', ...(onPartial ? { timeoutMs: config.streamTimeoutMs ?? config.timeoutMs } : {}) });
  };
  return {
    async start() {
      stopped = false; queue.start();
      try { await responder.start(); available = true; logger.info('npc.responder.ready', 'Ответчик NPC готов'); }
      catch (error) { available = false; logger.error('npc.responder.unavailable', 'NpcResponder недоступен', { error }); }
    },
    ready: () => available && !stopped,
    ask,
    generate: queue.generate,
    cancel: queue.cancel,
    cancelConnection: queue.cancelConnection,
    state: queue.state,
    async stop() { stopped = true; available = false; queue.stop(); await responder.stop(); },
  };
}
