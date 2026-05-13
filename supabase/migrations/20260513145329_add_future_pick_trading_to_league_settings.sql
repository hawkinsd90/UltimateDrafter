/*
  # Add future draft pick trading settings to league_settings

  ## Changes
  - `league_settings`: new column `allow_future_picks bool NOT NULL DEFAULT false`
  - `league_settings`: new column `future_pick_years int NOT NULL DEFAULT 1 CHECK (future_pick_years BETWEEN 1 AND 3)`

  ## Notes
  - `allow_future_picks` gates whether pick trades beyond the current season are allowed.
  - `future_pick_years` is only meaningful when `allow_future_picks` is true (1–3 years ahead).
  - Default is disabled so existing leagues are unaffected.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'league_settings' AND column_name = 'allow_future_picks'
  ) THEN
    ALTER TABLE league_settings
      ADD COLUMN allow_future_picks bool NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'league_settings' AND column_name = 'future_pick_years'
  ) THEN
    ALTER TABLE league_settings
      ADD COLUMN future_pick_years int NOT NULL DEFAULT 1
        CHECK (future_pick_years >= 1 AND future_pick_years <= 3);
  END IF;
END $$;
