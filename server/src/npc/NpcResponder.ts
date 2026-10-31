import type { NpcProfile } from '../contracts.ts';
import type { DialogueEntry } from './ports.ts';
export interface NpcAnswerRequest {
  readonly requestKey: string; readonly playerId: string; readonly playerName: string;
  readonly npc: NpcProfile; readonly question: string; readonly history: readonly DialogueEntry[];
  readonly locale: 'ru'; readonly deadlineAt: number;
}
/** Receives the whole text generated so far (not a delta). Adapters without streaming never call it. */
export type PartialAnswer = (text: string) => void;
/** NPC-005: the model boundary. A local LLM adapter implements this and registers in adapters/index.ts. */
export interface NpcResponder {
  start(): Promise<void>;
  /** Resolves with the final text; `onPartial` must not be called after the promise settles or the signal aborts. */
  answer(request: NpcAnswerRequest, signal: AbortSignal, onPartial?: PartialAnswer): Promise<{ text: string }>;
  stop(): Promise<void>;
  /** Optional local-runtime health; never performs IO or starts recovery. */
  status?(): 'ready' | 'unavailable';
  /** Optional fixed diagnostic code, never a prompt, path, or third-party exception. */
  lastFailure?(): string | undefined;
}
