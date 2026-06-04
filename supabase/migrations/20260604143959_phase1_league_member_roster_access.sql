/*
  # Phase 1 — League Member Roster Access

  ## Problem
  Non-owner league members cannot read imported roster data because all SELECT
  policies on the four import tables are restricted to either:
    - the league owner, OR
    - draft_participants for a specific draft

  This means a user who has claimed an imported team cannot see their own roster
  before a draft exists (no draft_participants row exists yet).

  ## Changes

  ### 1. league_imported_members
  Replace owner-only SELECT policy with one that also allows any league member
  to read imported members for leagues they belong to.

  ### 2. external_league_links
  Replace the draft-participants-or-owner SELECT policy with one that also
  allows any league member to read import links for their league.

  ### 3. external_league_teams
  Replace the draft-participants-or-owner SELECT policy with one that also
  allows any league member to read imported team rows.

  ### 4. external_roster_players
  Replace the draft-participants-or-owner SELECT policy with one that also
  allows any league member to read roster player rows.

  ## Security
  - Only SELECT is expanded. INSERT/UPDATE/DELETE remain owner-only.
  - Access is scoped to the specific league the user belongs to.
  - League membership is checked via league_members.user_id = auth.uid().
*/

-- ============================================================
-- 1. league_imported_members
-- ============================================================
DROP POLICY IF EXISTS "League owners can read imported members" ON league_imported_members;

CREATE POLICY "League members can read imported members"
  ON league_imported_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_imported_members.league_id
        AND lm.user_id = auth.uid()
    )
  );


-- ============================================================
-- 2. external_league_links
-- ============================================================
DROP POLICY IF EXISTS "Draft participants and league owner can view import links" ON external_league_links;

CREATE POLICY "League members, draft participants, and owner can view import links"
  ON external_league_links FOR SELECT
  TO authenticated
  USING (
    -- league owner (via draft → league chain, kept for backward compat)
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
    OR
    -- any league member (covers pre-draft, no draft_participants yet)
    EXISTS (
      SELECT 1 FROM league_members lm
      JOIN leagues l ON l.id = lm.league_id
      WHERE l.id = external_league_links.league_id
        AND lm.user_id = auth.uid()
    )
  );


-- ============================================================
-- 3. external_league_teams
-- ============================================================
DROP POLICY IF EXISTS "Draft participants and league owner can view imported teams" ON external_league_teams;

CREATE POLICY "League members, draft participants, and owner can view imported teams"
  ON external_league_teams FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_league_teams.link_id
        AND (
          -- league owner
          l.owner_id = auth.uid()
          OR
          -- any draft participant
          EXISTS (
            SELECT 1 FROM draft_participants dp
            WHERE dp.draft_id = ell.draft_id AND dp.user_id = auth.uid()
          )
          OR
          -- any league member
          EXISTS (
            SELECT 1 FROM league_members lm
            WHERE lm.league_id = l.id AND lm.user_id = auth.uid()
          )
        )
    )
  );


-- ============================================================
-- 4. external_roster_players
-- ============================================================
DROP POLICY IF EXISTS "Draft participants and league owner can view roster players" ON external_roster_players;

CREATE POLICY "League members, draft participants, and owner can view roster players"
  ON external_roster_players FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM external_league_links ell
      JOIN leagues l ON l.id = ell.league_id
      WHERE ell.id = external_roster_players.link_id
        AND (
          -- league owner
          l.owner_id = auth.uid()
          OR
          -- any draft participant
          EXISTS (
            SELECT 1 FROM draft_participants dp
            WHERE dp.draft_id = ell.draft_id AND dp.user_id = auth.uid()
          )
          OR
          -- any league member
          EXISTS (
            SELECT 1 FROM league_members lm
            WHERE lm.league_id = l.id AND lm.user_id = auth.uid()
          )
        )
    )
  );
