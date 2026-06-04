/*
  # Make external_league_links.draft_id nullable for league-level imports

  ## Summary
  Enables full external league imports to be run from the League Detail page
  before any draft is created. Previously every import required a draft_id.

  ## Changes

  ### external_league_links
  1. draft_id column: NOT NULL → nullable
     - Existing draft-level rows are unaffected (they all have draft_id set).
     - The FK and CASCADE behavior are preserved; PostgreSQL skips FK checks for NULL.

  2. UNIQUE (draft_id) table constraint: dropped
     - Replaced with a partial unique index that only covers non-null values.
     - Multiple league-level rows (draft_id IS NULL) are now allowed.

  ## New Indexes

  - `external_league_links_draft_unique`
    UNIQUE (draft_id) WHERE draft_id IS NOT NULL
    — preserves the one-import-per-draft invariant.

  - `external_league_links_league_unique`
    UNIQUE (league_id, provider, external_league_id) WHERE draft_id IS NULL
    — one league-level import per (league, provider, external league ID);
      supports safe re-imports via ON CONFLICT targeting this index.

  ## Security
  No RLS changes. Existing policies on external_league_links already include
  league_id-based checks (added in Phase 1), so league-level rows without a
  draft_id are readable by the league owner and league members.
*/

-- 1. Remove NOT NULL from draft_id
ALTER TABLE external_league_links
  ALTER COLUMN draft_id DROP NOT NULL;

-- 2. Drop the table-level UNIQUE (draft_id) constraint
--    Name comes from the standard Postgres naming: <table>_<col>_key
ALTER TABLE external_league_links
  DROP CONSTRAINT IF EXISTS external_league_links_draft_id_key;

-- 3. Partial unique index for draft-level rows (one per draft)
CREATE UNIQUE INDEX IF NOT EXISTS external_league_links_draft_unique
  ON external_league_links (draft_id)
  WHERE draft_id IS NOT NULL;

-- 4. Partial unique index for league-level rows (one per league+provider+external_league)
CREATE UNIQUE INDEX IF NOT EXISTS external_league_links_league_unique
  ON external_league_links (league_id, provider, external_league_id)
  WHERE draft_id IS NULL;
