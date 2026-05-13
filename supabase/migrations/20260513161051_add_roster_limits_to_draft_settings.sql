/*
  # Add roster limit columns to draft_settings

  ## Changes
  These optional columns let the draft owner specify maximum counts per position,
  preventing teams from stacking a single position beyond the set limit.

  New columns (all integer, nullable — null means no limit):
  - `max_qb`
  - `max_rb`
  - `max_wr`
  - `max_te`
  - `max_k`
  - `max_dst`
  - `player_pool` (text, default 'all') — 'all' or 'rookies_only'
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'draft_settings' AND column_name = 'max_qb') THEN
    ALTER TABLE draft_settings ADD COLUMN max_qb integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'draft_settings' AND column_name = 'max_rb') THEN
    ALTER TABLE draft_settings ADD COLUMN max_rb integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'draft_settings' AND column_name = 'max_wr') THEN
    ALTER TABLE draft_settings ADD COLUMN max_wr integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'draft_settings' AND column_name = 'max_te') THEN
    ALTER TABLE draft_settings ADD COLUMN max_te integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'draft_settings' AND column_name = 'max_k') THEN
    ALTER TABLE draft_settings ADD COLUMN max_k integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'draft_settings' AND column_name = 'max_dst') THEN
    ALTER TABLE draft_settings ADD COLUMN max_dst integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'draft_settings' AND column_name = 'player_pool') THEN
    ALTER TABLE draft_settings ADD COLUMN player_pool text DEFAULT 'all';
  END IF;
END $$;
