-- NPC-AI-007/008/010/011: NPC relationships (ordinary, displeased, friendly) and compact memory facts.
CREATE TABLE IF NOT EXISTS npc_relationships (
  session_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  attitude TEXT NOT NULL DEFAULT 'ordinary' CHECK (attitude IN ('ordinary', 'displeased', 'friendly')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, player_id, npc_id)
);
CREATE INDEX IF NOT EXISTS npc_relationships_lookup ON npc_relationships(session_id, player_id, npc_id);

CREATE TABLE IF NOT EXISTS npc_memory_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS npc_memory_facts_lookup ON npc_memory_facts(session_id, player_id, npc_id, created_at);
