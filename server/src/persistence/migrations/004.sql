-- Absence of a credential preserves the legacy guest account type.
-- Presence plus players.avatar_id IS NULL is the durable pending-avatar marker.
CREATE TABLE account_credentials (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL DEFAULT 'scrypt-v1' CHECK (algorithm = 'scrypt-v1'),
  salt TEXT NOT NULL CHECK (length(salt) = 32 AND salt NOT GLOB '*[^0-9a-f]*'),
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 128 AND password_hash NOT GLOB '*[^0-9a-f]*')
);
