/*
  Phase 3C - Migration 3
  Create league_trade_proposals table.
*/

CREATE TABLE league_trade_proposals (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id            uuid        NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  proposer_member_id   uuid        NOT NULL REFERENCES league_members(id) ON DELETE CASCADE,
  proposer_user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- receiver_user_id intentionally omitted; derived at accept time
  receiver_member_id   uuid        NOT NULL REFERENCES league_members(id) ON DELETE CASCADE,

  status               text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled', 'expired')),

  resolved_by_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  commissioner_action  boolean     NOT NULL DEFAULT false,
  commissioner_note    text,

  message              text,

  expires_at           timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT no_self_trade CHECK (proposer_member_id != receiver_member_id)
);

-- updated_at trigger consistent with the rest of the project
CREATE OR REPLACE FUNCTION set_league_trade_proposals_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_league_trade_proposals_updated_at
  BEFORE UPDATE ON league_trade_proposals
  FOR EACH ROW EXECUTE FUNCTION set_league_trade_proposals_updated_at();

CREATE INDEX idx_ltp_league_id          ON league_trade_proposals(league_id);
CREATE INDEX idx_ltp_proposer_member_id ON league_trade_proposals(proposer_member_id);
CREATE INDEX idx_ltp_receiver_member_id ON league_trade_proposals(receiver_member_id);
CREATE INDEX idx_ltp_status             ON league_trade_proposals(league_id, status);
CREATE INDEX idx_ltp_pending            ON league_trade_proposals(league_id) WHERE status = 'pending';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE league_trade_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_league_trade_proposals"
  ON league_trade_proposals FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_trade_proposals.league_id
        AND lm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = league_trade_proposals.league_id
        AND l.owner_id = auth.uid()
    )
  );
