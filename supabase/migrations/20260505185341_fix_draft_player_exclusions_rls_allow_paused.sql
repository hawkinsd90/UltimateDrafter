/*
  # Fix draft_player_exclusions RLS policies to allow paused drafts

  The INSERT, UPDATE, and DELETE policies on draft_player_exclusions previously
  only permitted the league owner to act when draft status = 'pending'. This
  blocked team mapping saves on paused drafts (e.g. re-saving after a draft
  has been started and paused). Extended to also allow 'paused' status.
*/

DROP POLICY IF EXISTS "League owner can insert player exclusions while draft is pendin" ON draft_player_exclusions;
DROP POLICY IF EXISTS "League owner can update player exclusions while draft is pendin" ON draft_player_exclusions;
DROP POLICY IF EXISTS "League owner can delete player exclusions while draft is pendin" ON draft_player_exclusions;

CREATE POLICY "League owner can insert player exclusions"
  ON draft_player_exclusions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_player_exclusions.draft_id
        AND l.owner_id = auth.uid()
        AND d.status IN ('pending', 'paused')
    )
  );

CREATE POLICY "League owner can update player exclusions"
  ON draft_player_exclusions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_player_exclusions.draft_id
        AND l.owner_id = auth.uid()
        AND d.status IN ('pending', 'paused')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_player_exclusions.draft_id
        AND l.owner_id = auth.uid()
        AND d.status IN ('pending', 'paused')
    )
  );

CREATE POLICY "League owner can delete player exclusions"
  ON draft_player_exclusions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_player_exclusions.draft_id
        AND l.owner_id = auth.uid()
        AND d.status IN ('pending', 'paused')
    )
  );
