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

export type BoardPlayer = {
  id: string;
  display_name: string;
  fantasy_position: string | null;
  position: string | null;
  status: string | null;
  injury_status: string | null;
  team_abbr: string | null;
  espn_rank: number | null;
  sleeper_rank: number | null;
  rank: number;
  rankingId: string | null;
};

export type AvailablePlayer = Omit<BoardPlayer, 'rank' | 'rankingId'>;

export type SortMode = 'name' | 'espn' | 'sleeper';
export type PositionFilter = 'All' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

export const POSITIONS: readonly PositionFilter[] = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;

export const INJURY_COLORS: Record<string, string> = {
  'Questionable': '#d97706',
  'Doubtful': '#dc2626',
  'Out': '#dc2626',
  'IR': '#9333ea',
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
