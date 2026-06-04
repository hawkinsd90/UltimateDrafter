/*
  # Trigger: sync league_roster_players ownership when league_imported_members.invited_user_id changes

  ## Problem
  Multiple code paths can set or clear league_imported_members.invited_user_id:
  - accept_league_invite RPC (handled manually in the RPC, but only for IS NULL case)
  - CreateLeague.tsx direct update (bypasses the RPC entirely)
  - LeagueMembersTab handleRemoveMember (clears invited_user_id to null)
  - Any future reassignment paths

  Relying on every caller to also update league_roster_players is fragile.

  ## Fix
  A trigger that fires AFTER INSERT OR UPDATE OF invited_user_id on league_imported_members
  and keeps league_roster_players.league_member_id / user_id in sync automatically.

  - When invited_user_id is set: find the matching league_members row and fill both fields.
  - When invited_user_id is cleared: set both fields to NULL.
  - No-op if invited_user_id did not change.

  This makes the accept_league_invite manual backfill redundant (belt-and-suspenders is fine),
  and fully covers the CreateLeague direct-update path and any future paths.
*/

CREATE OR REPLACE FUNCTION sync_roster_ownership_on_claim()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_league_member_id uuid;
BEGIN
  -- Skip if invited_user_id did not change
  IF TG_OP = 'UPDATE' AND NEW.invited_user_id IS NOT DISTINCT FROM OLD.invited_user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.invited_user_id IS NOT NULL THEN
    -- Locate the league_members row for this user in this league
    SELECT id INTO v_league_member_id
    FROM league_members
    WHERE league_id = NEW.league_id
      AND user_id   = NEW.invited_user_id
    LIMIT 1;

    -- Fill ownership on all active roster rows for this imported team
    UPDATE league_roster_players
    SET league_member_id = v_league_member_id,
        user_id          = NEW.invited_user_id
    WHERE imported_member_id = NEW.id
      AND league_id          = NEW.league_id;
  ELSE
    -- Clear ownership when unclaimed / reassigned
    UPDATE league_roster_players
    SET league_member_id = NULL,
        user_id          = NULL
    WHERE imported_member_id = NEW.id
      AND league_id          = NEW.league_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_roster_ownership_on_claim ON league_imported_members;
CREATE TRIGGER trg_sync_roster_ownership_on_claim
  AFTER INSERT OR UPDATE OF invited_user_id ON league_imported_members
  FOR EACH ROW EXECUTE FUNCTION sync_roster_ownership_on_claim();
