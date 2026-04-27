/*
  # External League Import — Core Tables

  Creates the foundational tables for importing ESPN and Sleeper leagues before a draft.

  ## New Tables

  ### external_league_links
  One row per draft that has been linked to an external fantasy league (ESPN or Sleeper).
  Tracks provider, external IDs, import mode, import lifecycle status, and a metadata
  snapshot of the imported league's roster and scoring settings. ESPN credentials are
  never stored here.

  ### external_league_teams
  One row per team imported from the external league. Stores the provider's team/owner
  identifiers and name, plus the commissioner's mapping to a draft_participants row.
  Teams the commissioner chooses to ignore have mapping_status = 'ignored'.

  ### external_roster_players
  One row per player on each imported team's roster. Stores the provider's player ID
  and name alongside the resolved sports_players reference once matching is complete.
  external_data holds provider-specific shape for debugging — never credentials.

  ## Security
  - RLS enabled on all three tables.
  - Policies defined in a subsequent migration.
*/

-- ============================================================
-- updated_at trigger function (shared, idempotent)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ============================================================
-- external_league_links
-- ============================================================
CREATE TABLE IF NOT EXISTS external_league_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id             uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  league_id            uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  provider             text NOT NULL CHECK (provider IN ('espn', 'sleeper')),
  external_league_id   text NOT NULL,
  external_season      integer NOT NULL,
  display_name         text,

  import_mode          text NOT NULL DEFAULT 'reference_only'
                         CHECK (import_mode IN (
                           'reference_only',
                           'manual_keeper_select',
                           'all_rostered_as_keepers'
                         )),

  -- pending   = link created, import not yet run
  -- imported  = raw data fetched and normalized
  -- mapped    = all teams resolved (mapped or ignored)
  -- locked    = import frozen; draft may now start
  import_status        text NOT NULL DEFAULT 'pending'
                         CHECK (import_status IN (
                           'pending', 'imported', 'mapped', 'locked'
                         )),

  imported_at          timestamptz,
  locked_at            timestamptz,
  locked_by            uuid REFERENCES auth.users(id),

  -- Provider-agnostic metadata snapshot (no credentials, no raw ESPN payloads).
  -- Shape: { leagueName, numTeams, scoringType, rosterSettings, rawScoringSettings, providerVersion }
  raw_metadata         jsonb,

  created_by           uuid NOT NULL REFERENCES auth.users(id),
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),

  -- One external link per draft
  UNIQUE (draft_id)
);

CREATE TRIGGER trg_external_league_links_updated_at
  BEFORE UPDATE ON external_league_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_external_league_links_draft_id
  ON external_league_links(draft_id);

CREATE INDEX IF NOT EXISTS idx_external_league_links_league_id
  ON external_league_links(league_id);


-- ============================================================
-- external_league_teams
-- ============================================================
CREATE TABLE IF NOT EXISTS external_league_teams (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id                 uuid NOT NULL REFERENCES external_league_links(id) ON DELETE CASCADE,
  external_team_id        text NOT NULL,
  external_owner_id       text,
  external_owner_name     text,
  external_team_name      text NOT NULL,

  -- Set by the commissioner in TeamMappingStep
  draft_participant_id    uuid REFERENCES draft_participants(id) ON DELETE SET NULL,

  -- pending = not yet acted on
  -- mapped  = assigned to a draft_participant
  -- ignored = commissioner explicitly chose not to map this team
  mapping_status          text NOT NULL DEFAULT 'pending'
                            CHECK (mapping_status IN ('pending', 'mapped', 'ignored')),

  -- Required when mapping_status = 'ignored'; optional otherwise
  ignored_reason          text,

  mapped_at               timestamptz,
  created_at              timestamptz DEFAULT now(),

  UNIQUE (link_id, external_team_id)
);

CREATE INDEX IF NOT EXISTS idx_external_league_teams_link_id
  ON external_league_teams(link_id);

CREATE INDEX IF NOT EXISTS idx_external_league_teams_participant_id
  ON external_league_teams(draft_participant_id);


-- ============================================================
-- external_roster_players
-- ============================================================
CREATE TABLE IF NOT EXISTS external_roster_players (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id               uuid NOT NULL REFERENCES external_league_links(id) ON DELETE CASCADE,
  external_team_id      text NOT NULL,
  external_player_id    text NOT NULL,
  external_player_name  text NOT NULL,
  external_position     text,

  -- Resolved reference into our canonical player database.
  -- NULL until the mapping pipeline runs or commissioner resolves manually.
  sports_player_id      uuid REFERENCES sports_players(id) ON DELETE SET NULL,

  -- unresolved = no match found yet
  -- matched    = auto-matched (ID or name+position)
  -- manual     = commissioner manually selected the match
  -- skipped    = commissioner chose to ignore this player
  resolution_status     text NOT NULL DEFAULT 'unresolved'
                          CHECK (resolution_status IN (
                            'unresolved', 'matched', 'manual', 'skipped'
                          )),

  resolved_at           timestamptz,

  -- Provider-specific player shape for debugging and mapping review.
  -- Must never contain ESPN credentials, SWID, or espn_s2 values.
  external_data         jsonb,

  created_at            timestamptz DEFAULT now(),

  UNIQUE (link_id, external_team_id, external_player_id)
);

CREATE INDEX IF NOT EXISTS idx_external_roster_players_link_id
  ON external_roster_players(link_id);

CREATE INDEX IF NOT EXISTS idx_external_roster_players_sports_player_id
  ON external_roster_players(sports_player_id);

CREATE INDEX IF NOT EXISTS idx_external_roster_players_team_link
  ON external_roster_players(link_id, external_team_id);


-- ============================================================
-- Enable RLS (policies follow in a subsequent migration)
-- ============================================================
ALTER TABLE external_league_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_league_teams    ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_roster_players  ENABLE ROW LEVEL SECURITY;
