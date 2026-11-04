export type NpcAttitude = 'ordinary' | 'displeased' | 'friendly';

export interface DialogueEntry { readonly question: string; readonly answer: string }
export interface DialogueStore {
  history(playerId: string, npcId: string, sessionId: string): readonly DialogueEntry[];
  append(playerId: string, npcId: string, question: string, answer: string, now: number, sessionId: string): void;
  attitude?(playerId: string, npcId: string, sessionId: string): NpcAttitude;
  setAttitude?(playerId: string, npcId: string, sessionId: string, attitude: NpcAttitude, now: number): void;
  facts?(playerId: string, npcId: string, sessionId: string): readonly string[];
  appendFact?(playerId: string, npcId: string, sessionId: string, fact: string, now: number): void;
}
