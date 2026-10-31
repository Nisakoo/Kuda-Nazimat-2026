import type { NpcProfile } from '../contracts.ts';
import type { DialogueEntry } from './ports.ts';
export interface NpcAnswerRequest {
  readonly requestKey: string; readonly playerId: string; readonly playerName: string;
  readonly npc: NpcProfile; readonly question: string; readonly history: readonly DialogueEntry[];
  readonly locale: 'ru'; readonly deadlineAt: number;
}
export interface NpcResponder {
  start(): Promise<void>;
  answer(request: NpcAnswerRequest, signal: AbortSignal): Promise<{ text: string }>;
  stop(): Promise<void>;
}
