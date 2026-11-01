-- AUTH-017/018: account role and session scope. No data is removed (STORE-002).
ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin'));
ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'game' CHECK (scope IN ('game', 'admin'));
