-- Language preferences exist before the player creates or joins a task.
CREATE TABLE babel_profiles_next (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  party_id TEXT REFERENCES babel_parties(id),
  state TEXT NOT NULL CHECK (json_valid(state))
);
INSERT INTO babel_profiles_next SELECT player_id, party_id, state FROM babel_profiles;
DROP TABLE babel_profiles;
ALTER TABLE babel_profiles_next RENAME TO babel_profiles;
