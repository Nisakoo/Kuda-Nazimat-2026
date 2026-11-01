-- Temporary AUTH isolation of the existing bounded history, not the future NPC archive.
-- NULL means legacy provenance is unknown. Never assign these rows to a login.
ALTER TABLE npc_dialogue ADD COLUMN session_id TEXT;
CREATE INDEX npc_dialogue_session ON npc_dialogue(session_id, player_id, npc_id, created_at);
-- No FK to sessions: AUTH pruning must not choose the deferred archive retention policy.
-- Access always requires a live AUTH session; physical retention remains separate.
CREATE TABLE babel_npc_dialogue (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  npc_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (json_valid(state))
);
CREATE INDEX babel_npc_dialogue_session ON babel_npc_dialogue(session_id, player_id, npc_id, id);
-- Existing babel_profiles.replies and babel_operations remain legacy data unchanged.
