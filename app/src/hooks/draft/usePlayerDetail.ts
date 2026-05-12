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
  // Bio fields
  headshot_url: string | null;
  years_exp: number | null;
  college: string | null;
  jersey_number: string | null;
  // Rankings
  rankings: PlayerDetailRanking[];
  sleeperRanking: PlayerDetailRanking | null;
  lastSeasonRanking: PlayerDetailRanking | null;
  // Stats
  stats: PlayerSeasonStats | null;
  // Board / draft state
  boardRankingId: string | null;
  boardRank: number | null;
  draftPickRound: number | null;
  draftPickInRound: number | null;
  draftPickNumber: number | null;
  draftPickTeamName: string | null;
};

export type UsePlayerDetailReturn = {
  playerDetail: PlayerDetail | null;
  detailLoading: boolean;
  openPlayerDetail: (sportsPlayerId: string) => void;
  closePlayerDetail: () => void;
};

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

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

    const [playerRes, bioRes, rankingsRes, sleeperRankRes, lastSeasonRes, statsRes, pickRes, boardRes] = await Promise.all([
      // 1. Base info from the view (team_name, headshot_url, years_exp already exposed)
      supabase
        .from('nfl_draft_player_pool')
        .select('id, display_name, fantasy_position, position, status, injury_status, team_abbr, team_name, headshot_url, years_exp')
        .eq('id', sportsPlayerId)
        .maybeSingle(),

      // 2. Bio fields not in the view (college, jersey_number) from sports_players directly
      supabase
        .from('sports_players')
        .select('college, jersey_number')
        .eq('id', sportsPlayerId)
        .maybeSingle(),

      // 3. ESPN rankings (standard + ppr) for current season
      supabase
        .from('player_rankings')
        .select('provider, scoring_format, overall_rank, position_rank, position_rank_label, fantasy_points, adp, auction_value, percent_owned')
        .eq('sports_player_id', sportsPlayerId)
        .eq('provider', 'espn')
        .eq('ranking_type', 'draft_rank')
        .eq('season', CURRENT_SEASON)
        .is('draft_scoring_rule_id', null),

      // 4. Sleeper search rank
      supabase
        .from('player_rankings')
        .select('provider, scoring_format, overall_rank, position_rank, position_rank_label, fantasy_points, adp, auction_value, percent_owned')
        .eq('sports_player_id', sportsPlayerId)
        .eq('provider', 'sleeper')
        .eq('ranking_type', 'search_rank')
        .eq('season', CURRENT_SEASON)
        .eq('scoring_format', 'any')
        .is('draft_scoring_rule_id', null)
        .maybeSingle(),

      // 5. Last Season ranking (only if a scoring rule is attached to this draft)
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

      // 6. 2025 regular season stats (Sleeper is the stats provider)
      supabase
        .from('player_season_stats')
        .select('season, stat_type, games, passing_yards, passing_tds, passing_ints, rushing_yards, rushing_tds, receptions, receiving_yards, receiving_tds, fumbles_lost, fg_made_0_39, fg_made_40_49, fg_made_50_plus, fg_missed, xp_made, xp_missed, sacks, def_interceptions, fumble_recoveries, def_tds, safeties, blocks')
        .eq('sports_player_id', sportsPlayerId)
        .eq('season', 2025)
        .eq('stat_type', 'regular_season')
        .eq('provider', 'sleeper')
        .maybeSingle(),

      // 7. Draft pick for this player in this draft
      // Columns: pick_number (overall), round, pick_in_round
      supabase
        .from('draft_picks')
        .select('pick_number, round, pick_in_round, participant:draft_participants(team_name)')
        .eq('draft_id', draftId)
        .eq('player_id', sportsPlayerId)
        .maybeSingle(),

      // 8. Board ranking for current user/draft/player
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

    // Log non-critical errors without blocking the modal
    if (playerRes.error)      console.warn('[usePlayerDetail] playerRes:', playerRes.error.message);
    if (bioRes.error)         console.warn('[usePlayerDetail] bioRes:', bioRes.error.message);
    if (rankingsRes.error)    console.warn('[usePlayerDetail] rankingsRes:', rankingsRes.error.message);
    if (sleeperRankRes.error) console.warn('[usePlayerDetail] sleeperRankRes:', sleeperRankRes.error.message);
    if (lastSeasonRes.error)  console.warn('[usePlayerDetail] lastSeasonRes:', lastSeasonRes.error.message);
    if (statsRes.error)       console.warn('[usePlayerDetail] statsRes:', statsRes.error.message);
    if (pickRes.error)        console.warn('[usePlayerDetail] pickRes:', pickRes.error.message);
    if (boardRes.error)       console.warn('[usePlayerDetail] boardRes:', boardRes.error.message);

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
      fantasy_points: toNum(r.fantasy_points),
      adp: toNum(r.adp),
      auction_value: toNum(r.auction_value),
      percent_owned: toNum(r.percent_owned),
    }));

    const srRaw = sleeperRankRes.data;
    const sleeperRanking: PlayerDetailRanking | null = srRaw ? {
      provider: srRaw.provider,
      scoring_format: srRaw.scoring_format,
      overall_rank: srRaw.overall_rank,
      position_rank: srRaw.position_rank,
      position_rank_label: srRaw.position_rank_label,
      fantasy_points: toNum(srRaw.fantasy_points),
      adp: toNum(srRaw.adp),
      auction_value: null,
      percent_owned: toNum(srRaw.percent_owned),
    } : null;

    const lsRaw = lastSeasonRes.data;
    const lastSeasonRanking: PlayerDetailRanking | null = lsRaw ? {
      provider: lsRaw.provider,
      scoring_format: lsRaw.scoring_format,
      overall_rank: lsRaw.overall_rank,
      position_rank: lsRaw.position_rank,
      position_rank_label: lsRaw.position_rank_label,
      fantasy_points: toNum(lsRaw.fantasy_points),
      adp: null,
      auction_value: null,
      percent_owned: null,
    } : null;

    const statsRaw = statsRes.data;
    const stats: PlayerSeasonStats | null = statsRaw ? {
      season: statsRaw.season,
      stat_type: statsRaw.stat_type,
      games: toNum(statsRaw.games),
      passing_yards: toNum(statsRaw.passing_yards),
      passing_tds: toNum(statsRaw.passing_tds),
      passing_ints: toNum(statsRaw.passing_ints),
      rushing_yards: toNum(statsRaw.rushing_yards),
      rushing_tds: toNum(statsRaw.rushing_tds),
      receptions: toNum(statsRaw.receptions),
      receiving_yards: toNum(statsRaw.receiving_yards),
      receiving_tds: toNum(statsRaw.receiving_tds),
      fumbles_lost: toNum(statsRaw.fumbles_lost),
      fg_made_0_39: toNum(statsRaw.fg_made_0_39),
      fg_made_40_49: toNum(statsRaw.fg_made_40_49),
      fg_made_50_plus: toNum(statsRaw.fg_made_50_plus),
      fg_missed: toNum(statsRaw.fg_missed),
      xp_made: toNum(statsRaw.xp_made),
      xp_missed: toNum(statsRaw.xp_missed),
      sacks: toNum(statsRaw.sacks),
      def_interceptions: toNum(statsRaw.def_interceptions),
      fumble_recoveries: toNum(statsRaw.fumble_recoveries),
      def_tds: toNum(statsRaw.def_tds),
      safeties: toNum(statsRaw.safeties),
      blocks: toNum(statsRaw.blocks),
    } : null;

    type PickRaw = {
      pick_number: number | null;
      round: number | null;
      pick_in_round: number | null;
      participant: { team_name: string | null } | null;
    } | null;
    const pickRaw = pickRes.data as PickRaw;
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
      headshot_url: p.headshot_url ?? null,
      years_exp: p.years_exp ?? null,
      college: bioRes.data?.college ?? null,
      jersey_number: bioRes.data?.jersey_number ?? null,
      rankings,
      sleeperRanking,
      lastSeasonRanking,
      stats,
      boardRankingId: boardRaw?.id ?? null,
      boardRank: boardRaw?.rank ?? null,
      draftPickRound: pickRaw?.round ?? null,
      draftPickInRound: pickRaw?.pick_in_round ?? null,
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
