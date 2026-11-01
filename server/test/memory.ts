import type { PlayerStore, SavedPosition } from '../src/contracts.ts';
import type { DialogueStore, DialogueEntry } from '../src/npc/ports.ts';
import { readFileSync } from 'node:fs';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';
import { parseNpcContent } from '../src/world/npcContent.ts';
import { babylonNpc } from '../src/babylon/BabylonService.ts';

/** The shipped npcs.json seed and its BABEL view, for services built without the catalogue. */
export const seedNpcs = parseNpcContent(JSON.parse(readFileSync(new URL('../content/npcs.json', import.meta.url), 'utf8')));
export const marketNpc = (id: string) => babylonNpc(seedNpcs.find((npc) => npc.id === id));

/** In-memory players/dialogue; accounts and sessions use SQLite `:memory:` so there is one implementation of the auth ports. */
export function memoryStores() {
  const db = openDatabase(':memory:');
  const { accounts, sessions } = sqliteStores(db);
  const positions = new Map<string, SavedPosition>(); const history = new Map<string, DialogueEntry[]>();
  const players: PlayerStore = { load: (id) => positions.get(id) ?? null, save: (batch) => { for (const p of batch) positions.set(p.id, p); } };
  const dialogue: DialogueStore = {
    history: (p, n) => (history.get(`${p}:${n}`) ?? []).slice(-6),
    append(p, n, question, answer) { const key = `${p}:${n}`; history.set(key, [...(history.get(key) ?? []), { question, answer }].slice(-50)); },
  };
  /** Stored session token hashes, to prove that raw tokens are never kept. */
  const tokenHashes = (): string[] => db.prepare('SELECT token_hash AS hash FROM sessions').all().map((row) => String(row.hash));
  return { accounts, sessions, players, dialogue, tokenHashes, db };
}
