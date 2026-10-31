import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHook } from 'node:async_hooks';
import type { NpcAnswerRequest, NpcResponder } from '../src/npc/NpcResponder.ts';
export const answerRequest = (): NpcAnswerRequest => ({ requestKey: 'c:r', playerId: 'p', playerName: 'Аня', npc: { id: 'n', name: 'Лея', topic: 'История', persona: 'Рассказывает спокойно', greeting: 'Привет' }, question: 'Вопрос', history: [], locale: 'ru', deadlineAt: Date.now() + 8000 });
/** Register for every adapter; network resources are forbidden for the scripted adapter. */
export function responderContract(name: string, factory: () => NpcResponder): void {
  describe(`NpcResponder contract: ${name}`, () => {
    afterEach(() => vi.useRealTimers());
    it('starts/stops repeatedly, answers nonempty and uses no external network', async () => {
      let network = 0;
      const hook = createHook({ init(_id, type) { if (['TCPCONNECTWRAP', 'UDPSENDWRAP', 'GETADDRINFOREQWRAP'].includes(type)) network++; } });
      const responder = factory(); hook.enable();
      try {
        await responder.start(); await responder.start();
        const answer = await responder.answer(answerRequest(), new AbortController().signal);
        expect(answer.text.trim().length).toBeGreaterThan(0);
        await responder.stop(); await responder.stop(); expect(network).toBe(0);
      } finally { hook.disable(); await responder.stop(); }
    });
    it('settles abort before and during answer within two seconds and respects deadline', async () => {
      vi.useFakeTimers(); const responder = factory(); await responder.start();
      try {
        const aborted = new AbortController(); aborted.abort();
        await expect(responder.answer(answerRequest(), aborted.signal)).rejects.toThrow();
        const controller = new AbortController(); const pending = responder.answer(answerRequest(), controller.signal);
        const assertion = expect(pending).rejects.toThrow(); controller.abort(); await vi.advanceTimersByTimeAsync(2000); await assertion;
        const deadline = responder.answer({ ...answerRequest(), deadlineAt: Date.now() + 1 }, new AbortController().signal);
        const expired = expect(deadline).rejects.toThrow(); await vi.advanceTimersByTimeAsync(1); await expired;
      } finally { await responder.stop(); }
    });
  });
}
