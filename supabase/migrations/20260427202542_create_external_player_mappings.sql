/*
  # External Player Mappings — Platform-Wide Reusable Cache

  ## Purpose
  Maps a provider's native player ID to our canonical sports_players record.
  This table is provider-scoped (unique per provider + external_player_id),
  so ESPN and Sleeper mappings are isolated from each other.

  Once a mapping exists, all future imports for the same provider+player ID
  reuse it automatically — including manual resolutions made by any commissioner.

  ## New Table: external_player_mappings

  - provider + external_player_id: unique composite key
  - mapping_method tracks how the match was made (auto_id, auto_name, fuzzy, manual)
  - confidence is 0.000–1.000 for auto methods; NULL for manual
  - created_by identifies the user who created the mapping (required for manual accountability)
  - updated_at maintained by trigger

  ## Security
  - RLS enabled; policies follow in a subsequent migration.
*/

CREATE TABLE IF NOT EXISTS external_player_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text NOT NULL CHECK (provider IN ('espn', 'sleeper')),
  external_player_id    text NOT NULL,

  -- Canonical reference. Cascade-delete mapping if the player is removed.
  sports_player_id      uuid NOT NULL REFERENCES sports_players(id) ON DELETE CASCADE,

  -- Provider's representation at time of mapping (informational, no credentials)
  external_player_name  text,
  external_position     text,
  external_team         text,

  -- How the match was established
  mapping_method        text NOT NULL DEFAULT 'auto_id'
                          CHECK (mapping_method IN (
                            'auto_id',    -- matched via provider_player_id in sports_players
                            'auto_name',  -- matched via display_name + position
                            'fuzzy',      -- matched via trigram/levenshtein similarity
                            'manual'      -- commissioner explicitly confirmed
                          )),

  -- 0.000–1.000 for auto methods; NULL for manual confirmations
  confidence            numeric(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  -- Required: identifies who created or last confirmed this mapping
  created_by            uuid NOT NULL REFERENCES auth.users(id),

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),

  -- One mapping per provider player ID — ESPN and Sleeper are isolated
  UNIQUE (provider, external_player_id)
);

CREATE TRIGGER trg_external_player_mappings_updated_at
  BEFORE UPDATE ON external_player_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_external_player_mappings_provider_player
  ON external_player_mappings(provider, external_player_id);

CREATE INDEX IF NOT EXISTS idx_external_player_mappings_sports_player_id
  ON external_player_mappings(sports_player_id);

ALTER TABLE external_player_mappings ENABLE ROW LEVEL SECURITY;
