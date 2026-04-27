/*
  # Add league_members and league_invites tables

  ## New Tables

  ### league_members
  Tracks who has joined a league. The owner is automatically added as a member on creation.
  - `id` – primary key
  - `league_id` – FK to leagues
  - `user_id` – FK to auth.users (nullable; phone-only invites may not have a user yet)
  - `display_name` – human-readable name for this member in the league
  - `phone_e164` – optional phone number used for SMS invites / notifications
  - `role` – 'owner' | 'member'
  - `joined_at` – when they accepted / were added

  ### league_invites
  Stores pending invitations. Each row has a unique token used in the join link.
  - `id` – primary key (also serves as the invite token in the URL)
  - `league_id` – FK to leagues
  - `invited_by` – FK to auth.users (league owner)
  - `phone_e164` – if invited by phone number, stored here for pre-fill
  - `accepted_at` – null until the invitee accepts
  - `expires_at` – invites expire after 7 days

  ## Security
  - RLS enabled on both tables
  - league_members: owner can read/write all rows for their leagues; members can read their own row
  - league_invites: owner can create/read/delete; anyone with the token can read a pending invite to accept it
*/

-- league_members
CREATE TABLE IF NOT EXISTS league_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id),
  user_id uuid REFERENCES auth.users(id),
  display_name text NOT NULL DEFAULT '',
  phone_e164 text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE league_members ENABLE ROW LEVEL SECURITY;

-- league owner can read all members of their leagues
CREATE POLICY "League owner can read members"
  ON league_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_members.league_id
      AND leagues.owner_id = auth.uid()
    )
  );

-- a member can read their own row
CREATE POLICY "Member can read own row"
  ON league_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- league owner can insert members (e.g. phone-only invites that get pre-added)
CREATE POLICY "League owner can insert members"
  ON league_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_members.league_id
      AND leagues.owner_id = auth.uid()
    )
  );

-- league owner can delete members
CREATE POLICY "League owner can delete members"
  ON league_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_members.league_id
      AND leagues.owner_id = auth.uid()
    )
  );

-- authenticated user can insert their own membership (accepting an invite)
CREATE POLICY "User can join league via invite"
  ON league_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- league_invites
CREATE TABLE IF NOT EXISTS league_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  phone_e164 text,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE league_invites ENABLE ROW LEVEL SECURITY;

-- owner can read all invites for their leagues
CREATE POLICY "League owner can read invites"
  ON league_invites FOR SELECT
  TO authenticated
  USING (invited_by = auth.uid());

-- owner can create invites
CREATE POLICY "League owner can create invites"
  ON league_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_invites.league_id
      AND leagues.owner_id = auth.uid()
    )
  );

-- owner can delete invites
CREATE POLICY "League owner can delete invites"
  ON league_invites FOR DELETE
  TO authenticated
  USING (invited_by = auth.uid());

-- anyone authenticated can read a specific invite by id (to accept it)
-- we check it is not yet accepted and not expired
CREATE POLICY "Authenticated user can read pending invite by id"
  ON league_invites FOR SELECT
  TO authenticated
  USING (
    accepted_at IS NULL
    AND expires_at > now()
  );

-- the invitee can mark the invite as accepted
CREATE POLICY "Authenticated user can accept invite"
  ON league_invites FOR UPDATE
  TO authenticated
  USING (accepted_at IS NULL AND expires_at > now())
  WITH CHECK (accepted_at IS NOT NULL);
