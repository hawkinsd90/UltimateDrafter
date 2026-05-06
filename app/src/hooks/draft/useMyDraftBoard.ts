import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import type { BoardPlayer, AvailablePlayer, PositionFilter, SortMode } from './draftTypes';

export interface UseMyDraftBoardReturn {
  boardPlayers: BoardPlayer[];
  boardLoading: boolean;
  boardSearch: string;
  setBoardSearch: (v: string) => void;
  boardPositionFilter: PositionFilter;
  setBoardPositionFilter: (v: PositionFilter) => void;
  boardSortMode: SortMode;
  setBoardSortMode: (v: SortMode) => void;
  boardAvailablePlayers: AvailablePlayer[];
  boardAvailableLoading: boolean;
  showBoardSearch: boolean;
  loadBoardRankings: () => Promise<void>;
  addPlayerToBoard: (playerId: string) => Promise<void>;
  addVisibleToBoard: () => Promise<void>;
  removePlayerFromBoard: (rankingId: string) => Promise<void>;
  removeAllFromBoard: () => Promise<void>;
  reorderBoard: (fromIndex: number, toIndex: number) => Promise<void>;
}

export function useMyDraftBoard(
  draftId: string,
  userId: string | undefined,
  isMyBoardActive: boolean,
  picksLength: number,
  pickedPlayerIds: Set<string>,
): UseMyDraftBoardReturn {
  const [boardPlayers, setBoardPlayers] = useState<BoardPlayer[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const [boardPositionFilter, setBoardPositionFilter] = useState<PositionFilter>('All');
  const [boardSortMode, setBoardSortMode] = useState<SortMode>('name');
  const [boardAvailablePlayers, setBoardAvailablePlayers] = useState<AvailablePlayer[]>([]);
  const [boardAvailableLoading, setBoardAvailableLoading] = useState(false);

  const boardDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picksCountRef = useRef<number>(-1);
  const boardPlayersRef = useRef<BoardPlayer[]>([]);
  boardPlayersRef.current = boardPlayers;

  // Reload rankings when tab becomes active or picks change
  useEffect(() => {
    if (!isMyBoardActive || !userId) return;
    const newCount = picksLength;
    if (newCount !== picksCountRef.current) {
      picksCountRef.current = newCount;
      loadBoardRankings();
    }
  }, [picksLength, isMyBoardActive, draftId, userId]);

  // Debounced search when filter/search/sort changes
  useEffect(() => {
    if (!isMyBoardActive) return;
    if (boardDebounceRef.current) clearTimeout(boardDebounceRef.current);
    boardDebounceRef.current = setTimeout(() => {
      searchAvailablePlayers();
    }, 250);
    return () => {
      if (boardDebounceRef.current) clearTimeout(boardDebounceRef.current);
    };
  }, [boardSearch, boardPositionFilter, boardSortMode, isMyBoardActive]);

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
        id: p.id,
        display_name: p.display_name,
        fantasy_position: p.fantasy_position,
        position: p.position,
        status: p.status,
        injury_status: p.injury_status,
        team_abbr: p.team_abbr,
        espn_rank: null,
        sleeper_rank: null,
        rank: r.rank,
        rankingId: r.id,
      });
    }

    setBoardPlayers(merged);
    setBoardLoading(false);
  }

  async function searchAvailablePlayers() {
    if (!isMyBoardActive) return;
    setBoardAvailableLoading(true);

    const sortColumn = boardSortMode === 'espn' ? 'espn_rank' : boardSortMode === 'sleeper' ? 'sleeper_rank' : 'display_name';
    const sortNullsLast = boardSortMode !== 'name';

    let query = supabase
      .from('nfl_draft_player_pool')
      .select('id, display_name, fantasy_position, position, status, injury_status, team_abbr, espn_rank, sleeper_rank')
      .order(sortColumn, { ascending: true, nullsFirst: !sortNullsLast })
      .limit(100);

    if (boardPositionFilter !== 'All') {
      query = query.eq('fantasy_position', boardPositionFilter);
    }

    if (boardSearch.length >= 2) {
      query = query.ilike('display_name', `%${boardSearch}%`);
    } else if (boardSearch.length > 0) {
      setBoardAvailablePlayers([]);
      setBoardAvailableLoading(false);
      return;
    }

    const { data } = await query;
    setBoardAvailablePlayers((data ?? []) as AvailablePlayer[]);
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

  async function addVisibleToBoard() {
    if (!userId || !draftId) return;
    const current = boardPlayersRef.current;
    const currentBoardedIds = new Set(current.map(p => p.id));
    const toAdd = boardAvailablePlayers.filter(p => !pickedPlayerIds.has(p.id) && !currentBoardedIds.has(p.id));
    if (toAdd.length === 0) return;

    const startRank = current.length > 0 ? Math.max(...current.map(p => p.rank)) + 1 : 1;
    const rows = toAdd.map((p, i) => ({
      draft_id: draftId,
      user_id: userId,
      sports_player_id: p.id,
      rank: startRank + i,
    }));

    await supabase.from('draft_board_rankings').upsert(rows, { onConflict: 'draft_id,user_id,sports_player_id', ignoreDuplicates: true });
    await loadBoardRankings();
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
    const current = boardPlayersRef.current;
    const updated = [...current];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);

    const reranked = updated.map((p, i) => ({ ...p, rank: i + 1 }));
    setBoardPlayers(reranked);

    for (const p of reranked) {
      if (p.rankingId) {
        await supabase.from('draft_board_rankings').update({ rank: p.rank }).eq('id', p.rankingId);
      }
    }
  }

  const showBoardSearch = boardSearch.length >= 2 || boardPositionFilter !== 'All';

  return {
    boardPlayers, boardLoading,
    boardSearch, setBoardSearch,
    boardPositionFilter, setBoardPositionFilter,
    boardSortMode, setBoardSortMode,
    boardAvailablePlayers, boardAvailableLoading,
    showBoardSearch,
    loadBoardRankings,
    addPlayerToBoard,
    addVisibleToBoard,
    removePlayerFromBoard,
    removeAllFromBoard,
    reorderBoard,
  };
}
