-- CONTENT-001/010: editable NPC catalogue and its change log. No data is removed (STORE-002).
CREATE TABLE npcs (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'disabled', 'deleted')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  definition TEXT NOT NULL CHECK (json_valid(definition)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE npc_changes (
  id INTEGER PRIMARY KEY,
  npc_id TEXT NOT NULL REFERENCES npcs(id),
  at INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('seed', 'update', 'move', 'disable', 'enable', 'delete')),
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  ip TEXT,
  revision INTEGER NOT NULL,
  changes TEXT NOT NULL CHECK (json_valid(changes))
);
CREATE INDEX npc_changes_npc ON npc_changes(npc_id, id);
