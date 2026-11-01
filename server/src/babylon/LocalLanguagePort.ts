import type { LanguagePort, LanguageCallContext } from './ports.ts';
import type { NpcResponder } from '../npc/NpcResponder.ts';
import { hasObviousCyrillicReply } from '../npc/targetLanguage.ts';
import { localNpcPromptProfile } from './content.ts';

export interface BorrowedLanguageRuntime {
  readonly responder: NpcResponder;
  ready(): boolean;
  observeRuntimeFailure(): void;
}

/** Borrows one existing runtime. Admission, lifecycle and recovery remain in the NPC service. */
export function createLocalLanguagePort(runtime: BorrowedLanguageRuntime): LanguagePort {
  const { responder } = runtime;
  if (typeof responder.translate !== 'function') throw new Error('language.adapter local requires a translation-capable NPC responder');
  const ready = () => { runtime.observeRuntimeFailure(); return runtime.ready(); };
  function check(signal: AbortSignal, context: LanguageCallContext | undefined): asserts context is LanguageCallContext {
    if (!context?.sessionId || !context.player.playerId || !context.requestId || !context.requestKey
      || signal.aborted || context.budget.expired() || !context.isActive()) throw new Error('Language call expired or unauthorized');
  }
  async function prepare(signal: AbortSignal, context: LanguageCallContext | undefined): Promise<void> {
    check(signal, context);
    if (!await context.authorize()) throw new Error('Language access lost');
    check(signal, context);
    if (!ready()) throw new Error('Local language runtime unavailable');
    // Authorization consumes the original queue budget, including monotonic time.
  }
  async function deliver(signal: AbortSignal, context: LanguageCallContext, text: string): Promise<string> {
    check(signal, context);
    if (!await context.authorize()) throw new Error('Language access lost');
    check(signal, context);
    return text;
  }
  return {
    mode: 'local', languages: ['ru', 'en', 'es'], ready,
    async translate(text, source, target, signal, context) {
      try {
        await prepare(signal, context);
        check(signal, context);
        const deadlineAt = context.budget.deadlineAt();
        const result = await responder.translate!({ requestKey: JSON.stringify([context.requestKey, 'translate', source, target]), text, source, target, deadlineAt }, signal);
        return await deliver(signal, context, result.text);
      } finally { runtime.observeRuntimeFailure(); }
    },
    async answer(npc, question, language, history, signal, context) {
      if (language !== 'en' && language !== 'es') throw new Error('Local NPC learning language must be en or es');
      try {
        await prepare(signal, context);
        check(signal, context);
        const deadlineAt = context.budget.deadlineAt();
        const result = await responder.answer({
          requestKey: JSON.stringify([context.requestKey, 'npc', npc.id]), playerId: context.player.playerId,
          playerName: context.player.displayName, npc: localNpcPromptProfile(npc.id, language), question, locale: language, deadlineAt,
          history: history.slice(-6).map(({ question, text }) => ({ question, answer: text })),
        }, signal);
        if (hasObviousCyrillicReply(result.text)) throw new Error('NPC reply does not match target script');
        return await deliver(signal, context, result.text);
      } finally { runtime.observeRuntimeFailure(); }
    },
  };
}
