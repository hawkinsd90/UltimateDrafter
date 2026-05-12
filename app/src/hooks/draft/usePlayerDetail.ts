import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { CURRENT_SEASON } from './draftTypes';

export type PlayerDetailRanking = {
  provider: string;
  scoring_format: string;
  overall_rank: number | null;
  position_rank: number | null;
  position_rank_label: string | null;
  fantasy_points: number | null;
  adp: number | null;
  auction_value: number | null;
  percent_owned: number | null;
};

export type PlayerSeasonStats = {
  season: number;
  stat_type: string;
  games: number | null;
  passing_yards: number | null;
  passing_tds: number | null;
  passing_ints: number | null;
  rushing_yards: number | null;
  rushing_tds: number | null;
  receptions: number | null;
  receiving_yards: number | null;
  receiving_tds: number | null;
  fumbles_lost: number | null;
  fg_made_0_39: number | null;
  fg_made_40_49: number | null;
  fg_made_50_plus: number | null;
  fg_missed: number | null;
  xp_made: number | null;
  xp_missed: number | null;
  sacks: number | null;
  def_interceptions: number | null;
  fumble_recoveries: number | null;
  def_tds: number | null;
  safeties: number | null;
  blocks: number | null;
};

export type PlayerDetail = {
  id: string;
  display_name: string;
  fantasy_position: string | null;
  nfl_position: string | null;
  status: string | null;
  injury_status: string | null;
  team_abbr: string | null;
  team_name: string | null;
  season_outlook: string | null;
  rankings: PlayerDetailRanking[];
  lastSeasonRanking: PlayerDetailRanking | null;
  stats: PlayerSeasonStats | null;
  boardRankingId: string | null;
  boardRank: number | null;
  draftPickRound: number | null;
  draftPickNumber: number | null;
  draftPickTeamName: string | null;
};

export type UsePlayerDetailReturn = {
  playerDetail: PlayerDetail | null;
  detailLoading: boolean;
  openPlayerDetail: (sportsPlayerId: string) => void;
  closePlayerDetail: () => void;
};

