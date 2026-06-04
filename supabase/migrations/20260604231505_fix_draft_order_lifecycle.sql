/*
  # Fix draft_order lifecycle

  ## Problems fixed

  1. league_members.draft_order column may not exist as a migration.
     Add it idempotently with a default of NULL.

  2. Owner is never assigned draft_order = 1 at league creation.
     We fix this via a trigger on league_members so it fires on every INSERT.

  3. Joining members (via accept_league_invite) are never assigned draft_order.
     Replace the RPC to auto-assign the next available draft_order on insert.

  4. Existing league_members rows with null draft_order get repaired.
     Safe: assigns them to the end of their league's order; preserves existing values.

  ## Strategy
  - Add draft_order column if missing.
  - Add a BEFORE INSERT trigger on league_members that fills draft_order = next
    available position in the league if the value is not explicitly provided.
  - Replace accept_league_invite to pass draft_order through the trigger path
    (no explicit draft_order needed — trigger fills it automatically).
  - Backfill existing rows where draft_order IS NULL.
  - Update league_members UPDATE RLS to allow owners to set draft_order.
*/

-- ── 1. Add draft_order column ─────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'league_members'
      AND column_name  = 'draft_order'
  ) THEN
    ALTER TABLE league_members ADD COLUMN draft_order integer;
  END IF;
END $$;

-- ── 2. Trigger: auto-assign draft_order on INSERT ─────────────────────────────
-- If draft_order is NULL when a row is inserted, assign next available position.

CREATE OR REPLACE FUNCTION assign_draft_order_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_next integer;
BEGIN
  IF NEW.draft_order IS NULL THEN
    SELECT COALESCE(MAX(draft_order), 0) + 1
    INTO v_next
    FROM league_members
    WHERE league_id = NEW.league_id;
    NEW.draft_order = v_next;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_draft_order ON league_members;
CREATE TRIGGER trg_assign_draft_order
  BEFORE INSERT ON league_members
  FOR EACH ROW EXECUTE FUNCTION assign_draft_order_on_insert();

-- ── 3. RLS: allow league owner to update draft_order ─────────────────────────

DROP POLICY IF EXISTS "League owner can update member draft_order" ON league_members;
CREATE POLICY "League owner can update member draft_order"
  ON league_members FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_members.league_id
        AND leagues.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_members.league_id
        AND leagues.owner_id = auth.uid()
    )
  );

-- ── 4. Backfill existing rows where draft_order IS NULL ───────────────────────
-- Assigns each null-draft_order member to the end of their league's order.
-- Preserves all existing non-null values; assigns in joined_at order for determinism.

DO $$
DECLARE
  r RECORD;
  v_next integer;
BEGIN
  FOR r IN
    SELECT id, league_id, joined_at
    FROM league_members
    WHERE draft_order IS NULL
    ORDER BY league_id, joined_at
  LOOP
    SELECT COALESCE(MAX(draft_order), 0) + 1
    INTO v_next
    FROM league_members
    WHERE league_id = r.league_id
      AND draft_order IS NOT NULL;

    UPDATE league_members SET draft_order = v_next WHERE id = r.id;
  END LOOP;
END $$;
