import type { NpcProfile } from '../contracts.ts';
import type { DialogueEntry } from './ports.ts';
export interface NpcAnswerRequest {
  readonly requestKey: string; readonly playerId: string; readonly playerName: string;
  readonly npc: NpcProfile; readonly question: string; readonly history: readonly DialogueEntry[];
  readonly locale: 'ru'; readonly deadlineAt: number;
}
/**
 * Private current/last answer timing only. No identifiers, content, or IO.
 * Preparing includes IPC/tokenization. Prefill is the operational wait for first
 * text (also HTTP setup), not an isolated runner prefill measurement. Complete
 * means the adapter accepted the full answer. Times <=120000 ms, prompt <=1792,
 * nonempty output chunk count <=4096; all numbers are nonnegative safe integers.
 */
export interface NpcDiagnostics {
  readonly stage: 'preparing' | 'prefill' | 'decoding' | 'complete';
  readonly elapsedMs: number;
  readonly promptTokens?: number;
  readonly firstTokenMs?: number;
  readonly outputChunks?: number;
}
export interface NpcResponder {
  start(): Promise<void>;
  answer(request: NpcAnswerRequest, signal: AbortSignal): Promise<{ text: string }>;
  stop(): Promise<void>;
  /** Optional local-runtime health; never performs IO or starts recovery. */
  status?(): 'ready' | 'unavailable';
  /** Optional fixed diagnostic code, never a prompt, path, or third-party exception. */
  lastFailure?(): string | undefined;
  /** Optional synchronous bounded snapshot; retained after abort until restart/next answer. */
  diagnostics?(): NpcDiagnostics | undefined;
}
