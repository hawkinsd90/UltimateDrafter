/*
# Add SMS notifications for trade activity

1. Purpose
- Notify the receiving team when a player trade proposal is created.
- Notify the proposing team when the proposal is accepted, rejected, or canceled.
- Use the existing notifications_outbox queue so the existing Telnyx worker handles delivery and retries.

2. Modified objects
- Add `enqueue_trade_sms` trigger function.
  - Resolves the target user's verified phone number and SMS consent.
  - Creates an outbox row only when the target has a verified phone and has opted into SMS.
  - Includes both fantasy team names and the involved player names in the message.
- Add an insert trigger on `league_trade_proposals` for new proposals.
- Add an update trigger on `league_trade_proposals` for accepted, rejected, and canceled proposals.

3. Security
- The trigger function is SECURITY DEFINER with a fixed public search path so trade RPCs can enqueue notifications atomically.
- Public execution of the helper is revoked; it is callable only through the database triggers.
- Phone numbers and consent are checked server-side from `user_profile`.
- No notification is queued for an unverified phone or missing SMS consent.

4. Important notes
- This does not send SMS directly from the browser.
- If Telnyx is unavailable, the existing worker retains the queued notification for retry according to its current rules.
- Existing trade behavior, player movement, and proposal statuses remain unchanged.
*/

CREATE OR REPLACE FUNCTION enqueue_trade_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id uuid;
  v_target_phone text;
  v_proposer_team text;
  v_receiver_team text;
  v_player_summary text;
  v_message text;
  v_template_key text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT lm.user_id
    INTO v_target_user_id
    FROM league_members lm
    WHERE lm.id = NEW.receiver_member_id;

    SELECT COALESCE(lim.team_name, 'the other team')
    INTO v_proposer_team
    FROM league_imported_members lim
    JOIN league_members lm ON lm.user_id = lim.invited_user_id AND lm.league_id = lim.league_id
    WHERE lm.id = NEW.proposer_member_id
    LIMIT 1;

    SELECT COALESCE(lim.team_name, 'the other team')
    INTO v_receiver_team
    FROM league_imported_members lim
    JOIN league_members lm ON lm.user_id = lim.invited_user_id AND lm.league_id = lim.league_id
    WHERE lm.id = NEW.receiver_member_id
    LIMIT 1;

    SELECT string_agg(snapshot_player_name, ', ' ORDER BY direction, snapshot_player_name)
    INTO v_player_summary
    FROM league_trade_proposal_players
    WHERE trade_proposal_id = NEW.id;

    v_message := format(
      'DraftMaster: %s sent %s a player trade proposal involving %s. Open DraftMaster to review it.',
      COALESCE(v_proposer_team, 'A league team'),
      COALESCE(v_receiver_team, 'your team'),
      COALESCE(v_player_summary, 'players')
    );
    v_template_key := 'trade_proposal_received';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('accepted', 'rejected', 'canceled') THEN
    v_target_user_id := NEW.proposer_user_id;

    SELECT COALESCE(lim.team_name, 'the other team')
    INTO v_proposer_team
    FROM league_imported_members lim
    JOIN league_members lm ON lm.user_id = lim.invited_user_id AND lm.league_id = lim.league_id
    WHERE lm.id = NEW.proposer_member_id
    LIMIT 1;

    SELECT COALESCE(lim.team_name, 'the other team')
    INTO v_receiver_team
    FROM league_imported_members lim
    JOIN league_members lm ON lm.user_id = lim.invited_user_id AND lm.league_id = lim.league_id
    WHERE lm.id = NEW.receiver_member_id
    LIMIT 1;

    SELECT string_agg(snapshot_player_name, ', ' ORDER BY direction, snapshot_player_name)
    INTO v_player_summary
    FROM league_trade_proposal_players
    WHERE trade_proposal_id = NEW.id;

    v_message := format(
      'DraftMaster: %s %s the player trade between %s and %s involving %s. Open DraftMaster for details.',
      COALESCE(v_receiver_team, 'The receiving team'),
      CASE NEW.status
        WHEN 'accepted' THEN 'accepted'
        WHEN 'rejected' THEN 'rejected'
        ELSE 'canceled'
      END,
      COALESCE(v_proposer_team, 'your team'),
      COALESCE(v_receiver_team, 'the other team'),
      COALESCE(v_player_summary, 'players')
    );
    v_template_key := 'trade_' || NEW.status;
  ELSE
    RETURN NEW;
  END IF;

  SELECT up.phone_e164
  INTO v_target_phone
  FROM user_profile up
  WHERE up.user_id = v_target_user_id
    AND up.phone_verified = true
    AND up.sms_consent = true
    AND up.phone_e164 IS NOT NULL;

  IF v_target_phone IS NOT NULL THEN
    INSERT INTO notifications_outbox (
      notification_type,
      channel,
      user_id,
      league_id,
      template_key,
      payload,
      message_text,
      destination,
      status,
      next_attempt_at
    ) VALUES (
      'trade',
      'sms',
      v_target_user_id,
      NEW.league_id,
      v_template_key,
      jsonb_build_object(
        'trade_proposal_id', NEW.id,
        'status', CASE WHEN TG_OP = 'INSERT' THEN 'pending' ELSE NEW.status END,
        'proposer_team', v_proposer_team,
        'receiver_team', v_receiver_team,
        'players', v_player_summary
      ),
      v_message,
      v_target_phone,
      'pending',
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_trade_sms() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_trade_proposal_sms_on_create ON league_trade_proposals;
CREATE TRIGGER trg_trade_proposal_sms_on_create
  AFTER INSERT ON league_trade_proposals
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_trade_sms();

DROP TRIGGER IF EXISTS trg_trade_proposal_sms_on_status_change ON league_trade_proposals;
CREATE TRIGGER trg_trade_proposal_sms_on_status_change
  AFTER UPDATE OF status ON league_trade_proposals
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION enqueue_trade_sms();