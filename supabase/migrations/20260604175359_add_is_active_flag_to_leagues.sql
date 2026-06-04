/*
  # Add is_active flag to leagues

  ## Summary
  Adds a soft-delete mechanism to the leagues table. Rather than hard-deleting
  a league (which would cascade-destroy all drafts, members, and roster data),
  the league owner can mark a league inactive. Inactive leagues are hidden from
  the league list but all data is preserved.

  ## Changes

  ### leagues
  - New column: `is_active` (boolean, NOT NULL, DEFAULT true)
    - true  = active, visible in the league list
    - false = soft-deleted, hidden from the league list

  ## Notes
  - Existing rows all receive is_active = true via the DEFAULT.
  - No new RLS policy required: the existing "League owners can update their leagues"
    policy already allows the owner to update any column, including is_active.
  - No cascade behavior changes: setting is_active = false does not affect child rows.
*/

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
