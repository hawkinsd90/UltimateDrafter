/*
  # Draft Keeper Assignments and Scoring Rules

  ## New Tables

  ### draft_keeper_assignments
  Pre-rostered players that are excluded from the draft pool before the live draft begins.

  V1 behavior (enforced by design, not code):
  - Keepers are pool exclusions only. A keeper in this table cannot be drafted.
  - Keepers are displayed separately in the draft room (not in draft_picks).
  - Keepers do NOT appear in draft_picks — draft_picks is for live picks only.
  - current_pick_number is not adjusted for keeper count in V1.
  - round_cost column is present but nullable and unused by the V1 draft engine.
    Reserved for V1.5 skip-round implementation.

  ### draft_scoring_rules
  Snapshot of scoring settings imported from an external league.
  Stores the detected scoring type and raw provider scoring map.
  One row per draft. Optional — only created when an external league is imported.

  ## Security
  - RLS enabled on both tables; policies follow in a subsequent migration.
*/

-- ============================================================
-- draft_keeper_assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS draft_keeper_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  participant_id    uuid NOT NULL REFERENCES draft_participants(id) ON DELETE CASCADE,

  -- FK to our canonical player database (consistent with draft_picks.player_id)
  sports_player_id  uuid NOT NULL REFERENCES sports_players(id),

  -- Reserved for V1.5 round-cost / skip-pick logic. Not used by V1 draft engine.
  round_cost        integer,

  -- 'manual'   = commissioner added directly
  -- 'imported' = created from external_roster_players during import wizard
  source            text NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual', 'imported')),

  confirmed_at      timestamptz DEFAULT now(),
  confirmed_by      uuid REFERENCES auth.users(id),

  -- A player can only be kept by one team per draft
  UNIQUE (draft_id, sports_player_id)
);

CREATE INDEX IF NOT EXISTS idx_draft_keeper_assignments_draft_id
  ON draft_keeper_assignments(draft_id);

CREATE INDEX IF NOT EXISTS idx_draft_keeper_assignments_participant_id
  ON draft_keeper_assignments(participant_id);

CREATE INDEX IF NOT EXISTS idx_draft_keeper_assignments_sports_player_id
  ON draft_keeper_assignments(sports_player_id);

ALTER TABLE draft_keeper_assignments ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- draft_scoring_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS draft_scoring_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id      uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,

  -- NULL when no external link exists (manually configured)
  link_id       uuid REFERENCES external_league_links(id) ON DELETE SET NULL,

  source        text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'imported')),

  scoring_type  text DEFAULT 'standard'
                  CHECK (scoring_type IN ('standard', 'ppr', 'half_ppr', 'custom')),

  -- Full provider scoring settings snapshot for reference
  raw_scoring   jsonb,

  created_at    timestamptz DEFAULT now(),

  UNIQUE (draft_id)
);

CREATE INDEX IF NOT EXISTS idx_draft_scoring_rules_draft_id
  ON draft_scoring_rules(draft_id);

ALTER TABLE draft_scoring_rules ENABLE ROW LEVEL SECURITY;
