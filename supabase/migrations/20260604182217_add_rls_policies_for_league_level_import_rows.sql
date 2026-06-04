/*
  # Add RLS policies for league-level external import rows (draft_id IS NULL)

  ## Problem
  All existing RLS policies on external_league_links, external_league_teams,
  and external_roster_players join through draft_id. When a league-level import
  is run from the League Detail Settings tab, external_league_links.draft_id is
  NULL. The existing JOIN (d.id = external_league_links.draft_id) never matches
  NULL, so every SELECT from the frontend returns zero rows even though the data
  was correctly written by the edge function (which uses the service role and
  bypasses RLS).

  ## New Policies Added

  ### external_league_links
  - SELECT: league owner OR any league member can read league-level links
  - INSERT: league owner can insert league-level links (supplement to service role)
  - UPDATE: league owner can update unlocked league-level links
  - DELETE: league owner can delete unlocked league-level links

  ### external_league_teams
  - SELECT: league owner OR any league member can read teams under league-level links
  - INSERT: league owner can insert teams under unlocked league-level links
  - UPDATE: league owner can update teams under unlocked league-level links
  - DELETE: league owner can delete teams under unlocked league-level links

  ### external_roster_players
  - SELECT: league owner OR any league member can read roster players under league-level links
  - INSERT: league owner can insert roster players under unlocked league-level links
  - UPDATE: league owner can update roster players under unlocked league-level links
  - DELETE: league owner can delete roster players under unlocked league-level links

  ## Notes
  - Existing draft-level policies are unchanged.
  - All new policies guard on draft_id IS NULL to avoid overlap with draft policies.
  - Ownership and membership are verified directly from leagues and league_members,
    never from the draft chain.
*/


-- ============================================================
-- external_league_links — league-level policies (draft_id IS NULL)
-- ============================================================

CREATE POLICY "League owner and members can view league-level import links"
  ON external_league_links FOR SELECT
  TO authenticated
  USING (
    draft_id IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM leagues l
        WHERE l.id = external_league_links.league_id
          AND l.owner_id = auth.uid()
      )
      OR
      EXISTS (
        SELECT 1 FROM league_members lm
        WHERE lm.league_id = external_league_links.league_id
          AND lm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "League owner can create league-level import links"
  ON external_league_links FOR INSERT
  TO authenticated
  WITH CHECK (
    draft_id IS NULL
    AND EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = external_league_links.league_id
        AND l.owner_id = auth.uid()
    )
  );

CREATE POLICY "League owner can update league-level import links until locked"
  ON external_league_links FOR UPDATE
  TO authenticated
  USING (
    draft_id IS NULL
    AND external_league_links.locked_at IS NULL
    AND EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = external_league_links.league_id
        AND l.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    draft_id IS NULL
    AND EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = external_league_links.league_id
        AND l.owner_id = auth.uid()
    )
  );

CREATE POLICY "League owner can delete league-level import links until locked"
  ON external_league_links FOR DELETE
  TO authenticated
  USING (
    draft_id IS NULL
    AND external_league_links.locked_at IS NULL
    AND EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = external_league_links.league_id
        AND l.owner_id = auth.uid()
    )
  );


-- ============================================================
-- external_league_teams — league-level policies (link has draft_id IS NULL)
-- ============================================================

CREATE POLICY "League owner and members can view teams from league-level links"
  ON external_league_teams FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      WHERE ell.id = external_league_teams.link_id
        AND ell.draft_id IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM leagues l
            WHERE l.id = ell.league_id AND l.owner_id = auth.uid()
          )
          OR
          EXISTS (
            SELECT 1 FROM league_members lm
            WHERE lm.league_id = ell.league_id AND lm.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "League owner can insert teams for league-level links"
  ON external_league_teams FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_league_teams.link_id
        AND ell.draft_id IS NULL
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );

CREATE POLICY "League owner can update teams for league-level links"
  ON external_league_teams FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_league_teams.link_id
        AND ell.draft_id IS NULL
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_league_teams.link_id
        AND ell.draft_id IS NULL
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );

CREATE POLICY "League owner can delete teams for league-level links"
  ON external_league_teams FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_league_teams.link_id
        AND ell.draft_id IS NULL
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );


-- ============================================================
-- external_roster_players — league-level policies (link has draft_id IS NULL)
-- ============================================================

CREATE POLICY "League owner and members can view roster players from league-level links"
  ON external_roster_players FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      WHERE ell.id = external_roster_players.link_id
        AND ell.draft_id IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM leagues l
            WHERE l.id = ell.league_id AND l.owner_id = auth.uid()
          )
          OR
          EXISTS (
            SELECT 1 FROM league_members lm
            WHERE lm.league_id = ell.league_id AND lm.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "League owner can insert roster players for league-level links"
  ON external_roster_players FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_roster_players.link_id
        AND ell.draft_id IS NULL
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );

CREATE POLICY "League owner can update roster players for league-level links"
  ON external_roster_players FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_roster_players.link_id
        AND ell.draft_id IS NULL
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_roster_players.link_id
        AND ell.draft_id IS NULL
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );

CREATE POLICY "League owner can delete roster players for league-level links"
  ON external_roster_players FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_roster_players.link_id
        AND ell.draft_id IS NULL
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );
