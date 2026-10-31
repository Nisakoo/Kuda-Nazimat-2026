export type Language = 'ru' | 'en' | 'es';
export type PartySize = 1 | 2 | 3 | 4;
export type ItemId = 'dates' | 'red-fruit' | 'yellow-fruit' | 'water' | 'fabric';
export type Stone = readonly (readonly (readonly [number, number])[])[];
export interface Languages { native: Language; learning: Language }
export interface Word extends Languages { id: string; word: string; translation: string; note: string }
export interface Tablet { id: string; authorId: string; authorName: string; drawing: Stone; createdAt: number }
export interface ChatEntry { id: string; authorId: string; authorName: string; text: string; language: Language; translated: boolean; status: 'sent' | 'translating' | 'delivered' | 'error'; createdAt: number; error?: string }
export interface NpcReply { id: string; npcId: string; question: string; text: string; language: Language }
export interface BabylonState {
  v: 2;
  playerId: string;
  backend: 'test' | 'local';
  languages: readonly Language[];
  profile: Languages | null;
  introSeen: boolean;
  party: { id: string; size: PartySize; count: number; role: number; members: readonly { id: string; name: string; role: number }[]; started: boolean; completed: boolean; seconds: number } | null;
  availableParty: { size: PartySize; count: number } | null;
  task: string;
  goatGuide: string | null;
  inventory: Readonly<Record<ItemId, number>>;
  fed: readonly string[];
  stones: readonly Tablet[];
  words: readonly Word[];
  messages: readonly ChatEntry[];
  replies: readonly NpcReply[];
}
export type BabylonAction =
  | { type: 'state' }
  | { type: 'enroll'; size: PartySize; native: Language; learning: Language }
  | { type: 'languages'; native: Language; learning: Language }
  | { type: 'intro-seen' }
  | { type: 'buy'; item: ItemId; targetId: string }
  | { type: 'feed'; item: ItemId; targetId: string }
  | { type: 'carve'; drawing: Stone }
  | { type: 'word-save'; id?: string; word: string; translation: string; note: string }
  | { type: 'word-delete'; id: string }
  | { type: 'suggest'; word: string }
  | { type: 'chat'; text: string }
  | { type: 'npc'; targetId: string; text: string };
export interface BabylonRequest { v: 2; requestId: string; action: BabylonAction }
export interface BabylonResult { v: 2; requestId: string; state: BabylonState; notice?: string; suggestion?: string }
export type BabylonErrorCode = 'INVALID' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_READY' | 'RATE_LIMIT' | 'UNAVAILABLE';
export interface BabylonFailure { v: 2; requestId: string; error: { code: BabylonErrorCode; message: string } }
export const EMPTY_INVENTORY: Record<ItemId, number> = { dates: 0, 'red-fruit': 0, 'yellow-fruit': 0, water: 0, fabric: 0 };
