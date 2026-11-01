import type { AccountStore, PasswordCredential, SessionStore, StoredSession } from '../src/auth/ports.ts';
import type { PlayerIdentity, PlayerStore, SavedPosition } from '../src/contracts.ts';
import type { DialogueStore, DialogueEntry } from '../src/npc/ports.ts';
export function memoryStores() {
  const identities = new Map<string, PlayerIdentity>(); const tokens = new Map<string, StoredSession>();
  const positions = new Map<string, SavedPosition>(); const history = new Map<string, DialogueEntry[]>();
  const credentials = new Map<string, PasswordCredential>();
  const pending = new Set<string>();
  const accounts: AccountStore = {
    findOrCreate(name, key) { let identity = identities.get(key); if (identity && credentials.has(identity.accountId)) throw new Error('Password account'); if (!identity) { identity = { accountId: `a${identities.size}`, playerId: `p${identities.size}`, displayName: name }; identities.set(key, identity); } return identity; },
    findByName(key) { const identity = identities.get(key); return identity ? { identity, credential: credentials.get(identity.accountId) ?? null } : null; },
    createPassword(name, key, now, credential) { if (identities.has(key)) return null; const identity = accounts.findOrCreate(name, key, now); credentials.set(identity.accountId, credential); pending.add(identity.accountId); return identity; },
    requiresAvatar(id) { return pending.has(id); },
  };
  const sessions: SessionStore = {
    create(s) { tokens.set(s.tokenHash, s); },
    find(hash) { const s = tokens.get(hash); const identity = [...identities.values()].find((i) => i.accountId === s?.accountId); return s && identity ? { identity, expiresAt: s.expiresAt } : null; },
    revoke(hash) { tokens.delete(hash); },
    prune(before) { for (const [hash, s] of tokens) if (s.expiresAt < before) tokens.delete(hash); },
  };
  const players: PlayerStore = { load: (id) => positions.get(id) ?? null, save: (batch) => { for (const p of batch) positions.set(p.id, p); } };
  const dialogue: DialogueStore = {
    history: (p, n) => (history.get(`${p}:${n}`) ?? []).slice(-6),
    append(p, n, question, answer) { const key = `${p}:${n}`; history.set(key, [...(history.get(key) ?? []), { question, answer }].slice(-50)); },
  };
  return { accounts, sessions, players, dialogue, tokens };
}
