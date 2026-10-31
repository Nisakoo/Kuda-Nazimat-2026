CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE players (id TEXT PRIMARY KEY, account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id), map_id TEXT, x REAL, y REAL, z REAL, rotation_y REAL, updated_at INTEGER NOT NULL,
  CHECK ((map_id IS NULL AND x IS NULL AND y IS NULL AND z IS NULL AND rotation_y IS NULL) OR (map_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL AND rotation_y IS NOT NULL)));
CREATE TABLE npc_dialogue (id INTEGER PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), npc_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX npc_dialogue_pair ON npc_dialogue(player_id, npc_id, created_at);
