export interface DialogueEntry { readonly question: string; readonly answer: string }
export interface DialogueStore {
  history(playerId: string, npcId: string, sessionId: string): readonly DialogueEntry[];
  append(playerId: string, npcId: string, question: string, answer: string, now: number, sessionId: string): void;
}
