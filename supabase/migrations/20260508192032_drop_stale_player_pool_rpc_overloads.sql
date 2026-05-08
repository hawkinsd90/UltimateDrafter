/*
  # Drop stale overloads of get_draft_player_pool_with_rankings

  ## Summary
  Three overloaded versions of get_draft_player_pool_with_rankings exist in the database.
  PostgREST cannot safely resolve overloaded functions — it may route RPC calls to an
  older overload that lacks the p_draft_id exclusion filter, causing imported roster
  players to appear in Add Players even though draft_player_exclusions is correctly
  populated.

  ## Fix
  Drop the two stale overloads that have no exclusion filter:
    - 9-param version (no p_draft_scoring_rule_id, no p_draft_id)
    - 10-param version (has p_draft_scoring_rule_id, no p_draft_id)

  Keep only the 11-param version which has both p_draft_scoring_rule_id and p_draft_id
  with the draft_player_exclusions NOT EXISTS filter.

  ## No logic changes
  The 11-param function body is untouched. Only the stale overloads are dropped.

  ## Notes
  - Frontend (useMyDraftBoard.ts) already passes p_draft_id in all RPC calls
  - After this migration, PostgREST will resolve to exactly one function unambiguously
*/

-- Drop 9-param overload (no rule_id, no draft_id, no exclusion filter)
DROP FUNCTION IF EXISTS get_draft_player_pool_with_rankings(
  text, text, integer, text,
  text, text, text, integer, integer
);

-- Drop 10-param overload (rule_id but no draft_id, no exclusion filter)
DROP FUNCTION IF EXISTS get_draft_player_pool_with_rankings(
  text, text, integer, text,
  text, text, text, integer, integer,
  uuid
);