export function usePlayerDetail(
  draftId: string,
  userId: string | undefined,
  draftScoringRuleId: string | null,
): UsePlayerDetailReturn {
  const [playerDetail, setPlayerDetail] = useState<PlayerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openPlayerDetail = useCallback(async (sportsPlayerId: string) => {
    setDetailLoading(true);
    setPlayerDetail(null);

    const [playerRes, rankingsRes, lastSeasonRes, statsRes, pickRes, boardRes] = await Promise.all([
      // 1. Player base info + team
      supabase
        .from('nfl_draft_player_pool')
        .select('id, display_name, fantasy_position, position, status, injury_status, team_abbr, team_name')
        .eq('id', sportsPlayerId)
        .maybeSingle(),

      // 2. ESPN rankings (standard + ppr) for 2026
      supabase
        .from('player_rankings')
        .select('provider, scoring_format, overall_rank, position_rank, position_rank_label, fantasy_points, adp, auction_value, percent_owned')
        .eq('sports_player_id', sportsPlayerId)
        .eq('provider', 'espn')
        .eq('ranking_type', 'draft_rank')
        .eq('season', CURRENT_SEASON)
        .is('draft_scoring_rule_id', null),

      // 3. Last Season ranking (if scoring rule available)
      draftScoringRuleId
        ? supabase
            .from('player_rankings')
            .select('provider, scoring_format, overall_rank, position_rank, position_rank_label, fantasy_points, adp, auction_value, percent_owned')
            .eq('sports_player_id', sportsPlayerId)
            .eq('provider', 'manual')
            .eq('ranking_type', 'last_season_points')
            .eq('draft_scoring_rule_id', draftScoringRuleId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),

      // 4. 2025 regular season stats
      supabase
        .from('player_season_stats')
        .select('season, stat_type, games, passing_yards, passing_tds, passing_ints, rushing_yards, rushing_tds, receptions, receiving_yards, receiving_tds, fumbles_lost, fg_made_0_39, fg_made_40_49, fg_made_50_plus, fg_missed, xp_made, xp_missed, sacks, def_interceptions, fumble_recoveries, def_tds, safeties, blocks')
        .eq('sports_player_id', sportsPlayerId)
        .eq('season', 2025)
        .eq('stat_type', 'regular_season')
        .eq('provider', 'sleeper')
        .maybeSingle(),

      // 5. Draft pick for this player in this draft
      supabase
        .from('draft_picks')
        .select('pick_number, round_number, participant:draft_participants(team_name)')
        .eq('draft_id', draftId)
        .eq('player_id', sportsPlayerId)
        .maybeSingle(),

      // 6. Board ranking for this user/draft/player
      userId
        ? supabase
            .from('draft_board_rankings')
            .select('id, rank')
            .eq('draft_id', draftId)
            .eq('user_id', userId)
            .eq('sports_player_id', sportsPlayerId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const p = playerRes.data;
    if (!p) {
      setDetailLoading(false);
      return;
    }

    const rankings: PlayerDetailRanking[] = (rankingsRes.data ?? []).map(r => ({
      provider: r.provider,
      scoring_format: r.scoring_format,
      overall_rank: r.overall_rank,
      position_rank: r.position_rank,
      position_rank_label: r.position_rank_label,
      fantasy_points: r.fantasy_points != null ? Number(r.fantasy_points) : null,
      adp: r.adp != null ? Number(r.adp) : null,
      auction_value: r.auction_value != null ? Number(r.auction_value) : null,
      percent_owned: r.percent_owned != null ? Number(r.percent_owned) : null,
    }));

    const lsRaw = lastSeasonRes.data;
    const lastSeasonRanking: PlayerDetailRanking | null = lsRaw ? {
      provider: lsRaw.provider,
      scoring_format: lsRaw.scoring_format,
      overall_rank: lsRaw.overall_rank,
      position_rank: lsRaw.position_rank,
      position_rank_label: lsRaw.position_rank_label,
      fantasy_points: lsRaw.fantasy_points != null ? Number(lsRaw.fantasy_points) : null,
      adp: null,
      auction_value: null,
      percent_owned: null,
    } : null;

    const statsRaw = statsRes.data;
    const stats: PlayerSeasonStats | null = statsRaw ? {
      season: statsRaw.season,
      stat_type: statsRaw.stat_type,
      games: statsRaw.games != null ? Number(statsRaw.games) : null,
      passing_yards: statsRaw.passing_yards != null ? Number(statsRaw.passing_yards) : null,
      passing_tds: statsRaw.passing_tds != null ? Number(statsRaw.passing_tds) : null,
      passing_ints: statsRaw.passing_ints != null ? Number(statsRaw.passing_ints) : null,
      rushing_yards: statsRaw.rushing_yards != null ? Number(statsRaw.rushing_yards) : null,
      rushing_tds: statsRaw.rushing_tds != null ? Number(statsRaw.rushing_tds) : null,
      receptions: statsRaw.receptions != null ? Number(statsRaw.receptions) : null,
      receiving_yards: statsRaw.receiving_yards != null ? Number(statsRaw.receiving_yards) : null,
      receiving_tds: statsRaw.receiving_tds != null ? Number(statsRaw.receiving_tds) : null,
      fumbles_lost: statsRaw.fumbles_lost != null ? Number(statsRaw.fumbles_lost) : null,
      fg_made_0_39: statsRaw.fg_made_0_39 != null ? Number(statsRaw.fg_made_0_39) : null,
      fg_made_40_49: statsRaw.fg_made_40_49 != null ? Number(statsRaw.fg_made_40_49) : null,
      fg_made_50_plus: statsRaw.fg_made_50_plus != null ? Number(statsRaw.fg_made_50_plus) : null,
      fg_missed: statsRaw.fg_missed != null ? Number(statsRaw.fg_missed) : null,
      xp_made: statsRaw.xp_made != null ? Number(statsRaw.xp_made) : null,
      xp_missed: statsRaw.xp_missed != null ? Number(statsRaw.xp_missed) : null,
      sacks: statsRaw.sacks != null ? Number(statsRaw.sacks) : null,
      def_interceptions: statsRaw.def_interceptions != null ? Number(statsRaw.def_interceptions) : null,
      fumble_recoveries: statsRaw.fumble_recoveries != null ? Number(statsRaw.fumble_recoveries) : null,
      def_tds: statsRaw.def_tds != null ? Number(statsRaw.def_tds) : null,
      safeties: statsRaw.safeties != null ? Number(statsRaw.safeties) : null,
      blocks: statsRaw.blocks != null ? Number(statsRaw.blocks) : null,
    } : null;

    const pickRaw = pickRes.data as { pick_number: number | null; round_number: number | null; participant: { team_name: string | null } | null } | null;
    const boardRaw = boardRes.data as { id: string; rank: number } | null;

    setPlayerDetail({
      id: p.id,
      display_name: p.display_name,
      fantasy_position: p.fantasy_position,
      nfl_position: (p as { position?: string | null }).position ?? null,
      status: p.status,
      injury_status: p.injury_status,
      team_abbr: p.team_abbr,
      team_name: p.team_name,
      season_outlook: null,
      rankings,
      lastSeasonRanking,
      stats,
      boardRankingId: boardRaw?.id ?? null,
      boardRank: boardRaw?.rank ?? null,
      draftPickRound: pickRaw?.round_number ?? null,
      draftPickNumber: pickRaw?.pick_number ?? null,
      draftPickTeamName: pickRaw?.participant?.team_name ?? null,
    });

    setDetailLoading(false);
  }, [draftId, userId, draftScoringRuleId]);

  const closePlayerDetail = useCallback(() => {
    setPlayerDetail(null);
  }, []);

  return { playerDetail, detailLoading, openPlayerDetail, closePlayerDetail };
}
