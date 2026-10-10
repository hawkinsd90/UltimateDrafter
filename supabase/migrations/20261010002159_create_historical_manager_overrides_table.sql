/*
# Create durable historical manager override table

## Purpose
Stores commissioner-approved historical manager identity corrections that
survive re-imports. When a commissioner splits a historical team association,
an override row records that for a specific (league, season, external_team_id,
external_owner_id, provider) combination, the manager should be the new
split-off manager rather than the default alias-based match.

## How it works
1. During re-import, save_historical_season first does the default alias-based
   manager matching (step 2 of the RPC).
2. Then, for each team's owners, it checks if an override exists for
   (league_id, season_year, external_team_id, external_owner_id, provider).
3. If an override exists, the override's target_manager_id replaces the
   alias-based manager_id in the team_id_map.
4. This ensures the split correction persists across re-imports without
   modifying the alias table (which would affect other seasons).

## New table
- `league_history_manager_overrides`
  - `id` uuid PK
  - `league_id` uuid FK to leagues
  - `season_year` integer — which season the override applies to
  - `external_team_id` text — ESPN team ID within that season
  - `external_owner_id` text — ESPN owner ID to redirect
  - `provider` text — provider name (default 'espn')
  - `target_manager_id` uuid FK to league_history_managers
  - `created_by` uuid — commissioner who approved the override
  - `created_at` timestamptz
  - `note` text — optional description of why the override was created

## Unique constraint
- (league_id, season_year, external_team_id, external_owner_id, provider)
  ensures one override per owner-team-season combination.

## Security
- RLS enabled with same pattern as other history tables:
  - SELECT: league members
  - INSERT/UPDATE/DELETE: league owner only
*/

CREATE TABLE IF NOT EXISTS league_history_manager_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  external_team_id text NOT NULL,
  external_owner_id text NOT NULL,
  provider text NOT NULL DEFAULT 'espn',
  target_manager_id uuid NOT NULL REFERENCES league_history_managers(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  note text
);

-- One override per owner-team-season-provider combination
CREATE UNIQUE INDEX IF NOT EXISTS uq_history_manager_overrides
  ON league_history_manager_overrides (league_id, season_year, external_team_id, external_owner_id, provider);

-- Index for efficient lookup during save_historical_season
CREATE INDEX IF NOT EXISTS idx_history_overrides_lookup
  ON league_history_manager_overrides (league_id, season_year, provider);

ALTER TABLE league_history_manager_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_history_overrides" ON league_history_manager_overrides;
CREATE POLICY "select_history_overrides"
  ON league_history_manager_overrides FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

DROP POLICY IF EXISTS "insert_history_overrides" ON league_history_manager_overrides;
CREATE POLICY "insert_history_overrides"
  ON league_history_manager_overrides FOR INSERT
  TO authenticated
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "update_history_overrides" ON league_history_manager_overrides;
CREATE POLICY "update_history_overrides"
  ON league_history_manager_overrides FOR UPDATE
  TO authenticated
  USING (is_league_owner(league_id))
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "delete_history_overrides" ON league_history_manager_overrides;
CREATE POLICY "delete_history_overrides"
  ON league_history_manager_overrides FOR DELETE
  TO authenticated
  USING (is_league_owner(league_id));
