import type { NpcQuestions } from '../contracts.ts';
import type { Clock, Scheduler } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import type { NpcResponder } from './NpcResponder.ts';
import type { DialogueStore } from './ports.ts';
import { createGenerationQueue } from './GenerationQueue.ts';
export function normalizeAnswer(text: string): string { return text.replace(/\r\n/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '').trim().slice(0, 4000); }
export function createNpcDialogueService(deps: { responder: NpcResponder; dialogue: DialogueStore; clock: Clock; scheduler: Scheduler; logger: Logger }, config: { maxConcurrent: number; maxUnfinished: number; timeoutMs: number; streamTimeoutMs?: number }) {
  const { responder, dialogue, clock, logger } = deps;
  const queue = createGenerationQueue(deps, config);
  let available = false, stopped = false;
  const ask: NpcQuestions['ask'] = (q, onPartial) => {
    if (!available || stopped) return Promise.resolve({ ok: false, reason: 'unavailable' });
    return queue.generate(q.player.playerId, q.connectionId, async (signal, deadline) => {
      // Partials are display-only: normalized like the answer, silenced once the job is aborted or expired.
      const partial = onPartial && ((text: string) => { const clean = normalizeAnswer(text); if (clean && !signal.aborted && clock.now() < deadline) onPartial(clean); });
      const result = await responder.answer({ requestKey: `${q.connectionId}:${q.requestId}`, playerId: q.player.playerId, playerName: q.player.displayName, npc: q.npc, question: q.question, history: dialogue.history(q.player.playerId, q.npc.id).slice(-6), locale: 'ru', deadlineAt: deadline }, signal, partial);
      if (signal.aborted || clock.now() >= deadline) throw new Error('Expired');
      const text = normalizeAnswer(result.text); if (!text) throw new Error('Empty answer');
      dialogue.append(q.player.playerId, q.npc.id, q.question, text, clock.now());
      return text;
    }, { requestId: q.requestId, ...(onPartial ? { timeoutMs: config.streamTimeoutMs ?? config.timeoutMs } : {}) });
  };
  return {
    async start() { stopped = false; queue.start(); try { await responder.start(); available = true; } catch { available = false; logger.error('NpcResponder недоступен'); } },
    ready: () => available && !stopped,
    ask,
    generate: queue.generate,
    cancel: queue.cancel,
    cancelConnection: queue.cancelConnection,
    async stop() { stopped = true; available = false; queue.stop(); await responder.stop(); },
  };
}
