/*
  # Fix draft_player_exclusions: allow paused drafts + backfill mapped team exclusions

  ## Summary
  Two fixes:

  1. UPDATE RLS INSERT/UPDATE/DELETE policies to allow modifications when draft
     status is 'pending' OR 'paused'. Previously only 'pending' was allowed, which
     prevented re-saving team mappings after a draft had started/paused.

  2. BACKFILL exclusions for mapped teams in draft 9fb03787-596f-4890-939d-f03b95bc1ee4.
     When teams were mapped (SLIM, SMIT), their roster players were not added to
     draft_player_exclusions — only ignored-unavailable teams were excluded. This
     caused mapped teams' players to remain visible in the draft pool.

  ## Security
  - INSERT/UPDATE/DELETE policies now check status IN ('pending', 'paused')
  - SELECT policy unchanged (participants + owner can always read)
*/

-- Drop and recreate the INSERT policy to allow paused drafts
DROP POLICY IF EXISTS "League owner can insert player exclusions while draft is pending" ON draft_player_exclusions;

CREATE POLICY "League owner can insert player exclusions while draft is pending or paused"
  ON draft_player_exclusions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND l.owner_id = auth.uid()
        AND d.status IN ('pending', 'paused')
    )
  );

-- Drop and recreate the UPDATE policy
DROP POLICY IF EXISTS "League owner can update player exclusions while draft is pending" ON draft_player_exclusions;

CREATE POLICY "League owner can update player exclusions while draft is pending or paused"
  ON draft_player_exclusions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND l.owner_id = auth.uid()
        AND d.status IN ('pending', 'paused')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND l.owner_id = auth.uid()
        AND d.status IN ('pending', 'paused')
    )
  );

-- Drop and recreate the DELETE policy
DROP POLICY IF EXISTS "League owner can delete player exclusions while draft is pending" ON draft_player_exclusions;

CREATE POLICY "League owner can delete player exclusions while draft is pending or paused"
  ON draft_player_exclusions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND l.owner_id = auth.uid()
        AND d.status IN ('pending', 'paused')
    )
  );

-- Backfill exclusions for mapped teams in draft 9fb03787-596f-4890-939d-f03b95bc1ee4
-- SLIM (team_id 286ba9e6) and SMIT (team_id bfe08cd7)
INSERT INTO draft_player_exclusions (
  draft_id,
  sports_player_id,
  source,
  external_league_team_id,
  external_roster_player_id,
  reason
)
SELECT
  '9fb03787-596f-4890-939d-f03b95bc1ee4',
  erp.sports_player_id,
  'external_ignored_team',
  elt.id,
  erp.id,
  'Mapped team: ' || elt.external_team_name
FROM external_league_teams elt
JOIN external_roster_players erp
  ON  erp.link_id          = elt.link_id
  AND erp.external_team_id = elt.external_team_id
WHERE elt.id IN (
  '286ba9e6-d7f9-43a7-9176-61997d6d365a',
  'bfe08cd7-0042-467e-9133-cb3d7d8c2b58'
)
  AND erp.sports_player_id IS NOT NULL
ON CONFLICT (draft_id, sports_player_id) DO NOTHING;
