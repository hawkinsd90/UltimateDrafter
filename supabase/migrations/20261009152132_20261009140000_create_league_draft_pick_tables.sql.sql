/*
# Phase 3D: Create Draft Pick Trading Tables

## Overview
Creates three new tables to support future draft pick trading:
1. `league_draft_pick_assets` — durable ownership records for future draft picks
2. `league_trade_proposal_picks` — pick items included in trade proposals
3. `league_draft_pick_transactions` — audit log for pick ownership changes

## Tables

### `league_draft_pick_assets`
Durable record of who owns each future draft pick. Each row represents one
specific round of one specific future season originally belonging to one team.

- `id` (uuid, PK)
- `league_id` (uuid, FK → leagues, CASCADE)
- `season_year` (integer) — the year the pick applies to (e.g. 2027 for a 2027 draft)
- `round_number` (integer) — which round this pick represents
- `original_member_id` (uuid, FK → league_members, RESTRICT) — the team that originally owned this pick; never changes
- `current_member_id` (uuid, FK → league_members, RESTRICT) — the team that currently owns this pick; changes via accepted trades
- `status` (text) — 'available' or 'used'
- `used_draft_id` (uuid, FK → drafts, SET NULL) — set when a draft consumes this pick
- `used_at` (timestamptz) — when the pick was consumed
- `created_at`, `updated_at` (timestamptz)

Unique constraint: (league_id, season_year, round_number, original_member_id)
This prevents duplicate pick assets for the same team/season/round.

### `league_trade_proposal_picks`
Pick items included in a trade proposal. Each row references one pick asset
and records which direction it moves (send or receive). Snapshot fields
freeze the pick description at proposal time.

- `id` (uuid, PK)
- `trade_proposal_id` (uuid, FK → league_trade_proposals, CASCADE)
- `direction` (text) — 'send' or 'receive'
- `pick_asset_id` (uuid, FK → league_draft_pick_assets, RESTRICT)
- `snapshot_season_year` (integer)
- `snapshot_round_number` (integer)
- `snapshot_original_member_id` (uuid, FK → league_members, SET NULL)
- `snapshot_original_team_name` (text)
- `created_at` (timestamptz)

Unique: (trade_proposal_id, pick_asset_id) — a pick can only appear once per proposal.

### `league_draft_pick_transactions`
Audit log for every pick ownership change. Uses `trade_proposal_id` as the
grouping key so Recent Activity can display one combined event for mixed trades.

- `id` (uuid, PK)
- `league_id` (uuid, FK → leagues, CASCADE)
- `pick_asset_id` (uuid, FK → league_draft_pick_assets, RESTRICT)
- `trade_proposal_id` (uuid, FK → league_trade_proposals, SET NULL)
- `actor_user_id` (uuid, FK → auth.users, SET NULL)
- `from_member_id` (uuid, FK → league_members, SET NULL)
- `to_member_id` (uuid, FK → league_members, SET NULL)
- `season_year` (integer)
- `round_number` (integer)
- `metadata` (jsonb) — frozen pick label and team names
- `created_at` (timestamptz)

## Security
- RLS enabled on all three tables.
- SELECT: League members and league owner can read.
- No direct browser INSERT/UPDATE/DELETE — all mutations via SECURITY DEFINER RPCs.

## Indexes
- Pick assets: league_id, current_member_id, (league_id, season_year)
- Proposal picks: trade_proposal_id, pick_asset_id
- Pick transactions: league_id, trade_proposal_id
*/

-- ============================================================================
-- 1. league_draft_pick_assets
-- ============================================================================

CREATE TABLE IF NOT EXISTS league_draft_pick_assets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  league_id           uuid        NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  season_year         integer     NOT NULL,
  round_number        integer     NOT NULL,

  original_member_id  uuid        NOT NULL REFERENCES league_members(id) ON DELETE RESTRICT,
  current_member_id   uuid        NOT NULL REFERENCES league_members(id) ON DELETE RESTRICT,

  status              text        NOT NULL DEFAULT 'available'
                          CHECK (status IN ('available', 'used')),

  used_draft_id       uuid        REFERENCES drafts(id) ON DELETE SET NULL,
  used_at             timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (league_id, season_year, round_number, original_member_id)
);

