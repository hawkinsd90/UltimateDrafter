/*
  Phase 3C - Migration 4
  Create league_trade_proposal_players table.
*/

CREATE TABLE league_trade_proposal_players (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_proposal_id       uuid        NOT NULL
                            REFERENCES league_trade_proposals(id) ON DELETE CASCADE,

  -- 'send'    = player moves FROM proposer TO receiver
  -- 'receive' = player moves FROM receiver TO proposer
  direction               text        NOT NULL
                            CHECK (direction IN ('send', 'receive')),

  -- ON DELETE RESTRICT enforces that the drop RPC must block if a pending
  -- proposal references this row.
  league_roster_player_id uuid        NOT NULL
                            REFERENCES league_roster_players(id) ON DELETE RESTRICT,

  -- Snapshot fields frozen at proposal creation time
  sports_player_id        uuid        REFERENCES sports_players(id) ON DELETE SET NULL,
  snapshot_player_name    text        NOT NULL,
  snapshot_position       text,
  snapshot_team_name      text,

  created_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (trade_proposal_id, league_roster_player_id)
);

CREATE INDEX idx_ltpp_proposal_id ON league_trade_proposal_players(trade_proposal_id);
CREATE INDEX idx_ltpp_lrp_id      ON league_trade_proposal_players(league_roster_player_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE league_trade_proposal_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_league_trade_proposal_players"
  ON league_trade_proposal_players FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_trade_proposals ltp
      JOIN league_members lm ON lm.league_id = ltp.league_id
      WHERE ltp.id = league_trade_proposal_players.trade_proposal_id
        AND lm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM league_trade_proposals ltp
      JOIN leagues l ON l.id = ltp.league_id
      WHERE ltp.id = league_trade_proposal_players.trade_proposal_id
        AND l.owner_id = auth.uid()
    )
  );
