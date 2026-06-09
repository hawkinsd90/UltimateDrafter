/*
  # Create league_roster_transactions table

  Structured transaction log for all roster operations.
  Designed to support drops now and trades/adds later without schema changes.

  ## Design notes
  - draft_id is nullable — drops can occur before any draft exists.
  - from_league_member_id = team losing the player (drops, trade sends)
  - to_league_member_id   = team gaining the player (adds, trade receives) — null for drops
  - imported_member_id    = unclaimed team anchor for drops on unclaimed teams
  - All FK columns use ON DELETE SET NULL so historical rows survive row deletions.
  - external_player_name/external_position are frozen at insert time for historical display.
  - No direct client INSERT/UPDATE/DELETE — all mutations via SECURITY DEFINER RPCs.
*/

CREATE TABLE IF NOT EXISTS league_roster_transactions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  league_id               uuid        NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  draft_id                uuid        REFERENCES drafts(id) ON DELETE SET NULL,

  transaction_type        text        NOT NULL
                            CHECK (transaction_type IN (
                              'import_seed', 'drop',
                              'trade_accept', 'trade_reject', 'trade_expire',
                              'draft_pick', 'add'
                            )),

  actor_user_id           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- The member who lost the player (drop, trade send)
  from_league_member_id   uuid        REFERENCES league_members(id) ON DELETE SET NULL,
  -- The member who gained the player (add, trade receive) — null for drops
  to_league_member_id     uuid        REFERENCES league_members(id) ON DELETE SET NULL,

  -- Unclaimed team anchor — useful when league_member_id is null
  imported_member_id      uuid        REFERENCES league_imported_members(id) ON DELETE SET NULL,

  -- The app-owned roster row involved
  league_roster_player_id uuid        REFERENCES league_roster_players(id) ON DELETE SET NULL,

  -- Player identifiers frozen at transaction time for historical display
  sports_player_id        uuid        REFERENCES sports_players(id) ON DELETE SET NULL,
  external_player_name    text,
  external_position       text,

  -- Flexible extra context (commissioner note, draft round, autopick flag, etc.)
  metadata                jsonb       NOT NULL DEFAULT '{}',

  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_lrt_league_id        ON league_roster_transactions(league_id);
CREATE INDEX idx_lrt_draft_id         ON league_roster_transactions(draft_id);
CREATE INDEX idx_lrt_actor_user_id    ON league_roster_transactions(actor_user_id);
CREATE INDEX idx_lrt_type_league      ON league_roster_transactions(league_id, transaction_type);
CREATE INDEX idx_lrt_created_at       ON league_roster_transactions(created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE league_roster_transactions ENABLE ROW LEVEL SECURITY;

-- League members and owner can read all transactions for their league
CREATE POLICY "select_league_roster_transactions"
  ON league_roster_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_roster_transactions.league_id
        AND lm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = league_roster_transactions.league_id
        AND l.owner_id = auth.uid()
    )
  );

-- No direct client INSERT, UPDATE, or DELETE.
-- All mutations go through SECURITY DEFINER RPCs.
