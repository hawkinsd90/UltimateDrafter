/*
  # Backfill all drafts with external league links using clean rebuild logic

  ## Summary
  Replaces all import-driven exclusions for every draft that has an external_league_link
  with a clean rebuild using the same logic as rebuild_draft_player_exclusions().

  This replaces previous ad-hoc backfill migrations and ensures consistency:
  - Deletes all 'external_ignored_team' and 'external_mapped_team' source exclusions
  - Inserts deduplicated exclusions for mapped teams (source='external_mapped_team')
    and ignored/unavailable teams (source='external_ignored_team')
  - Mapped teams take priority when a player appears on multiple rosters
  - Players from ignored/available teams are NOT excluded

  ## Affected drafts
  - 9fb03787-596f-4890-939d-f03b95bc1ee4 (ghjghj, paused)
  - 1c45352c-b6e3-481c-aaa1-cb513db7b95e (ytfrds, paused)
*/

DO $$
DECLARE
  v_draft_id uuid;
  v_deleted  int;
  v_inserted int;
BEGIN
  FOR v_draft_id IN
    SELECT DISTINCT ell.draft_id
    FROM external_league_links ell
  LOOP
    -- Delete import-driven exclusions for this draft
    DELETE FROM draft_player_exclusions
    WHERE draft_id = v_draft_id
      AND source IN ('external_ignored_team', 'external_mapped_team');

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    -- Rebuild from all teams that should exclude players
    INSERT INTO draft_player_exclusions (
      draft_id,
      sports_player_id,
      source,
      external_league_team_id,
      external_roster_player_id,
      reason
    )
    SELECT DISTINCT ON (erp.sports_player_id)
      v_draft_id,
      erp.sports_player_id,
      CASE WHEN elt.mapping_status = 'mapped' THEN 'external_mapped_team' ELSE 'external_ignored_team' END,
      elt.id,
      erp.id,
      CASE WHEN elt.mapping_status = 'mapped'
        THEN 'Mapped team: ' || elt.external_team_name
        ELSE 'Ignored team (unavailable): ' || elt.external_team_name
      END
    FROM external_roster_players erp
    JOIN external_league_teams elt
      ON  elt.link_id          = erp.link_id
      AND elt.external_team_id = erp.external_team_id
    JOIN external_league_links ell ON ell.id = erp.link_id
    WHERE ell.draft_id = v_draft_id
      AND erp.sports_player_id IS NOT NULL
      AND (
        elt.mapping_status = 'mapped'
        OR (elt.mapping_status = 'ignored' AND elt.player_pool_policy = 'unavailable')
      )
    ORDER BY
      erp.sports_player_id,
      CASE WHEN elt.mapping_status = 'mapped' THEN 0 ELSE 1 END
    ON CONFLICT (draft_id, sports_player_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RAISE NOTICE 'Draft %: deleted %, inserted %', v_draft_id, v_deleted, v_inserted;
  END LOOP;
END $$;
