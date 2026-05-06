import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  BoardPlayer, AvailablePlayer, PositionFilter,
  RankingSource, ScoringFormat, SortByMode,
} from './draftTypes';
import {
  PROVIDER_MAP, RANKING_TYPE_MAP, DEFAULT_SCORING_FORMAT,
  VALID_SCORING_FORMATS, VALID_SORT_MODES, CURRENT_SEASON,
} from './draftTypes';

export interface UseMyDraftBoardReturn {
  boardPlayers: BoardPlayer[];
  boardLoading: boolean;
  boardSearch: string;
  setBoardSearch: (v: string) => void;
  boardPositionFilter: PositionFilter;
  setBoardPositionFilter: (v: PositionFilter) => void;
  rankingSource: RankingSource;
  setRankingSource: (v: RankingSource) => void;
  scoringFormat: ScoringFormat;
  setScoringFormat: (v: ScoringFormat) => void;
  sortByMode: SortByMode;
  setSortByMode: (v: SortByMode) => void;
  boardAvailablePlayers: AvailablePlayer[];
  boardAvailableLoading: boolean;
  rankingDataAvailable: boolean;
  showBoardSearch: boolean;
  addAllLoading: boolean;
  addAllError: string | null;
  reorderError: string | null;
  draftScoringRuleId: string | null;
  lastSeasonRankingsAvailable: boolean;
  loadBoardRankings: () => Promise<void>;
  addPlayerToBoard: (playerId: string) => Promise<void>;
  addAllAvailableToBoard: () => Promise<void>;
  removePlayerFromBoard: (rankingId: string) => Promise<void>;
  removeAllFromBoard: () => Promise<void>;
  reorderBoard: (fromIndex: number, toIndex: number) => Promise<void>;
}

// RPC return row shape (must match the RETURNS TABLE in the migration)
type RpcRow = {
  id: string;
  pool_provider: string;
  provider_player_id: string;
  display_name: string;
  nfl_position: string | null;
  fantasy_position: string | null;
  status: string | null;
  injury_status: string | null;
  team_abbr: string | null;
  team_name: string | null;
  headshot_url: string | null;
  years_exp: number | null;
  overall_rank: number | null;
  position_rank: number | null;
  position_rank_label: string | null;
  fantasy_points: number | null;
  adp: number | null;
  auction_value: number | null;
  percent_owned: number | null;
  trend_count: number | null;
  ranking_source_label: string | null;
  has_ranking_data: boolean;
};

function rpcRowToAvailablePlayer(row: RpcRow): AvailablePlayer {
  return {
    id:                   row.id,
    display_name:         row.display_name,
    fantasy_position:     row.fantasy_position,
    nfl_position:         row.nfl_position,
    status:               row.status,
    injury_status:        row.injury_status,
    team_abbr:            row.team_abbr,
    overall_rank:         row.overall_rank,
    position_rank:        row.position_rank,
    position_rank_label:  row.position_rank_label,
    fantasy_points:       row.fantasy_points,
    adp:                  row.adp,
    ranking_source_label: row.ranking_source_label,
  };
}

