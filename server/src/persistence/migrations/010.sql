-- ADMIN-SRV-001/009: administrator edits over contentDir/npcs.json and the change journal.
CREATE TABLE npc_overrides (
  npc_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK (origin IN ('content', 'admin')),
  fields TEXT NOT NULL CHECK (json_valid(fields)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE admin_journal (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('admin', 'seed', 'system')),
  ip TEXT,
  target_type TEXT NOT NULL CHECK (target_type IN ('npc', 'world', 'account')),
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before TEXT CHECK (before IS NULL OR json_valid(before)),
  after TEXT CHECK (after IS NULL OR json_valid(after))
);
CREATE INDEX admin_journal_target ON admin_journal(target_type, target_id, id);
CREATE INDEX admin_journal_at ON admin_journal(at, id);
