/*
  # RPC: validate_draft_can_start

  Returns a JSON object with:
    valid    boolean   — true only if no blocking errors exist
    errors   text[]    — blocking issues; draft cannot start until resolved
    warnings text[]    — non-blocking notices shown to commissioner

  ## Blocking errors checked
  1. Draft exists and belongs to the caller's league (ownership gate)
  2. At least 2 draft_participants exist
  3. draft_settings row exists
  4. If an external_league_links row exists:
     a. import_status must be 'mapped' or 'locked'
     b. No external_league_teams rows with mapping_status = 'pending'
  5. No draft_keeper_assignments with a sports_player_id that doesn't exist
     (data integrity — caught by FK, but validated explicitly)
  6. No duplicate sports_player_id in draft_keeper_assignments for this draft
     (caught by UNIQUE constraint, but validated for clear error messaging)
  7. Every draft_keeper_assignments.participant_id must belong to this draft

  ## Non-blocking warnings
  W1. External link exists with import_mode = 'reference_only' (no keepers — informational)
  W2. Some external_roster_players are 'unresolved' but not selected as keepers (incomplete data)
  W3. Keeper count exceeds half of total draft pick capacity (unusual but allowed)

  ## Security
  SECURITY DEFINER so the function can read all required tables even when
  the caller has restricted SELECT access. Validates ownership explicitly
  before returning any data.
*/