export function useMyDraftBoard(
  draftId: string,
  userId: string | undefined,
  isMyBoardActive: boolean,
  picksLength: number,
): UseMyDraftBoardReturn {
  const [boardPlayers, setBoardPlayers] = useState<BoardPlayer[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const [boardPositionFilter, setBoardPositionFilter] = useState<PositionFilter>('All');

  const [rankingSource, setRankingSourceState] = useState<RankingSource>('sleeper');
  const [scoringFormat, setScoringFormatState] = useState<ScoringFormat>('any');
  const [sortByMode, setSortByModeState] = useState<SortByMode>('relevance');

  const [boardAvailablePlayers, setBoardAvailablePlayers] = useState<AvailablePlayer[]>([]);
  const [boardAvailableLoading, setBoardAvailableLoading] = useState(false);
  const [rankingDataAvailable, setRankingDataAvailable] = useState(true);
  const [addAllLoading, setAddAllLoading] = useState(false);
  const [addAllError, setAddAllError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // Scoring rule ID for this draft (populated from draft_scoring_rules table)
  const [draftScoringRuleId, setDraftScoringRuleId] = useState<string | null>(null);
  // True when last_season_points rows exist for this draft's scoring rule
  const [lastSeasonRankingsAvailable, setLastSeasonRankingsAvailable] = useState(false);

  const boardDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picksCountRef = useRef<number>(-1);
  const boardPlayersRef = useRef<BoardPlayer[]>([]);
  boardPlayersRef.current = boardPlayers;

  // Load draft scoring rule ID once per draftId
  useEffect(() => {
    if (!draftId) return;
    async function loadScoringRule() {
      const { data } = await supabase
        .from('draft_scoring_rules')
        .select('id')
        .eq('draft_id', draftId)
        .maybeSingle();
      const ruleId = data?.id ?? null;
      setDraftScoringRuleId(ruleId);

      if (ruleId) {
        const { count } = await supabase
          .from('player_rankings')
          .select('id', { count: 'exact', head: true })
          .eq('draft_scoring_rule_id', ruleId)
          .eq('ranking_type', 'last_season_points');
        setLastSeasonRankingsAvailable((count ?? 0) > 0);
      } else {
        setLastSeasonRankingsAvailable(false);
      }
    }
    loadScoringRule();
  }, [draftId]);

  // When source changes, snap scoring format and sort mode to valid defaults
  function setRankingSource(source: RankingSource) {
    setRankingSourceState(source);
    const validFormats = VALID_SCORING_FORMATS[source];
    const defaultFormat = DEFAULT_SCORING_FORMAT[source];
    setScoringFormatState(validFormats.includes(scoringFormat) ? scoringFormat : defaultFormat);
    const validSorts = VALID_SORT_MODES[source];
    const defaultSort = validSorts[1] ?? validSorts[0]; // prefer first non-name option
    setSortByModeState(validSorts.includes(sortByMode) ? sortByMode : defaultSort);
  }

  function setScoringFormat(fmt: ScoringFormat) {
    setScoringFormatState(fmt);
  }

  function setSortByMode(mode: SortByMode) {
    setSortByModeState(mode);
  }

  // Reload rankings when tab becomes active or picks change
  useEffect(() => {
    if (!isMyBoardActive || !userId) return;
    const newCount = picksLength;
    if (newCount !== picksCountRef.current) {
      picksCountRef.current = newCount;
      loadBoardRankings();
    }
  }, [picksLength, isMyBoardActive, draftId, userId]);

  // Debounced search when filter/search/sort/source changes
  useEffect(() => {
    if (!isMyBoardActive) return;
    if (boardDebounceRef.current) clearTimeout(boardDebounceRef.current);
    boardDebounceRef.current = setTimeout(() => {
      searchAvailablePlayers();
    }, 250);
    return () => {
      if (boardDebounceRef.current) clearTimeout(boardDebounceRef.current);
    };
  }, [boardSearch, boardPositionFilter, rankingSource, scoringFormat, sortByMode, isMyBoardActive]);

  async function loadBoardRankings() {
    if (!userId || !draftId) return;
    setBoardLoading(true);

    const { data: rankings } = await supabase
      .from('draft_board_rankings')
      .select('id, sports_player_id, rank')
      .eq('draft_id', draftId)
      .eq('user_id', userId)
      .order('rank', { ascending: true });

    if (!rankings || rankings.length === 0) {
      setBoardPlayers([]);
      setBoardLoading(false);
      return;
    }

    const playerIds = rankings.map(r => r.sports_player_id);
    const { data: players } = await supabase
      .from('nfl_draft_player_pool')
      .select('id, display_name, fantasy_position, position, status, injury_status, team_abbr')
      .in('id', playerIds);

    const playerMap = new Map((players ?? []).map(p => [p.id, p]));
    const merged: BoardPlayer[] = [];
    for (const r of rankings) {
      const p = playerMap.get(r.sports_player_id);
      if (!p) continue;
      merged.push({
        id:                   p.id,
        display_name:         p.display_name,
        fantasy_position:     p.fantasy_position,
        nfl_position:         p.position ?? null,
        status:               p.status,
        injury_status:        p.injury_status,
        team_abbr:            p.team_abbr,
        overall_rank:         null,
        position_rank:        null,
        position_rank_label:  null,
        fantasy_points:       null,
        adp:                  null,
        ranking_source_label: null,
        rank:                 r.rank,
        rankingId:            r.id,
      });
    }

    setBoardPlayers(merged);
    setBoardLoading(false);
  }

  async function searchAvailablePlayers() {
    if (!isMyBoardActive) return;

    // 1-char search: clear results and wait for more input (matches old behavior)
    if (boardSearch.length === 1) {
      setBoardAvailablePlayers([]);
      setBoardAvailableLoading(false);
      return;
    }

    setBoardAvailableLoading(true);

    const isLastSeason = rankingSource === 'last_season';
    const { data, error } = await supabase.rpc('get_draft_player_pool_with_rankings', {
      p_provider:              PROVIDER_MAP[rankingSource],
      p_scoring_format:        scoringFormat,
      p_season:                isLastSeason ? 2025 : CURRENT_SEASON,
      p_ranking_type:          RANKING_TYPE_MAP[rankingSource],
      p_position:              boardPositionFilter !== 'All' ? boardPositionFilter : null,
      p_search:                boardSearch.length >= 2 ? boardSearch : null,
      p_sort_mode:             sortByMode,
      p_limit:                 100,
      p_offset:                0,
      p_draft_scoring_rule_id: isLastSeason ? draftScoringRuleId : null,
    });

    if (error) {
      console.error('[searchAvailablePlayers]', error.message);
      setBoardAvailableLoading(false);
      return;
    }

    const rows = (data ?? []) as RpcRow[];
    setRankingDataAvailable(rows.some(r => r.has_ranking_data));
    setBoardAvailablePlayers(rows.map(rpcRowToAvailablePlayer));
    setBoardAvailableLoading(false);
  }

  async function addPlayerToBoard(playerId: string) {
    if (!userId || !draftId) return;
    const current = boardPlayersRef.current;
    const nextRank = current.length > 0 ? Math.max(...current.map(p => p.rank)) + 1 : 1;

    const { error: insertError } = await supabase
      .from('draft_board_rankings')
      .insert({ draft_id: draftId, user_id: userId, sports_player_id: playerId, rank: nextRank });

    if (!insertError) {
      await loadBoardRankings();
    }
  }

  async function addAllAvailableToBoard() {
    if (!userId || !draftId) return;
    if (addAllLoading) return;

    setAddAllLoading(true);
    setAddAllError(null);

    try {
      // Fetch current picks and boarded IDs fresh to avoid stale state
      const [picksRes, boardedRes] = await Promise.all([
        supabase.from('draft_picks').select('player_id').eq('draft_id', draftId).not('player_id', 'is', null),
        supabase.from('draft_board_rankings').select('sports_player_id, rank').eq('draft_id', draftId).eq('user_id', userId),
      ]);

      if (picksRes.error) {
        const msg = `Failed to load draft picks: ${picksRes.error.message}`;
        console.error('[addAllAvailableToBoard]', msg);
        setAddAllError(msg);
        return;
      }
      if (boardedRes.error) {
        const msg = `Failed to load board rankings: ${boardedRes.error.message}`;
        console.error('[addAllAvailableToBoard]', msg);
        setAddAllError(msg);
        return;
      }

      const pickedSet  = new Set((picksRes.data  ?? []).map(p => p.player_id as string));
      const boardedSet = new Set((boardedRes.data ?? []).map(r => r.sports_player_id as string));
      const currentMaxRank = (boardedRes.data ?? []).reduce((max, r) => Math.max(max, r.rank), 0);

      // Paginate through entire pool via RPC in the selected sort order
      // Search text is intentionally ignored for Add All (per spec)
      const isLastSeason = rankingSource === 'last_season';
      const PAGE_SIZE = 1000;
      const allPlayers: { id: string }[] = [];
      let offset = 0;

      while (true) {
        const { data: page, error: pageError } = await supabase.rpc('get_draft_player_pool_with_rankings', {
          p_provider:              PROVIDER_MAP[rankingSource],
          p_scoring_format:        scoringFormat,
          p_season:                isLastSeason ? 2025 : CURRENT_SEASON,
          p_ranking_type:          RANKING_TYPE_MAP[rankingSource],
          p_position:              boardPositionFilter !== 'All' ? boardPositionFilter : null,
          p_search:                null,
          p_sort_mode:             sortByMode,
          p_limit:                 PAGE_SIZE,
          p_offset:                offset,
          p_draft_scoring_rule_id: isLastSeason ? draftScoringRuleId : null,
        });

        if (pageError) {
          const msg = `Failed to load player pool (offset ${offset}): ${pageError.message}`;
          console.error('[addAllAvailableToBoard]', msg);
          setAddAllError(msg);
          return;
        }
        if (!page || page.length === 0) break;
        allPlayers.push(...(page as RpcRow[]).map(r => ({ id: r.id })));
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      // Filter to only eligible players
      const toAdd = allPlayers.filter(p => !pickedSet.has(p.id) && !boardedSet.has(p.id));
      if (toAdd.length === 0) return;

      // Batch-upsert 500 rows at a time, preserving sort order via rank assignment
      const BATCH_SIZE = 500;
      for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
        const batch = toAdd.slice(i, i + BATCH_SIZE);
        const rows = batch.map((p, j) => ({
          draft_id:         draftId,
          user_id:          userId!,
          sports_player_id: p.id,
          rank:             currentMaxRank + i + j + 1,
        }));
        const { error: upsertError } = await supabase
          .from('draft_board_rankings')
          .upsert(rows, { onConflict: 'draft_id,user_id,sports_player_id', ignoreDuplicates: true });

        if (upsertError) {
          const msg = `Failed to save players (batch ${i / BATCH_SIZE + 1}): ${upsertError.message}`;
          console.error('[addAllAvailableToBoard]', msg);
          setAddAllError(msg);
          return;
        }
      }

      await loadBoardRankings();
    } finally {
      setAddAllLoading(false);
    }
  }

  async function removePlayerFromBoard(rankingId: string) {
    await supabase.from('draft_board_rankings').delete().eq('id', rankingId);
    await loadBoardRankings();
  }

  async function removeAllFromBoard() {
    if (!userId || !draftId) return;
    await supabase.from('draft_board_rankings').delete().eq('draft_id', draftId).eq('user_id', userId);
    setBoardPlayers([]);
  }

  async function reorderBoard(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setReorderError(null);

    const current = boardPlayersRef.current;
    const updated = [...current];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);

    const reranked = updated.map((p, i) => ({ ...p, rank: i + 1 }));
    setBoardPlayers(reranked);

    const payload = reranked
      .filter(p => p.rankingId !== null)
      .map(p => ({ id: p.rankingId as string, rank: p.rank }));

    const { error } = await supabase.rpc('reorder_draft_board_rankings', {
      p_draft_id:  draftId,
      p_rankings:  payload,
    });

    if (error) {
      const msg = `Reorder failed: ${error.message}`;
      console.error('[reorderBoard]', msg);
      setReorderError(msg);
      await loadBoardRankings();
    }
  }

  const showBoardSearch = boardSearch.length >= 2 || boardPositionFilter !== 'All';

  return {
    boardPlayers, boardLoading,
    boardSearch, setBoardSearch,
    boardPositionFilter, setBoardPositionFilter,
    rankingSource, setRankingSource,
    scoringFormat, setScoringFormat,
    sortByMode, setSortByMode,
    boardAvailablePlayers, boardAvailableLoading,
    rankingDataAvailable,
    showBoardSearch,
    addAllLoading,
    addAllError,
    reorderError,
    draftScoringRuleId,
    lastSeasonRankingsAvailable,
    loadBoardRankings,
    addPlayerToBoard,
    addAllAvailableToBoard,
    removePlayerFromBoard,
    removeAllFromBoard,
    reorderBoard,
  };
}