CREATE INDEX IF NOT EXISTS idx_ldpa_league_id            ON league_draft_pick_assets(league_id);
CREATE INDEX IF NOT EXISTS idx_ldpa_current_member_id    ON league_draft_pick_assets(current_member_id);
CREATE INDEX IF NOT EXISTS idx_ldpa_league_season        ON league_draft_pick_assets(league_id, season_year);
CREATE INDEX IF NOT EXISTS idx_ldpa_league_current       ON league_draft_pick_assets(league_id, current_member_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_league_draft_pick_assets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_league_draft_pick_assets_updated_at ON league_draft_pick_assets;
CREATE TRIGGER trg_league_draft_pick_assets_updated_at
  BEFORE UPDATE ON league_draft_pick_assets
  FOR EACH ROW EXECUTE FUNCTION set_league_draft_pick_assets_updated_at();

ALTER TABLE league_draft_pick_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_league_draft_pick_assets" ON league_draft_pick_assets;
CREATE POLICY "select_league_draft_pick_assets"
  ON league_draft_pick_assets FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_draft_pick_assets.league_id
        AND lm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = league_draft_pick_assets.league_id
        AND l.owner_id = auth.uid()
    )
  );

-- ============================================================================
-- 2. league_trade_proposal_picks
-- ============================================================================

CREATE TABLE IF NOT EXISTS league_trade_proposal_picks (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  trade_proposal_id           uuid        NOT NULL
                                REFERENCES league_trade_proposals(id) ON DELETE CASCADE,

  direction                   text        NOT NULL
                                CHECK (direction IN ('send', 'receive')),

  pick_asset_id               uuid        NOT NULL
                                REFERENCES league_draft_pick_assets(id) ON DELETE RESTRICT,

  snapshot_season_year        integer     NOT NULL,
  snapshot_round_number       integer     NOT NULL,
  snapshot_original_member_id uuid        REFERENCES league_members(id) ON DELETE SET NULL,
  snapshot_original_team_name text,

  created_at                  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (trade_proposal_id, pick_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_ltppk_proposal_id   ON league_trade_proposal_picks(trade_proposal_id);
CREATE INDEX IF NOT EXISTS idx_ltppk_pick_asset_id ON league_trade_proposal_picks(pick_asset_id);

ALTER TABLE league_trade_proposal_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_league_trade_proposal_picks" ON league_trade_proposal_picks;
CREATE POLICY "select_league_trade_proposal_picks"
  ON league_trade_proposal_picks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_trade_proposals ltp
      JOIN league_members lm ON lm.league_id = ltp.league_id
      WHERE ltp.id = league_trade_proposal_picks.trade_proposal_id
        AND lm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM league_trade_proposals ltp
      JOIN leagues l ON l.id = ltp.league_id
      WHERE ltp.id = league_trade_proposal_picks.trade_proposal_id
        AND l.owner_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. league_draft_pick_transactions
-- ============================================================================

CREATE TABLE IF NOT EXISTS league_draft_pick_transactions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  league_id           uuid        NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  pick_asset_id       uuid        NOT NULL
                            REFERENCES league_draft_pick_assets(id) ON DELETE RESTRICT,

  trade_proposal_id   uuid        REFERENCES league_trade_proposals(id) ON DELETE SET NULL,

  actor_user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  from_member_id      uuid        REFERENCES league_members(id) ON DELETE SET NULL,
  to_member_id        uuid        REFERENCES league_members(id) ON DELETE SET NULL,

  season_year         integer     NOT NULL,
  round_number        integer     NOT NULL,

  metadata            jsonb       NOT NULL DEFAULT '{}',

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ldpt_league_id          ON league_draft_pick_transactions(league_id);
CREATE INDEX IF NOT EXISTS idx_ldpt_trade_proposal_id  ON league_draft_pick_transactions(trade_proposal_id);
CREATE INDEX IF NOT EXISTS idx_ldpt_created_at         ON league_draft_pick_transactions(created_at DESC);

ALTER TABLE league_draft_pick_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_league_draft_pick_transactions" ON league_draft_pick_transactions;
CREATE POLICY "select_league_draft_pick_transactions"
  ON league_draft_pick_transactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_draft_pick_transactions.league_id
        AND lm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM leagues l
      WHERE l.id = league_draft_pick_transactions.league_id
        AND l.owner_id = auth.uid()
    )
  );
