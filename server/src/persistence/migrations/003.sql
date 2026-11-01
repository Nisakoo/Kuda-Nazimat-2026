ALTER TABLE players ADD COLUMN avatar_id TEXT CHECK (avatar_id IS NULL OR avatar_id IN ('lukas', 'nic', 'dan', 'ksu'));
