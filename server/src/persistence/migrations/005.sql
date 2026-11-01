ALTER TABLE players ADD COLUMN equipped_tool TEXT CHECK (equipped_tool IS NULL OR equipped_tool IN ('bag', 'jug'));
