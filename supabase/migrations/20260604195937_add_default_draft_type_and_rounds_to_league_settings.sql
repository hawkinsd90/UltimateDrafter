/*
  # Add default draft type and rounds to league_settings

  1. Changes
    - `league_settings`
      - `default_draft_type` (text, DEFAULT 'snake') — the draft format used for new drafts and pick calculation ('snake' or 'linear')
      - `default_rounds` (integer, DEFAULT 15) — number of rounds for new drafts and pick calculation

  2. Notes
    - Columns are nullable-safe with defaults so existing rows are not affected
    - These values feed LeagueRosterTab's draft-pick displayer so picks are calculated
      from league settings rather than relying solely on per-draft values
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'league_settings' AND column_name = 'default_draft_type'
  ) THEN
    ALTER TABLE league_settings ADD COLUMN default_draft_type text NOT NULL DEFAULT 'snake';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'league_settings' AND column_name = 'default_rounds'
  ) THEN
    ALTER TABLE league_settings ADD COLUMN default_rounds integer NOT NULL DEFAULT 15;
  END IF;
END $$;
