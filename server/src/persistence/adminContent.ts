import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { NpcOverride } from '../content/NpcCatalog.ts';
import type { AccountSummary, AdminContentStore, JournalEntry, JournalInput } from '../content/ports.ts';
import { transaction } from './database.ts';

const MAX_JOURNAL = 100_000;
const optional = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);
const parsed = (value: unknown): Record<string, unknown> | null => value === null || value === undefined ? null : JSON.parse(String(value)) as Record<string, unknown>;

/** ADMIN-SRV / STORE-014: NPC layer, change journal and read-only account views over the shared connection. */
export function sqliteAdminContent(db: DatabaseSync): AdminContentStore {
  // SQLite lower() folds ASCII only; journal search must ignore case in Cyrillic too.
  db.function('unicode_lower', { deterministic: true }, (value) => typeof value === 'string' ? value.toLowerCase() : value);
  const insert = db.prepare('INSERT INTO admin_journal (at, actor, ip, target_type, target_id, action, before, after, actor_account_id, actor_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const write = (e: JournalInput): void => {
    insert.run(e.at, e.actor, e.ip, e.targetType, e.targetId, e.action, e.before === null ? null : JSON.stringify(e.before), e.after === null ? null : JSON.stringify(e.after), e.actorAccountId ?? null, e.actorName ?? null);
    db.prepare('DELETE FROM admin_journal WHERE id <= (SELECT id FROM admin_journal ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MAX_JOURNAL);
  };
  const summary = (row: Record<string, unknown>): AccountSummary => ({
    accountId: String(row.id), name: String(row.name), role: row.role === 'admin' ? 'admin' : 'player', createdAt: Number(row.created_at), hasPassword: Number(row.has_password) === 1,
    mustChangePassword: Number(row.must) === 1, activeSessions: Number(row.active), lastLoginAt: optional(row.last_login),
  });
  const ACCOUNT = `SELECT a.id, a.name, a.role, a.created_at, a.password_hash IS NOT NULL AS has_password, a.must_change_password AS must,
    (SELECT count(*) FROM sessions s WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active,
    (SELECT max(created_at) FROM sessions s WHERE s.account_id = a.id) AS last_login FROM accounts a`;
  return {
    overrides() {
      return db.prepare('SELECT * FROM npc_overrides ORDER BY npc_id').all().map((row): NpcOverride => ({
        npcId: String(row.npc_id), origin: row.origin === 'admin' ? 'admin' : 'content', fields: JSON.parse(String(row.fields)) as NpcOverride['fields'],
        enabled: Number(row.enabled) === 1, deletedAt: optional(row.deleted_at), updatedAt: Number(row.updated_at),
      }));
    },
    saveNpc(npcId, override, entry) {
      transaction(db, () => {
        if (override) db.prepare(`INSERT INTO npc_overrides (npc_id, origin, fields, enabled, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(npc_id) DO UPDATE SET origin = excluded.origin, fields = excluded.fields, enabled = excluded.enabled, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`)
          .run(npcId, override.origin, JSON.stringify(override.fields), override.enabled ? 1 : 0, override.deletedAt, override.updatedAt);
        else db.prepare('DELETE FROM npc_overrides WHERE npc_id = ?').run(npcId);
        db.prepare('INSERT INTO npc_revisions (npc_id, revision) VALUES (?, 1) ON CONFLICT(npc_id) DO UPDATE SET revision = revision + 1').run(npcId);
        write(entry);
      });
    },
    append(entry) { transaction(db, () => write(entry)); },
    revisions() {
      return new Map(db.prepare('SELECT npc_id, revision FROM npc_revisions').all().map((row) => [String(row.npc_id), Number(row.revision)] as [string, number]));
    },
    seed(entries) {
      return transaction(db, () => {
        const mark = db.prepare('INSERT OR IGNORE INTO npc_seeded (npc_id) VALUES (?)');
        let written = 0;
        for (const entry of entries) if (mark.run(entry.targetId).changes) { write(entry); written++; }
        return written;
      });
    },
    journal(filter) {
      const where: string[] = []; const params: SQLInputValue[] = [];
      if (filter.target) { where.push('target_type = ?'); params.push(filter.target); }
      if (filter.id) { where.push('target_id = ?'); params.push(filter.id); }
      if (filter.action) { where.push('action = ?'); params.push(filter.action); }
      if (filter.from !== undefined) { where.push('at >= ?'); params.push(filter.from); }
      if (filter.to !== undefined) { where.push('at <= ?'); params.push(filter.to); }
      if (filter.q) { where.push("(instr(unicode_lower(target_id), ?) > 0 OR instr(action, ?) > 0 OR instr(unicode_lower(coalesce(before, '')), ?) > 0 OR instr(unicode_lower(coalesce(after, '')), ?) > 0)"); const q = filter.q.toLowerCase(); params.push(q, q, q, q); }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = Number(db.prepare(`SELECT count(*) AS n FROM admin_journal ${clause}`).get(...params)!.n);
      const rows = db.prepare(`SELECT * FROM admin_journal ${clause} ORDER BY id ${filter.order === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`).all(...params, filter.limit, filter.offset);
      return {
        total,
        entries: rows.map((row): JournalEntry => ({
          id: Number(row.id), at: Number(row.at), actor: String(row.actor) as JournalEntry['actor'], ip: row.ip === null ? null : String(row.ip),
          actorAccountId: row.actor_account_id === null || row.actor_account_id === undefined ? null : String(row.actor_account_id), actorName: row.actor_name === null || row.actor_name === undefined ? null : String(row.actor_name),
          targetType: String(row.target_type) as JournalEntry['targetType'], targetId: String(row.target_id), action: String(row.action), before: parsed(row.before), after: parsed(row.after),
        })),
      };
    },
    searchAccounts(query, now) {
      return db.prepare(`${ACCOUNT} WHERE instr(a.name_key, ?) > 0 ORDER BY a.name_key LIMIT 100`).all(now, query.toLowerCase()).map(summary);
    },
    account(nameKey, now) {
      const row = db.prepare(`${ACCOUNT} WHERE a.name_key = ?`).get(now, nameKey);
      return row ? summary(row) : null;
    },
    sessions(accountId, limit) {
      return db.prepare('SELECT created_at, expires_at, created_ip, revoked_at, revoke_reason FROM sessions WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(accountId, limit)
        .map((row) => ({ createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), ip: row.created_ip === null ? null : String(row.created_ip), revokedAt: optional(row.revoked_at), revokeReason: row.revoke_reason === null ? null : String(row.revoke_reason) }));
    },
  };
}
