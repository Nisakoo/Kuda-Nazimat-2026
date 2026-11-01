-- AUTH-015: passwords, public session ids and revocation. No data is removed (STORE-002).
ALTER TABLE accounts ADD COLUMN password_hash TEXT;
ALTER TABLE accounts ADD COLUMN password_set_at INTEGER;
ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
ALTER TABLE accounts ADD COLUMN temp_password_expires_at INTEGER;
ALTER TABLE sessions ADD COLUMN id TEXT;
ALTER TABLE sessions ADD COLUMN created_ip TEXT;
ALTER TABLE sessions ADD COLUMN revoked_at INTEGER;
ALTER TABLE sessions ADD COLUMN revoke_reason TEXT;
UPDATE sessions SET id = lower(hex(randomblob(6))) WHERE id IS NULL;
CREATE UNIQUE INDEX sessions_id ON sessions(id);
CREATE INDEX sessions_account ON sessions(account_id, revoked_at, expires_at);
