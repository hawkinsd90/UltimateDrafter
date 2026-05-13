/*
  # Add email and imported_member_id to league_invites

  ## Changes
  - `league_invites.email` (text, nullable) — lets the owner address an invite to a specific email
  - `league_invites.imported_member_id` (uuid, nullable, fk → league_imported_members.id) — pre-ties an
    invite link to a specific imported team so the join flow can auto-select it

  ## Notes
  - Both columns are optional; existing invite flows continue to work unchanged
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'league_invites' AND column_name = 'email'
  ) THEN
    ALTER TABLE league_invites ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'league_invites' AND column_name = 'imported_member_id'
  ) THEN
    ALTER TABLE league_invites ADD COLUMN imported_member_id uuid
      REFERENCES league_imported_members(id) ON DELETE SET NULL;
  END IF;
END $$;
