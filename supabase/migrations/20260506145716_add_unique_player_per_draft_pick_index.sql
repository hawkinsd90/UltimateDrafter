/*
  # Add unique player-per-draft protection on draft_picks

  ## Summary
  Prevents the same player from being drafted more than once in the same draft
  at the database level.

  ## Problem being solved
  draft_picks previously only had UNIQUE (draft_id, pick_number).
  Nothing stopped the same player_id from appearing in multiple rows for the
  same draft_id, leaving duplicate-pick prevention entirely to client-side logic.

  ## Solution
  A partial unique index on (draft_id, player_id) WHERE player_id IS NOT NULL.

  The partial condition is required because:
  - player_id can be NULL (pick slots reserved before a player is assigned,
    and the FK is ON DELETE SET NULL).
  - Multiple NULL pick slots in the same draft must remain allowed.
  - Only non-null player_id values need uniqueness enforcement.

  ## Pre-flight duplicate check
  Before creating the index, this migration verifies there are no existing
  duplicate (draft_id, player_id) rows. If duplicates were found the index
  creation would fail safely — no data is deleted automatically.

  ## Notes
  - No existing duplicates were found in the database at migration time.
  - This index also serves as a lookup index for "has player X been drafted?"
    queries, improving draft board rendering performance.
*/

DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT draft_id, player_id
    FROM draft_picks
    WHERE player_id IS NOT NULL
    GROUP BY draft_id, player_id
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create unique index: % duplicate (draft_id, player_id) row(s) exist in draft_picks. Resolve duplicates before re-running this migration.',
      v_dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS draft_picks_unique_player_per_draft
  ON public.draft_picks (draft_id, player_id)
  WHERE player_id IS NOT NULL;
