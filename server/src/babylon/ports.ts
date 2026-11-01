import type { ChatEntry, ItemId, Languages, NpcReply, PartySize, Tablet, Word, Language } from '../../../shared/babylon/types.ts';
import type { NpcAnswer, NpcProfile } from '../contracts.ts';

export interface Profile extends Languages { groupId: string; introSeen: boolean; spawnPending: boolean; words: Word[]; replies: NpcReply[] }
export interface Message { id: string; authorId: string; authorName: string; source: string; sourceLanguage: Language; createdAt: number; deliveries: Record<string, { language: Language; text: string | null; translated: boolean; status: ChatEntry['status']; error?: string }> }
export interface Party {
  id: string; size: PartySize; members: { id: string; name: string; role: number }[];
  startedAt: number | null; completedAt: number | null; fed: string[];
  inventory: Record<string, Record<ItemId, number>>; stones: Tablet[]; messages: Message[];
}
export interface Operation { fingerprint: string; status: 'pending' | 'complete' | 'failed'; notice?: string; suggestion?: string }
export interface BabylonStore {
  transaction<T>(action: () => T): T;
  profile(playerId: string): Profile | null;
  saveProfile(playerId: string, profile: Profile): void;
  party(id: string): Party | null;
  openParty(): Party | null;
  saveParty(party: Party): void;
  operation(playerId: string, requestId: string): Operation | null;
  saveOperation(playerId: string, requestId: string, operation: Operation): void;
  interrupt(): void;
}
/**
 * BABEL translation and learning-language NPC replies. The local LLM adapter is supplied by the runtime task,
 * never by the browser; it registers in babylon/adapters.ts and is selected by config `language.adapter`.
 */
export interface LanguagePort {
  readonly mode: 'test' | 'local';
  readonly languages: readonly Language[];
  /** Loads the model before the port opens; a failure leaves BABEL language actions UNAVAILABLE. */
  start(): Promise<void>;
  /** Releases the model; in-flight calls are aborted through their signals first. */
  stop(): Promise<void>;
  translate(text: string, source: Language, target: Language, signal: AbortSignal): Promise<string>;
  answer(npc: NpcProfile, question: string, language: Language, history: readonly NpcReply[], signal: AbortSignal): Promise<string>;
}
/** Same queue as v1 NPCs: one reservation covers all target languages of a message. */
export type Generate = (playerId: string, connectionId: string, work: (signal: AbortSignal, deadline: number) => Promise<string>, options?: { readonly requestId?: string; readonly kind?: string }) => Promise<NpcAnswer>;
export interface BabylonLocation { mapId: string; position: { x: number; y: number; z: number } }
