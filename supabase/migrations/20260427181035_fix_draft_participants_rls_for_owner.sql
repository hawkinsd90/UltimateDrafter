/*
  # Fix draft_participants RLS for league owner

  The existing INSERT policy only allows users to insert their own row (auth.uid() = user_id).
  This blocks the league owner from inserting all participants when setting up a draft.

  Changes:
  - Add INSERT policy allowing the draft's league owner to insert any participant row
  - Add DELETE policy allowing the draft's league owner to delete participants (needed for re-saving)
*/

CREATE POLICY "League owner can insert participants"
  ON draft_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_participants.draft_id
        AND l.owner_id = auth.uid()
    )
  );

CREATE POLICY "League owner can delete participants"
  ON draft_participants FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_participants.draft_id
        AND l.owner_id = auth.uid()
    )
  );
