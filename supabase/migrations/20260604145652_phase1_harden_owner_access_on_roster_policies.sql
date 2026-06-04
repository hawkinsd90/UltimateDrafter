/*
  # Phase 1 cleanup — Harden owner access in roster SELECT policies

  ## Problems fixed

  ### 1. league_imported_members
  The previous migration replaced the owner-only SELECT policy with a
  league-member-only policy. This is unsafe: a league owner may not always
  have a league_members row (they could be the creator but not yet listed
  as a member in that table). The fix adds the owner branch back using
  leagues.owner_id directly, so access is granted to:
    - the league owner (via leagues.owner_id), OR
    - any league member (via league_members)

  ### 2. external_league_links
  The owner branch in the previous policy traverses draft_id → drafts → leagues.
  That chain breaks before a draft exists (draft_id is not null on existing rows,
  but the intent of Phase 1 is to work at the league level). Adding a direct
  league_id → leagues.owner_id branch makes owner access robust regardless of
  draft state.

  No changes to INSERT/UPDATE/DELETE policies.
*/

-- ============================================================
-- 1. league_imported_members — add owner branch alongside member branch
-- ============================================================
DROP POLICY IF EXISTS "League members can read imported members" ON league_imported_members;

CREATE POLICY "League owner or member can read imported members"
  ON league_imported_members FOR SELECT
  TO authenticated
  USING (
    -- direct owner check (does not depend on league_members row existing)
    EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = league_imported_members.league_id
        AND l.owner_id = auth.uid()
    )
    OR
    -- any league member
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_imported_members.league_id
        AND lm.user_id = auth.uid()
    )
  );


-- ============================================================
-- 2. external_league_links — add direct league_id owner branch
-- ============================================================
DROP POLICY IF EXISTS "League members, draft participants, and owner can view import links" ON external_league_links;

CREATE POLICY "League members, draft participants, and owner can view import links"
  ON external_league_links FOR SELECT
  TO authenticated
  USING (
    -- direct league owner (works before/without a draft)
    EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = external_league_links.league_id
        AND l.owner_id = auth.uid()
    )
    OR
    -- league owner via draft chain (backward compat)
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
    -- any league member (pre-draft access)
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = external_league_links.league_id
        AND lm.user_id = auth.uid()
    )
  );
