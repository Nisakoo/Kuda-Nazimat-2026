CREATE TABLE babel_parties (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (json_valid(state))
);
CREATE TABLE babel_profiles (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  party_id TEXT NOT NULL REFERENCES babel_parties(id),
  state TEXT NOT NULL CHECK (json_valid(state))
);
CREATE TABLE babel_operations (
  player_id TEXT NOT NULL REFERENCES players(id),
  request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (json_valid(state)),
  PRIMARY KEY (player_id, request_id)
);
