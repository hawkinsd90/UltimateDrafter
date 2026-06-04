/*
  # Add roster limit columns to league_settings

  Moves the per-position max draft limits from draft_settings to league_settings
  so they can be configured at the league level and inherited by all drafts.

  ## Changes
  - `roster_limits_enabled` (boolean, default false) — whether position caps are active
  - `max_qb`, `max_rb`, `max_wr`, `max_te`, `max_k`, `max_dst` (nullable integers) — cap per position
*/

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS roster_limits_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_qb  integer,
  ADD COLUMN IF NOT EXISTS max_rb  integer,
  ADD COLUMN IF NOT EXISTS max_wr  integer,
  ADD COLUMN IF NOT EXISTS max_te  integer,
  ADD COLUMN IF NOT EXISTS max_k   integer,
  ADD COLUMN IF NOT EXISTS max_dst integer;
