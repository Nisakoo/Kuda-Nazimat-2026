import type { CityQuestProgress } from '../../../shared/city/types.ts';
import type { ChatEntry, ItemId, Languages, NpcReply, PartySize, Tablet, Word, Language } from '../../../shared/babylon/types.ts';
import type { NpcAnswer, NpcProfile, PlayerIdentity } from '../contracts.ts';

export interface Profile extends Languages { discovered?: string[]; groupId: string | null; introSeen: boolean; spawnPending: boolean; words: Word[]; replies: NpcReply[] }
export interface Message { id: string; authorId: string; authorName: string; source: string; sourceLanguage: Language; createdAt: number; deliveries: Record<string, { language: Language; text: string | null; translated: boolean; status: ChatEntry['status']; error?: string }> }
export interface Party {
  city?: CityQuestProgress;
  id: string; size: PartySize; members: { id: string; name: string; role: number }[];
  startedAt: number | null; completedAt: number | null; fed: string[];
  inventory: Record<string, Record<ItemId, number>>; stones: Tablet[]; messages: Message[];
}
export interface NpcSessionScope { readonly sessionId: string; readonly isActive: () => boolean }
export interface Operation { npcSessionId?: string; fingerprint: string; status: 'pending' | 'complete' | 'failed'; notice?: string; suggestion?: string }
export interface BabylonStore {
  /** Temporary bounded NPC replies, separate from account-wide profile and legacy replies. */
  npcReplies(playerId: string, sessionId: string, npcId?: string): NpcReply[];
  appendNpcReply(playerId: string, sessionId: string, reply: NpcReply): void;
  transaction<T>(action: () => T): T;
  profile(playerId: string): Profile | null;
  saveProfile(playerId: string, profile: Profile): void;
  party(id: string): Party | null;
  /** At most MAX_AVAILABLE_PARTIES + 1 waiting groups, newest first; extra row signals overflow. */
  openParties(): Party[];
  saveParty(party: Party): void;
  deleteParty(id: string): void;
  operation(playerId: string, requestId: string): Operation | null;
  saveOperation(playerId: string, requestId: string, operation: Operation): void;
  interrupt(): void;
}
/**
 * BABEL translation and learning-language NPC replies. The local LLM adapter is supplied by the runtime task,
 * never by the browser; it registers in babylon/adapters.ts and is selected by config `language.adapter`.
 */
/** Private per-call context; never accepted from BABEL wire or inserted into a prompt. */
export interface LanguageCallContext {
  readonly sessionId: string; readonly player: PlayerIdentity; readonly requestId: string; readonly requestKey: string;
  readonly budget: { expired(): boolean; deadlineAt(): number };
  isActive(): boolean;
  authorize(): Promise<boolean>;
}
export interface LanguagePort {
  readonly mode: 'test' | 'local';
  readonly languages: readonly Language[];
  /** Independent test fixtures can own hooks. Borrowed local ports never own runtime lifecycle. */
  start?(): Promise<void>;
  stop?(): Promise<void>;
  ready?(): boolean;
  translate(text: string, source: Language, target: Language, signal: AbortSignal, context?: LanguageCallContext): Promise<string>;
  answer(npc: NpcProfile, question: string, language: Language, history: readonly NpcReply[], signal: AbortSignal, context?: LanguageCallContext): Promise<string>;
}
/** Same queue as game NPCs: one reservation covers all target languages of a message. */
export type Generate = (playerId: string, connectionId: string, work: (signal: AbortSignal, deadline: number, budget?: { expired(): boolean; deadlineAt?(): number }) => Promise<string>, options?: { readonly requestId?: string; readonly kind?: string }) => Promise<NpcAnswer>;
export interface BabylonLocation { mapId: string; position: { x: number; y: number; z: number } }
