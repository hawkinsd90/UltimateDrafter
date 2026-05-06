/*
  # Prep ESPN player mappings from sports_players.raw_data

  ## Purpose
  Many Sleeper-imported player rows contain an `espn_id` field in their raw_data
  JSON. This migration uses those ESPN IDs to auto-populate external_player_mappings
  for ESPN, dramatically increasing ESPN player ID coverage without any new API calls.

  ## What this does
  - Reads raw_data->>'espn_id' from sports_players (provider='sleeper')
  - Inserts into external_player_mappings with mapping_method='auto_id' and
    confidence=0.95 for each player not already mapped
  - Uses ON CONFLICT DO NOTHING — safe to re-run

  ## Notes
  - Before this migration: 342 ESPN mappings (all via 'auto_name')
  - After: expect ~1,486 additional mappings for players that have espn_id in raw_data
  - mapping_method='auto_id' fits the existing check constraint
*/

DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT user_id INTO v_admin_id FROM admin_users LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'No admin user found — skipping ESPN mapping prep.';
    RETURN;
  END IF;

  INSERT INTO external_player_mappings (
    provider,
    external_player_id,
    sports_player_id,
    external_player_name,
    external_position,
    mapping_method,
    confidence,
    created_by,
    created_at,
    updated_at
  )
  SELECT
    'espn'                          AS provider,
    sp.raw_data->>'espn_id'         AS external_player_id,
    sp.id                           AS sports_player_id,
    sp.display_name                 AS external_player_name,
    sp.fantasy_position             AS external_position,
    'auto_id'                       AS mapping_method,
    0.95                            AS confidence,
    v_admin_id                      AS created_by,
    now()                           AS created_at,
    now()                           AS updated_at
  FROM sports_players sp
  WHERE sp.provider = 'sleeper'
    AND sp.raw_data->>'espn_id' IS NOT NULL
    AND sp.raw_data->>'espn_id' != 'null'
    AND sp.raw_data->>'espn_id' != ''
    AND NOT EXISTS (
      SELECT 1 FROM external_player_mappings epm
      WHERE epm.provider = 'espn'
        AND epm.external_player_id = sp.raw_data->>'espn_id'
    )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'ESPN mapping prep complete.';
END $$;
