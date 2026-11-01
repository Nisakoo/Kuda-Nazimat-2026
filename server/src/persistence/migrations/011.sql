-- AUTH-017/018: account role and session scope; ADMIN-SRV-009: who made a change. No data is removed (STORE-002).
ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin'));
ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'game' CHECK (scope IN ('game', 'admin'));
ALTER TABLE admin_journal ADD COLUMN actor_account_id TEXT;
ALTER TABLE admin_journal ADD COLUMN actor_name TEXT;
-- Revisions are independent of the bounded journal and survive reset-to-content.
CREATE TABLE npc_revisions (
  npc_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
INSERT INTO npc_revisions (npc_id, revision)
  SELECT target_id, count(*) FROM admin_journal
  WHERE target_type = 'npc' AND action != 'npc.seed' GROUP BY target_id;

CREATE TABLE npc_seeded (npc_id TEXT PRIMARY KEY);
INSERT INTO npc_seeded (npc_id) SELECT DISTINCT target_id FROM admin_journal WHERE target_type = 'npc' AND action = 'npc.seed';
