import type { Database } from '../../types/supabase';

export type Draft = Database['public']['Tables']['drafts']['Row'];
export type League = Database['public']['Tables']['leagues']['Row'];
export type DraftSettings = Database['public']['Tables']['draft_settings']['Row'];
export type Participant = Database['public']['Tables']['draft_participants']['Row'];

export type Pick = Database['public']['Tables']['draft_picks']['Row'] & {
  player?: {
    display_name: string;
    fantasy_position: string | null;
    position: string | null;
    team: { abbreviation: string | null } | null;
  } | null;
};

export type FilterMode = 'all' | 'round' | 'owner';
export type TabId = 'overview' | 'myboard';

// ── Ranking system types ─────────────────────────────────────────────────────

export type RankingSource = 'sleeper' | 'espn' | 'fantasypros' | 'last_season';
// 'custom' is the DB value for league-specific last_season_points rows
export type ScoringFormat = 'any' | 'standard' | 'half_ppr' | 'ppr' | 'custom';
export type SortByMode = 'name' | 'overall_rank' | 'position_rank' | 'fantasy_points' | 'adp' | 'relevance';

// Maps RankingSource → the player_rankings.provider value used in DB
export const PROVIDER_MAP: Record<RankingSource, string> = {
  sleeper:      'sleeper',
  espn:         'espn',
  fantasypros:  'fantasypros',
  last_season:  'manual',
};

// Maps RankingSource → the player_rankings.ranking_type value used in DB
export const RANKING_TYPE_MAP: Record<RankingSource, string> = {
  sleeper:      'search_rank',
  espn:         'draft_rank',
  fantasypros:  'ecr',
  last_season:  'last_season_points',
};

// Default scoring format per source (some sources are always format-agnostic)
export const DEFAULT_SCORING_FORMAT: Record<RankingSource, ScoringFormat> = {
  sleeper:      'any',
  espn:         'ppr',
  fantasypros:  'ppr',
  last_season:  'custom',
};

// Which scoring formats are valid for each source
export const VALID_SCORING_FORMATS: Record<RankingSource, ScoringFormat[]> = {
  sleeper:      ['any'],
  espn:         ['standard', 'half_ppr', 'ppr'],
  fantasypros:  ['standard', 'half_ppr', 'ppr'],
  last_season:  ['custom'],
};

// Which scoring formats actually have synced data (subset of VALID_SCORING_FORMATS)
export const SYNCED_SCORING_FORMATS: Record<RankingSource, ScoringFormat[]> = {
  sleeper:      ['any'],
  espn:         ['standard', 'ppr'],
  fantasypros:  [],
  last_season:  ['custom'],
};

// Which sort modes are valid for each source
export const VALID_SORT_MODES: Record<RankingSource, SortByMode[]> = {
  sleeper:      ['name', 'relevance', 'position_rank'],
  espn:         ['name', 'overall_rank', 'position_rank', 'adp'],
  fantasypros:  ['name', 'overall_rank', 'position_rank', 'adp'],
  last_season:  ['name', 'fantasy_points', 'overall_rank', 'position_rank'],
};

export const RANKING_SOURCE_LABELS: Record<RankingSource, string> = {
  sleeper:      'Sleeper',
  espn:         'ESPN',
  fantasypros:  'FantasyPros',
  last_season:  'Last Season',
};

export const SCORING_FORMAT_LABELS: Record<ScoringFormat, string> = {
  any:      'Any',
  standard: 'Standard',
  half_ppr: 'Half PPR',
  ppr:      'PPR',
  custom:   'League Rules',
};

export const SORT_BY_LABELS: Record<SortByMode, string> = {
  name:           'Name',
  overall_rank:   'Overall',
  position_rank:  'Position',
  fantasy_points: 'Points',
  adp:            'ADP',
  relevance:      'Relevance',
};

// Current NFL season (used as default for ranking queries)
export const CURRENT_SEASON = 2026;

// ── Player types ─────────────────────────────────────────────────────────────

export type BoardPlayer = {
  id: string;
  display_name: string;
  fantasy_position: string | null;
  nfl_position: string | null;
  status: string | null;
  injury_status: string | null;
  team_abbr: string | null;
  overall_rank: number | null;
  position_rank: number | null;
  position_rank_label: string | null;
  fantasy_points: number | null;
  adp: number | null;
  ranking_source_label: string | null;
  rank: number;
  rankingId: string | null;
};

export type AvailablePlayer = Omit<BoardPlayer, 'rank' | 'rankingId'> & {
  percent_owned: number | null;
  trend_count: number | null;
};

// Legacy aliases kept for components not yet updated
export type SortMode = SortByMode;

export type PositionFilter = 'All' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

export const POSITIONS: readonly PositionFilter[] = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;

export const RANKING_SOURCES: readonly RankingSource[] = ['sleeper', 'espn', 'fantasypros', 'last_season'] as const;

export const INJURY_COLORS: Record<string, string> = {
  'Questionable': '#d97706',
  'Doubtful':     '#dc2626',
  'Out':          '#dc2626',
  'IR':           '#7c3aed',
};

// ── Design tokens (shared across draft components) ───────────────────────────
export const dt = {
  bg:            '#0f172a',
  card:          '#1e293b',
  cardInner:     '#0f172a',
  border:        '#334155',
  textPrimary:   '#f1f5f9',
  textSecondary: '#94a3b8',
  green:         '#22c55e',
  greenDark:     '#16a34a',
  blue:          '#3b82f6',
  amber:         '#f59e0b',
} as const;
