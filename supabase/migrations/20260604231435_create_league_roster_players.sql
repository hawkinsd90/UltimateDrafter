/*
  # Create league_roster_players — app-owned roster source of truth

  external_roster_players is the provider snapshot only.
  This table is the durable, app-owned roster state that survives re-imports
  and future drop/trade operations.

  ## Design notes
  - imported_member_id is the primary anchor (NOT NULL). A row is never orphaned
    even when league_member_id and user_id are null (unclaimed team).
  - external_roster_player_id uses ON DELETE SET NULL so re-imports that delete
    snapshot rows leave app-owned rows intact.
  - Partial unique indexes (not table constraints) prevent duplicates while
    correctly handling NULL values.
  - No direct client INSERT/UPDATE/DELETE. All mutations go through RPCs or
    the service-role import path.
*/

CREATE TABLE IF NOT EXISTS league_roster_players (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning league
  league_id                 uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  -- The imported team anchor — always set, even for unclaimed teams
  imported_member_id        uuid NOT NULL REFERENCES league_imported_members(id) ON DELETE CASCADE,

  -- Set when the team is claimed; null for unclaimed teams
  league_member_id          uuid REFERENCES league_members(id) ON DELETE SET NULL,
  user_id                   uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Back-reference to the provider snapshot row
  -- Nullable: future drafted players will have no snapshot row
  -- ON DELETE SET NULL: re-import can safely delete snapshot rows
  external_roster_player_id uuid REFERENCES external_roster_players(id) ON DELETE SET NULL,

  -- Canonical player reference
  sports_player_id          uuid REFERENCES sports_players(id) ON DELETE SET NULL,

  -- Provider metadata frozen at seed time — not overwritten by re-import
  external_player_name      text,
  external_position         text,

  -- App-owned status — not reset by re-import
  roster_status             text NOT NULL DEFAULT 'active'
                              CHECK (roster_status IN ('active', 'dropped', 'traded', 'ir')),

  -- How this row was created
  acquisition_source        text NOT NULL
                              CHECK (acquisition_source IN ('imported', 'drafted', 'added', 'waiver')),

  -- User-defined ordering within position group (local-only for now)
  sort_order                integer NOT NULL DEFAULT 0,

  -- Auditing
  acquired_at               timestamptz NOT NULL DEFAULT now(),
  removed_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION set_league_roster_players_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_league_roster_players_updated_at
  BEFORE UPDATE ON league_roster_players
  FOR EACH ROW EXECUTE FUNCTION set_league_roster_players_updated_at();

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_lrp_league_id           ON league_roster_players(league_id);
CREATE INDEX idx_lrp_imported_member_id  ON league_roster_players(imported_member_id);
CREATE INDEX idx_lrp_league_member_id    ON league_roster_players(league_member_id);
CREATE INDEX idx_lrp_user_id             ON league_roster_players(user_id);
CREATE INDEX idx_lrp_sports_player_id    ON league_roster_players(sports_player_id);
CREATE INDEX idx_lrp_status              ON league_roster_players(league_id, roster_status);

-- Partial unique indexes (NULL-safe — standard UNIQUE constraints treat NULLs as distinct)
CREATE UNIQUE INDEX league_roster_players_unique_external_snapshot
  ON league_roster_players(external_roster_player_id)
  WHERE external_roster_player_id IS NOT NULL;

CREATE UNIQUE INDEX league_roster_players_unique_resolved_player
  ON league_roster_players(imported_member_id, sports_player_id)
  WHERE sports_player_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE league_roster_players ENABLE ROW LEVEL SECURITY;

-- League members and owner can read all roster rows for their league
CREATE POLICY "select_league_roster_players"
  ON league_roster_players FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_roster_players.league_id
        AND lm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = league_roster_players.league_id
        AND l.owner_id = auth.uid()
    )
  );

-- No direct client INSERT, UPDATE, or DELETE.
-- All mutations go through SECURITY DEFINER RPCs or the service-role import path.
