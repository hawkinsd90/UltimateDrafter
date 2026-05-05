/*
  # Create draft_board_rankings table

  ## Summary
  Adds a per-user, per-draft player rankings table that lets each drafter build
  and reorder their personal draft board. The board persists across page reloads
  and is private to each user.

  ## New Tables
  - `draft_board_rankings`
    - `id` (uuid, primary key)
    - `draft_id` (uuid, FK → drafts)
    - `user_id` (uuid, FK → auth.users)
    - `sports_player_id` (uuid, FK → sports_players)
    - `rank` (integer) — lower number = higher priority (1 = top pick)
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)
    - Unique constraint on (draft_id, user_id, sports_player_id) — a player appears
      at most once per user per draft board.
    - Unique constraint on (draft_id, user_id, rank) — each rank slot is unique per board.

  ## Security
  - RLS enabled; users can only read and write their own ranking rows.
*/

CREATE TABLE IF NOT EXISTS draft_board_rankings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id         uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sports_player_id uuid NOT NULL REFERENCES sports_players(id) ON DELETE CASCADE,
  rank             integer NOT NULL CHECK (rank >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, user_id, sports_player_id),
  UNIQUE (draft_id, user_id, rank)
);

ALTER TABLE draft_board_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own draft board rankings"
  ON draft_board_rankings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own draft board rankings"
  ON draft_board_rankings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own draft board rankings"
  ON draft_board_rankings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own draft board rankings"
  ON draft_board_rankings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_draft_board_rankings_draft_user
  ON draft_board_rankings (draft_id, user_id, rank);