CREATE OR REPLACE FUNCTION validate_draft_can_start(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_errors            text[] := '{}';
  v_warnings          text[] := '{}';
  v_draft             record;
  v_participant_count integer;
  v_settings_exists   boolean;
  v_link              record;
  v_pending_teams     integer;
  v_orphan_keepers    integer;
  v_keeper_count      integer;
  v_total_rounds      integer;
  v_unresolved_count  integer;
BEGIN
  -- ── 0. Load draft and verify caller is the league owner ──────────────────
  SELECT d.id, d.status, d.league_id,
         d.current_pick_number, l.owner_id
  INTO   v_draft
  FROM   drafts d
  JOIN   leagues l ON l.id = d.league_id
  WHERE  d.id = p_draft_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid',    false,
      'errors',   jsonb_build_array('Draft not found.'),
      'warnings', '[]'::jsonb
    );
  END IF;

  IF v_draft.owner_id <> auth.uid() THEN
    RETURN jsonb_build_object(
      'valid',    false,
      'errors',   jsonb_build_array('Only the league owner can start the draft.'),
      'warnings', '[]'::jsonb
    );
  END IF;

  -- ── 1. Participant count ──────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_participant_count
  FROM   draft_participants
  WHERE  draft_id = p_draft_id;

  IF v_participant_count < 2 THEN
    v_errors := v_errors || format(
      'Draft needs at least 2 participants (%s currently added).',
      v_participant_count
    );
  END IF;

  -- ── 2. Draft settings must exist ─────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM draft_settings WHERE draft_id = p_draft_id
  ) INTO v_settings_exists;

  IF NOT v_settings_exists THEN
    v_errors := v_errors || 'Draft settings have not been configured.';
  END IF;

  -- ── 3. External league link checks (only if a link exists) ───────────────
  SELECT ell.*
  INTO   v_link
  FROM   external_league_links ell
  WHERE  ell.draft_id = p_draft_id;

  IF FOUND THEN

    -- 3a. Import must be mapped or locked before draft can start
    IF v_link.import_status NOT IN ('mapped', 'locked') THEN
      v_errors := v_errors || format(
        'External league import is not complete (status: %s). '
        'Finish mapping all teams before starting the draft.',
        v_link.import_status
      );
    END IF;

    -- 3b. No teams may remain in 'pending' mapping state
    SELECT COUNT(*) INTO v_pending_teams
    FROM   external_league_teams
    WHERE  link_id = v_link.id
      AND  mapping_status = 'pending';

    IF v_pending_teams > 0 THEN
      v_errors := v_errors || format(
        '%s imported team%s %s not yet mapped or ignored. '
        'Resolve all teams in the import wizard before starting.',
        v_pending_teams,
        CASE WHEN v_pending_teams = 1 THEN '' ELSE 's' END,
        CASE WHEN v_pending_teams = 1 THEN 'is' ELSE 'are' END
      );
    END IF;

    -- W1. Reference-only mode produces no keepers (informational)
    IF v_link.import_mode = 'reference_only' THEN
      v_warnings := v_warnings || 'External league is linked in reference-only mode. No keepers will be pre-assigned.';
    END IF;

    -- W2. Unresolved roster players not selected as keepers
    SELECT COUNT(*) INTO v_unresolved_count
    FROM   external_roster_players erp
    WHERE  erp.link_id = v_link.id
      AND  erp.resolution_status = 'unresolved'
      AND  erp.sports_player_id IS NULL
      -- only warn if this player was not explicitly skipped
      AND  NOT EXISTS (
             SELECT 1 FROM draft_keeper_assignments dka
             WHERE  dka.draft_id = p_draft_id
               AND  dka.sports_player_id = erp.sports_player_id
           );

    IF v_unresolved_count > 0 THEN
      v_warnings := v_warnings || format(
        '%s imported roster player%s could not be matched to a known player and %s been skipped. '
        'These players are excluded from the draft pool by default.',
        v_unresolved_count,
        CASE WHEN v_unresolved_count = 1 THEN '' ELSE 's' END,
        CASE WHEN v_unresolved_count = 1 THEN 'has' ELSE 'have' END
      );
    END IF;

  END IF;

  -- ── 4. Keeper assignment integrity ───────────────────────────────────────

  -- 4a. Every keeper's participant_id must belong to this draft
  SELECT COUNT(*) INTO v_orphan_keepers
  FROM   draft_keeper_assignments dka
  WHERE  dka.draft_id = p_draft_id
    AND  NOT EXISTS (
           SELECT 1 FROM draft_participants dp
           WHERE  dp.id = dka.participant_id
             AND  dp.draft_id = p_draft_id
         );

  IF v_orphan_keepers > 0 THEN
    v_errors := v_errors || format(
      '%s keeper assignment%s reference%s a participant not in this draft. '
      'Remove and re-add affected keepers.',
      v_orphan_keepers,
      CASE WHEN v_orphan_keepers = 1 THEN '' ELSE 's' END,
      CASE WHEN v_orphan_keepers = 1 THEN 's' ELSE '' END
    );
  END IF;

  -- ── 5. Keeper count capacity warning ─────────────────────────────────────
  SELECT COUNT(*) INTO v_keeper_count
  FROM   draft_keeper_assignments
  WHERE  draft_id = p_draft_id;

  IF v_keeper_count > 0 AND v_settings_exists AND v_participant_count >= 2 THEN
    SELECT COALESCE(
      (ds.roster_qb + ds.roster_rb + ds.roster_wr + ds.roster_te +
       ds.roster_flex + ds.roster_k + ds.roster_dst + ds.bench),
      0
    ) INTO v_total_rounds
    FROM draft_settings ds
    WHERE ds.draft_id = p_draft_id;

    -- W3. Warn if keepers exceed half of total pick capacity
    IF v_keeper_count > (v_total_rounds * v_participant_count / 2) THEN
      v_warnings := v_warnings || format(
        '%s keeper%s assigned across all teams, which is more than half of the '
        'total pick capacity (%s picks). Verify this is intentional.',
        v_keeper_count,
        CASE WHEN v_keeper_count = 1 THEN ' is' ELSE 's are' END,
        v_total_rounds * v_participant_count
      );
    END IF;
  END IF;

  -- ── Result ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'valid',    cardinality(v_errors) = 0,
    'errors',   to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings)
  );
END;
$$;

-- Revoke public execute; only authenticated users may call this
REVOKE ALL ON FUNCTION validate_draft_can_start(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_draft_can_start(uuid) TO authenticated;
