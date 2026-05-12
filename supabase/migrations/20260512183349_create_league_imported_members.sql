/*
  # Create league_imported_members table

  ## Purpose
  Stores the team owner names captured when a commissioner imports an existing
  Sleeper or ESPN league during Create League. These are used to:
  1. Surface member names in the league invite panel so the commissioner can
     send invites to their existing leaguemates.
  2. Auto-match incoming users by email if the same email was used on both
     platforms (best-effort, commissioner-triggered).

  ## New Tables
  - `league_imported_members`
    - `id` (uuid, pk)
    - `league_id` (uuid, fk → leagues.id)
    - `provider` (text) — 'sleeper' | 'espn'
    - `external_league_id` (text) — the ID on the provider's platform
    - `external_team_id` (text) — roster_id (Sleeper) or team ID (ESPN)
    - `external_owner_id` (text, nullable) — provider user/member ID
    - `external_owner_name` (text, nullable) — display name from provider
    - `team_name` (text) — team name from provider
    - `invited_user_id` (uuid, nullable, fk → auth.users) — set when auto/manual matched
    - `invite_id` (uuid, nullable, fk → league_invites) — set when an invite is sent
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled; only league owners can read/write their imported members.
*/

CREATE TABLE IF NOT EXISTS league_imported_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id           uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  external_league_id  text NOT NULL,
  external_team_id    text NOT NULL,
  external_owner_id   text,
  external_owner_name text,
  team_name           text NOT NULL DEFAULT '',
  invited_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_id           uuid REFERENCES league_invites(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_league_imported_members_league_id ON league_imported_members(league_id);

ALTER TABLE league_imported_members ENABLE ROW LEVEL SECURITY;

-- League owners can read imported members for their leagues
CREATE POLICY "League owners can read imported members"
  ON league_imported_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_imported_members.league_id
        AND leagues.owner_id = auth.uid()
    )
  );

-- League owners can insert imported members for their leagues
CREATE POLICY "League owners can insert imported members"
  ON league_imported_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_imported_members.league_id
        AND leagues.owner_id = auth.uid()
    )
  );

-- League owners can update imported members (e.g. set invite_id)
CREATE POLICY "League owners can update imported members"
  ON league_imported_members FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_imported_members.league_id
        AND leagues.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_imported_members.league_id
        AND leagues.owner_id = auth.uid()
    )
  );

-- League owners can delete imported members
CREATE POLICY "League owners can delete imported members"
  ON league_imported_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_imported_members.league_id
        AND leagues.owner_id = auth.uid()
    )
  );
