/*
  Phase 3C - Migration 5
  Add trade_proposal_id column to league_roster_transactions.
  Applied after league_trade_proposals exists.
*/

ALTER TABLE league_roster_transactions
  ADD COLUMN trade_proposal_id uuid
    REFERENCES league_trade_proposals(id) ON DELETE SET NULL;

CREATE INDEX idx_lrt_trade_proposal_id
  ON league_roster_transactions(trade_proposal_id);
