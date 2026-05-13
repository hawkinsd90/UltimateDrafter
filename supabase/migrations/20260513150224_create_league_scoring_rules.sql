/*
  # Create league_scoring_rules table

  ## Summary
  Stores per-league fantasy scoring rules as key/value pairs.
  Each row is one scoring stat (e.g. "pass_td" → 4 pts).

  ## New Tables
  - `league_scoring_rules`
    - `id` (uuid, pk)
    - `league_id` (uuid, fk → leagues)
    - `stat_key` (text) — canonical stat identifier, e.g. "pass_td", "rec", "rush_yd"
    - `points` (numeric) — points awarded per occurrence (can be negative/fractional)
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled, restrictive by default
  - League owners can insert/update/delete their own rules
  - All league members can read rules for their league
*/

CREATE TABLE IF NOT EXISTS league_scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  stat_key text NOT NULL,
  points numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (league_id, stat_key)
);

ALTER TABLE league_scoring_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "League members can read scoring rules"
  ON league_scoring_rules FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = league_scoring_rules.league_id
        AND league_members.user_id = auth.uid()
    )
  );

CREATE POLICY "League owners can insert scoring rules"
  ON league_scoring_rules FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = league_scoring_rules.league_id
        AND league_members.user_id = auth.uid()
        AND league_members.role = 'owner'
    )
  );

CREATE POLICY "League owners can update scoring rules"
  ON league_scoring_rules FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = league_scoring_rules.league_id
        AND league_members.user_id = auth.uid()
        AND league_members.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = league_scoring_rules.league_id
        AND league_members.user_id = auth.uid()
        AND league_members.role = 'owner'
    )
  );

CREATE POLICY "League owners can delete scoring rules"
  ON league_scoring_rules FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = league_scoring_rules.league_id
        AND league_members.user_id = auth.uid()
        AND league_members.role = 'owner'
    )
  );

CREATE INDEX IF NOT EXISTS idx_league_scoring_rules_league_id
  ON league_scoring_rules (league_id);
