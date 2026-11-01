import type { PlayerStore, SavedPosition } from '../src/contracts.ts';
import type { DialogueStore, DialogueEntry } from '../src/npc/ports.ts';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';

/** In-memory players/dialogue; accounts and sessions use SQLite `:memory:` so there is one implementation of the auth ports. */
export function memoryStores() {
  const db = openDatabase(':memory:');
  const { accounts, sessions } = sqliteStores(db);
  const positions = new Map<string, SavedPosition>(); const history = new Map<string, (DialogueEntry & { sessionId: string; time: number; order: number })[]>();
  let order = 0;
  const players: PlayerStore = { load: (id) => positions.get(id) ?? null, save: (batch) => { for (const p of batch) positions.set(p.id, p); } };
  const dialogue: DialogueStore = {
    history: (p, n, sessionId) => sessionId ? (history.get(JSON.stringify([p, n])) ?? []).filter(entry => entry.sessionId === sessionId).slice(-6).map(({ question, answer }) => ({ question, answer })) : [],
    append(p, n, question, answer, time, sessionId) {
      if (!sessionId) throw new Error('Missing AUTH scope');
      const key = JSON.stringify([p, n]);
      history.set(key, [...(history.get(key) ?? []), { question, answer, sessionId, time, order: order++ }].sort((a, b) => a.time - b.time || a.order - b.order).slice(-50));
    },
  };
  /** Stored session token hashes, to prove that raw tokens are never kept. */
  const tokenHashes = (): string[] => db.prepare('SELECT token_hash AS hash FROM sessions').all().map((row) => String(row.hash));
  return { accounts, sessions, players, dialogue, tokenHashes, db };
}
