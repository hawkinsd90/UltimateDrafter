/*
  # Add Rookie Draft Support

  ## Changes

  ### 1. drafts table
  - Drop old draft_type check constraint (snake/linear/auction)
  - Add 'rookie' as a valid draft_type value

  ### 2. draft_settings table
  - Add `num_rounds` column (integer, nullable)
    - NULL means "use roster slot sum" (existing behaviour for snake/linear)
    - 1-4 for rookie drafts (overrides roster sum for pick counting)
  - Add `draft_type` column (text, nullable) so draft_settings can be
    queried independently for draft type without joining drafts

  ### Notes
  - Existing drafts are unaffected; num_rounds defaults to NULL
  - Rookie draft pool is filtered by years_exp = 0 at query time (no
    schema change needed — years_exp is already in sports_players)
*/

-- 1. Update drafts.draft_type constraint to include 'rookie'
DO $$
BEGIN
  -- Drop the existing check constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.drafts'::regclass
      AND conname = 'drafts_draft_type_check'
  ) THEN
    ALTER TABLE public.drafts DROP CONSTRAINT drafts_draft_type_check;
  END IF;
END $$;

ALTER TABLE public.drafts
  ADD CONSTRAINT drafts_draft_type_check
  CHECK (draft_type IN ('snake', 'linear', 'auction', 'rookie'));

-- 2. Add num_rounds to draft_settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'draft_settings' AND column_name = 'num_rounds' AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.draft_settings ADD COLUMN num_rounds integer;
  END IF;
END $$;

-- 3. Add draft_type mirror column to draft_settings for convenience
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'draft_settings' AND column_name = 'draft_type' AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.draft_settings ADD COLUMN draft_type text;
  END IF;
END $$;
