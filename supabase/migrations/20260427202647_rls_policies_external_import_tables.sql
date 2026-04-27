/*
  # RLS Policies — External League Import Tables

  ## Policy design

  Ownership check pattern (consistent with existing draft_settings policies):
    League owner = auth.uid() matches leagues.owner_id for the draft's league_id

  For tables that chain through external_league_links, ownership is derived by
  joining up through the link → draft → league.

  ### external_league_links
  - SELECT: league owner OR any draft participant
  - INSERT: league owner only, draft must be 'pending'
  - UPDATE: league owner only, link must not be locked
  - DELETE: league owner only, link must not be locked

  ### external_league_teams
  - SELECT: same as external_league_links (via link_id join)
  - INSERT: league owner only, link not locked
  - UPDATE: league owner only, link not locked
  - DELETE: league owner only, link not locked

  ### external_roster_players
  - SELECT: all draft participants (needed for keeper selection UI)
  - INSERT: league owner only, link not locked
  - UPDATE: league owner only, link not locked (for manual resolution)
  - DELETE: league owner only, link not locked

  ### external_player_mappings
  - SELECT: any authenticated user (platform-wide reference data)
  - INSERT: any authenticated user (commissioners create manual mappings)
  - UPDATE: only the user who created the mapping
  - DELETE: only the user who created the mapping

  ### draft_keeper_assignments
  - SELECT: all draft participants (draft room displays confirmed keepers)
  - INSERT: league owner only, draft must be 'pending'
  - UPDATE: league owner only, draft must be 'pending'
  - DELETE: league owner only, draft must be 'pending'

  ### draft_scoring_rules
  - SELECT: all authenticated users
  - INSERT: league owner only, draft must be 'pending'
  - UPDATE: league owner only, draft must be 'pending'
  - DELETE: league owner only, draft must be 'pending'
*/


-- ============================================================
-- Helper: is the current user the league owner for a given draft_id?
-- Used inline via subquery to avoid function call overhead per row.
-- Pattern: EXISTS (SELECT 1 FROM drafts d JOIN leagues l ON l.id = d.league_id
--                  WHERE d.id = <draft_id_expr> AND l.owner_id = auth.uid())
-- ============================================================


-- ============================================================
-- external_league_links
-- ============================================================

CREATE POLICY "Draft participants and league owner can view import links"
  ON external_league_links FOR SELECT
  TO authenticated
  USING (
    -- league owner
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = external_league_links.draft_id
        AND l.owner_id = auth.uid()
    )
    OR
    -- any draft participant
    EXISTS (
      SELECT 1 FROM draft_participants dp
      WHERE dp.draft_id = external_league_links.draft_id
        AND dp.user_id = auth.uid()
    )
  );

CREATE POLICY "League owner can create import links for pending drafts"
  ON external_league_links FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = external_league_links.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );

CREATE POLICY "League owner can update import links until locked"
  ON external_league_links FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = external_league_links.draft_id
        AND l.owner_id = auth.uid()
    )
    AND external_league_links.locked_at IS NULL
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = external_league_links.draft_id
        AND l.owner_id = auth.uid()
    )
  );

CREATE POLICY "League owner can delete import links until locked"
  ON external_league_links FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = external_league_links.draft_id
        AND l.owner_id = auth.uid()
    )
    AND external_league_links.locked_at IS NULL
  );


-- ============================================================
-- external_league_teams
-- ============================================================

CREATE POLICY "Draft participants and league owner can view imported teams"
  ON external_league_teams FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_league_teams.link_id
        AND (
          l.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM draft_participants dp
            WHERE dp.draft_id = d.id AND dp.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "League owner can insert imported teams until link is locked"
  ON external_league_teams FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_league_teams.link_id
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );

CREATE POLICY "League owner can update imported teams until link is locked"
  ON external_league_teams FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_league_teams.link_id
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_league_teams.link_id
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );

CREATE POLICY "League owner can delete imported teams until link is locked"
  ON external_league_teams FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_league_teams.link_id
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );


-- ============================================================
-- external_roster_players
-- ============================================================

-- All draft participants can read roster players (needed for KeeperSelectionStep)
CREATE POLICY "Draft participants and league owner can view roster players"
  ON external_roster_players FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_roster_players.link_id
        AND (
          l.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM draft_participants dp
            WHERE dp.draft_id = d.id AND dp.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "League owner can insert roster players until link is locked"
  ON external_roster_players FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_roster_players.link_id
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );

CREATE POLICY "League owner can update roster players until link is locked"
  ON external_roster_players FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_roster_players.link_id
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_roster_players.link_id
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );

CREATE POLICY "League owner can delete roster players until link is locked"
  ON external_roster_players FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN drafts d ON d.id = ell.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE ell.id = external_roster_players.link_id
        AND l.owner_id = auth.uid()
        AND ell.locked_at IS NULL
    )
  );


-- ============================================================
-- external_player_mappings
-- Platform-wide reference data. Any authenticated user can read and create.
-- Only the creator can update or delete their own mappings.
-- ============================================================

CREATE POLICY "Authenticated users can view all player mappings"
  ON external_player_mappings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create player mappings"
  ON external_player_mappings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Mapping creator can update their own mappings"
  ON external_player_mappings FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Mapping creator can delete their own mappings"
  ON external_player_mappings FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);


-- ============================================================
-- draft_keeper_assignments
-- ============================================================

-- All participants see confirmed keepers in the draft room
CREATE POLICY "Draft participants and league owner can view keeper assignments"
  ON draft_keeper_assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_keeper_assignments.draft_id
        AND (
          l.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM draft_participants dp
            WHERE dp.draft_id = d.id AND dp.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "League owner can assign keepers while draft is pending"
  ON draft_keeper_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_keeper_assignments.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );

CREATE POLICY "League owner can update keeper assignments while draft is pending"
  ON draft_keeper_assignments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_keeper_assignments.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_keeper_assignments.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );

CREATE POLICY "League owner can delete keeper assignments while draft is pending"
  ON draft_keeper_assignments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_keeper_assignments.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );


-- ============================================================
-- draft_scoring_rules
-- ============================================================

CREATE POLICY "Authenticated users can view draft scoring rules"
  ON draft_scoring_rules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "League owner can create scoring rules while draft is pending"
  ON draft_scoring_rules FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_scoring_rules.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );

CREATE POLICY "League owner can update scoring rules while draft is pending"
  ON draft_scoring_rules FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_scoring_rules.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_scoring_rules.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );

CREATE POLICY "League owner can delete scoring rules while draft is pending"
  ON draft_scoring_rules FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_scoring_rules.draft_id
        AND l.owner_id = auth.uid()
        AND d.status = 'pending'
    )
  );
