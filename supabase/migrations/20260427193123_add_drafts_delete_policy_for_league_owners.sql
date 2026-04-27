/*
  # Add DELETE policy on drafts for league owners

  ## Summary
  The drafts table was missing a DELETE RLS policy. League owners could not delete
  drafts from the UI — the operation silently failed because no policy permitted it.

  ## Changes
  - ADD policy: "League owners can delete their drafts"
    Allows authenticated league owners to delete any draft that belongs to a league
    they own.
*/

CREATE POLICY "League owners can delete their drafts"
  ON drafts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = drafts.league_id
        AND leagues.owner_id = auth.uid()
    )
  );
