/*
  # Add OP/Superflex roster slot to league_settings and draft_settings

  ## Summary
  Adds a `roster_op` column to both tables to support the OP (Offensive Player /
  Superflex) lineup slot used by ESPN and Sleeper leagues. This slot accepts any
  offensive player (QB/RB/WR/TE) and is equivalent to Sleeper's SUPER_FLEX.

  ## Changes
  - `league_settings`: new column `roster_op int NOT NULL DEFAULT 0`
  - `draft_settings`: new column `roster_op int NOT NULL DEFAULT 0`

  ## Notes
  - Default is 0 so existing leagues are unaffected.
  - The draft board round-count calculation must include this column.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'league_settings' AND column_name = 'roster_op'
  ) THEN
    ALTER TABLE league_settings
      ADD COLUMN roster_op int NOT NULL DEFAULT 0 CHECK (roster_op >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'draft_settings' AND column_name = 'roster_op'
  ) THEN
    ALTER TABLE draft_settings
      ADD COLUMN roster_op int NOT NULL DEFAULT 0 CHECK (roster_op >= 0);
  END IF;
END $$;
