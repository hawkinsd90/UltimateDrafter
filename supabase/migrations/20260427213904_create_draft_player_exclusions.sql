/*
  # Create draft_player_exclusions table

  ## Summary
  Tracks players that should be excluded from the draft pool for a specific draft.
  This table is populated when a commissioner ignores an imported team with
  `player_pool_policy = 'unavailable'`, and can also be used for manual exclusions.

  Rows are removed when a team is re-mapped or its policy is changed to 'available'.

  ## New Table: draft_player_exclusions
  - `id`                       — primary key
  - `draft_id`                 — the draft this exclusion applies to
  - `sports_player_id`         — the player being excluded
  - `source`                   — how the exclusion was created:
      'external_ignored_team'  → auto-created when ignoring a team with unavailable policy
      'manual'                 → commissioner manually excluded
      'provider_import'        → reserved for future automated flows
  - `external_league_team_id`  — which imported team caused this exclusion (nullable)
  - `external_roster_player_id`— the specific roster player row that caused this (nullable)
  - `reason`                   — optional free-text reason
  - `created_by`               — user who created the exclusion
  - `created_at`               — timestamp

  ## Security
  - RLS enabled, restrictive policies:
    - SELECT: league owner OR draft participant
    - INSERT: league owner only, while draft.status = 'pending'
    - UPDATE: league owner only, while draft.status = 'pending'
    - DELETE: league owner only, while draft.status = 'pending'

  ## Notes
  - UNIQUE (draft_id, sports_player_id) — a player can only be excluded once per draft.
    Re-saving with the same player is idempotent (upsert-safe).
*/

CREATE TABLE IF NOT EXISTS draft_player_exclusions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id                 uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  sports_player_id         uuid NOT NULL REFERENCES sports_players(id),
  source                   text NOT NULL DEFAULT 'external_ignored_team'
                             CHECK (source IN ('external_ignored_team', 'manual', 'provider_import')),
  external_league_team_id  uuid REFERENCES external_league_teams(id) ON DELETE CASCADE,
  external_roster_player_id uuid REFERENCES external_roster_players(id) ON DELETE CASCADE,
  reason                   text,
  created_by               uuid REFERENCES auth.users(id),
  created_at               timestamptz DEFAULT now(),

  UNIQUE (draft_id, sports_player_id)
);

CREATE INDEX IF NOT EXISTS idx_draft_player_exclusions_draft_id
  ON draft_player_exclusions(draft_id);

CREATE INDEX IF NOT EXISTS idx_draft_player_exclusions_sports_player_id
  ON draft_player_exclusions(sports_player_id);

CREATE INDEX IF NOT EXISTS idx_draft_player_exclusions_team_id
  ON draft_player_exclusions(external_league_team_id);

ALTER TABLE draft_player_exclusions ENABLE ROW LEVEL SECURITY;

-- SELECT: league owner or draft participant
CREATE POLICY "Draft participants and league owner can view player exclusions"
  ON draft_player_exclusions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND (
          l.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM draft_participants dp
            WHERE dp.draft_id = draft_player_exclusions.draft_id
              AND dp.user_id = auth.uid()
          )
        )
    )
  );

-- INSERT: league owner only, draft must be pending
CREATE POLICY "League owner can insert player exclusions while draft is pending"
  ON draft_player_exclusions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );

-- UPDATE: league owner only, draft must be pending
CREATE POLICY "League owner can update player exclusions while draft is pending"
  ON draft_player_exclusions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );

-- DELETE: league owner only, draft must be pending
CREATE POLICY "League owner can delete player exclusions while draft is pending"
  ON draft_player_exclusions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );
