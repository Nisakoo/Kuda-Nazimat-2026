CREATE TABLE world_apples (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('world', 'held')),
  x REAL, y REAL, z REAL,
  holder_id TEXT REFERENCES players(id),
  CHECK ((state = 'world' AND x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL AND holder_id IS NULL)
    OR (state = 'held' AND x IS NULL AND y IS NULL AND z IS NULL AND holder_id IS NOT NULL))
);
CREATE UNIQUE INDEX world_one_hand ON world_apples(holder_id) WHERE holder_id IS NOT NULL;
CREATE TABLE world_hand_receipts (
  player_id TEXT NOT NULL REFERENCES players(id),
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, request_id)
);
