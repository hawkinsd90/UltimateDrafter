/*
# Limit trade SMS notifications to actionable outcomes

1. Purpose
- Notify the receiving team when a proposal is created.
- Notify the proposer only when the receiving team accepts or rejects it.
- Do not notify anyone when the proposer cancels a pending proposal.

2. Modified objects
- Update `trg_trade_proposal_sms_on_status_change` on `league_trade_proposals`.
- Restrict its status condition to `accepted` and `rejected`.

3. Security and data safety
- No trade rows are changed or deleted.
- Proposal creation notifications remain unchanged.
- Existing phone verification, SMS consent, and outbox delivery rules remain unchanged.
*/

DROP TRIGGER IF EXISTS trg_trade_proposal_sms_on_status_change ON league_trade_proposals;

CREATE TRIGGER trg_trade_proposal_sms_on_status_change
  AFTER UPDATE OF status ON league_trade_proposals
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('accepted', 'rejected')
  )
  EXECUTE FUNCTION enqueue_trade_sms();