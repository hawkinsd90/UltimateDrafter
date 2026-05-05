import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';
import PlayerSearch from '../components/PlayerSearch';
import { enqueueNotification } from '../utils/notifications';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../contexts/AuthContext';

type Draft = Database['public']['Tables']['drafts']['Row'];
type League = Database['public']['Tables']['leagues']['Row'];
type DraftSettings = Database['public']['Tables']['draft_settings']['Row'];
type Participant = Database['public']['Tables']['draft_participants']['Row'];
type Pick = Database['public']['Tables']['draft_picks']['Row'] & {
  player?: {
    display_name: string;
    fantasy_position: string | null;
    position: string | null;
    team: { abbreviation: string | null } | null;
  } | null;
};

type FilterMode = 'all' | 'round' | 'owner';
type TabId = 'overview' | 'myboard';

type BoardPlayer = {
  id: string;
  display_name: string;
  fantasy_position: string | null;
  position: string | null;
  status: string | null;
  injury_status: string | null;
  team_abbr: string | null;
  headshot_url: string | null;
  rank: number;
  rankingId: string | null;
};

const bg = '#0f172a';
const card = '#1e293b';
const border = '#334155';
const textPrimary = '#f1f5f9';
const textSecondary = '#94a3b8';
const green = '#22c55e';
const greenDark = '#16a34a';
const blue = '#3b82f6';
const amber = '#f59e0b';

const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;
type PositionFilter = typeof POSITIONS[number];

const INJURY_COLORS: Record<string, string> = {
  'Questionable': '#d97706',
  'Doubtful': '#dc2626',
  'Out': '#dc2626',
  'IR': '#9333ea',
};

export default function DraftBoard() {
  const { draftId } = useParams<{ draftId: string }>();
  const { user } = useAuth();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [draftSettings, setDraftSettings] = useState<DraftSettings | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [currentParticipant, setCurrentParticipant] = useState<Participant | null>(null);
  const [showPlayerSearch, setShowPlayerSearch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterRound, setFilterRound] = useState<number>(1);
  const [filterOwner, setFilterOwner] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // My Board state
  const [boardPlayers, setBoardPlayers] = useState<BoardPlayer[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const [boardPositionFilter, setBoardPositionFilter] = useState<PositionFilter>('All');
  const [boardAvailablePlayers, setBoardAvailablePlayers] = useState<Omit<BoardPlayer, 'rank' | 'rankingId'>[]>([]);
  const [boardAvailableLoading, setBoardAvailableLoading] = useState(false);
  const boardDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const participantsRef = useRef<Participant[]>([]);
  participantsRef.current = participants;
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const picksRef = useRef<Pick[]>([]);
  picksRef.current = picks;

  const reloadPicks = useCallback(() => {
    supabase
      .from('draft_picks')
      .select('*, player:sports_players(display_name, fantasy_position, position, team:sports_teams(abbreviation))')
      .eq('draft_id', draftId!)
      .order('pick_number', { ascending: true })
      .then(({ data }) => {
        if (data) setPicks(data as Pick[]);
      });
  }, [draftId]);

  const reloadDraft = useCallback(() => {
    supabase
      .from('drafts')
      .select('*')
      .eq('id', draftId!)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setDraft(data);
        const current = participantsRef.current.find(p => p.id === data.current_participant_id) ?? null;
        setCurrentParticipant(current);
      });
  }, [draftId]);

  useEffect(() => {
    if (!draftId) return;
    loadData();
    const cleanup = subscribeToLiveUpdates();

    pollRef.current = setInterval(() => {
      reloadDraft();
      reloadPicks();
    }, 5000);

    return () => {
      cleanup();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [draftId]);

  // Reload board rankings whenever picks change (player got drafted → mark unavailable)
  useEffect(() => {
    if (activeTab === 'myboard' && user) {
      loadBoardRankings();
    }
  }, [picks, activeTab]);

  useEffect(() => {
    if (activeTab === 'myboard') {
      loadBoardRankings();
    }
  }, [activeTab, draftId, user]);

  useEffect(() => {
    if (activeTab !== 'myboard') return;
    if (boardDebounceRef.current) clearTimeout(boardDebounceRef.current);
    boardDebounceRef.current = setTimeout(() => {
      searchAvailablePlayers();
    }, 250);
    return () => {
      if (boardDebounceRef.current) clearTimeout(boardDebounceRef.current);
    };
  }, [boardSearch, boardPositionFilter, activeTab]);

  async function loadData() {
    const draftRes = await supabase.from('drafts').select('*').eq('id', draftId!).single();
    if (!draftRes.data) { setLoading(false); return; }

    const [participantsRes, picksRes, leagueRes, settingsRes] = await Promise.all([
      supabase.from('draft_participants').select('*').eq('draft_id', draftId!).order('draft_position', { ascending: true }),
      supabase.from('draft_picks').select('*, player:sports_players(display_name, fantasy_position, position, team:sports_teams(abbreviation))').eq('draft_id', draftId!).order('pick_number', { ascending: true }),
      supabase.from('leagues').select('*').eq('id', draftRes.data.league_id).single(),
      supabase.from('draft_settings').select('*').eq('draft_id', draftId!).maybeSingle()
    ]);

    const newParticipants = participantsRes.data ?? [];
    setDraft(draftRes.data);
    setParticipants(newParticipants);
    if (picksRes.data) setPicks(picksRes.data as Pick[]);
    if (leagueRes.data) setLeague(leagueRes.data);
    if (settingsRes.data) setDraftSettings(settingsRes.data);

    const current = newParticipants.find(p => p.id === draftRes.data.current_participant_id) ?? null;
    setCurrentParticipant(current);
    setLoading(false);
  }

  function subscribeToLiveUpdates() {
    const channel = supabase
      .channel(`draft-board-${draftId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'drafts',
        filter: `id=eq.${draftId}`,
      }, (payload) => {
        const updated = payload.new as Draft;
        setDraft(updated);
        const current = participantsRef.current.find(p => p.id === updated.current_participant_id) ?? null;
        setCurrentParticipant(current);
        reloadPicks();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'draft_picks',
        filter: `draft_id=eq.${draftId}`,
      }, () => { reloadPicks(); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'draft_picks',
        filter: `draft_id=eq.${draftId}`,
      }, () => { reloadPicks(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  async function loadBoardRankings() {
    if (!user || !draftId) return;
    setBoardLoading(true);

    const { data: rankings } = await supabase
      .from('draft_board_rankings')
      .select('id, sports_player_id, rank')
      .eq('draft_id', draftId)
      .eq('user_id', user.id)
      .order('rank', { ascending: true });

    if (!rankings || rankings.length === 0) {
      setBoardPlayers([]);
      setBoardLoading(false);
      return;
    }

    const playerIds = rankings.map(r => r.sports_player_id);
    const { data: players } = await supabase
      .from('nfl_draft_player_pool')
      .select('id, display_name, fantasy_position, position, status, injury_status, team_abbr, headshot_url')
      .in('id', playerIds);

    const playerMap = new Map((players ?? []).map(p => [p.id, p]));
    const merged: BoardPlayer[] = [];
    for (const r of rankings) {
      const p = playerMap.get(r.sports_player_id);
      if (!p) continue;
      merged.push({ id: p.id, display_name: p.display_name, fantasy_position: p.fantasy_position, position: p.position, status: p.status, injury_status: p.injury_status, team_abbr: p.team_abbr, headshot_url: p.headshot_url, rank: r.rank, rankingId: r.id });
    }

    setBoardPlayers(merged);
    setBoardLoading(false);
  }

  async function searchAvailablePlayers() {
    if (activeTab !== 'myboard') return;
    setBoardAvailableLoading(true);

    let query = supabase
      .from('nfl_draft_player_pool')
      .select('id, display_name, fantasy_position, position, status, injury_status, team_abbr, headshot_url')
      .order('display_name')
      .limit(60);

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
    setBoardAvailablePlayers((data ?? []) as Omit<BoardPlayer, 'rank' | 'rankingId'>[]);
    setBoardAvailableLoading(false);
  }

  async function addPlayerToBoard(playerId: string) {
    if (!user || !draftId) return;
    const nextRank = boardPlayers.length > 0 ? Math.max(...boardPlayers.map(p => p.rank)) + 1 : 1;

    const { error: insertError } = await supabase
      .from('draft_board_rankings')
      .insert({ draft_id: draftId, user_id: user.id, sports_player_id: playerId, rank: nextRank });

    if (!insertError) {
      await loadBoardRankings();
    }
  }

  async function removePlayerFromBoard(rankingId: string) {
    await supabase.from('draft_board_rankings').delete().eq('id', rankingId);
    await loadBoardRankings();
  }

  async function addAllAvailableToBoard() {
    if (!user || !draftId) return;
    const currentPickedIds = new Set(picksRef.current.map(p => p.player_id).filter(Boolean) as string[]);
    const currentBoardedIds = new Set(boardPlayers.map(p => p.id));
    const toAdd = boardAvailablePlayers.filter(p => !currentPickedIds.has(p.id) && !currentBoardedIds.has(p.id));
    if (toAdd.length === 0) return;

    const startRank = boardPlayers.length > 0 ? Math.max(...boardPlayers.map(p => p.rank)) + 1 : 1;
    const rows = toAdd.map((p, i) => ({
      draft_id: draftId,
      user_id: user.id,
      sports_player_id: p.id,
      rank: startRank + i,
    }));

    await supabase.from('draft_board_rankings').upsert(rows, { onConflict: 'draft_id,user_id,sports_player_id', ignoreDuplicates: true });
    await loadBoardRankings();
  }

  async function reorderBoard(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const updated = [...boardPlayers];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);

    const reranked = updated.map((p, i) => ({ ...p, rank: i + 1 }));
    setBoardPlayers(reranked);

    // Use individual updates to avoid upsert conflict errors
    for (const p of reranked) {
      if (p.rankingId) {
        await supabase.from('draft_board_rankings').update({ rank: p.rank }).eq('id', p.rankingId);
      }
    }
  }

  async function startDraft() {
    if (!participants.length) return;
    const { error: err } = await supabase
      .from('drafts')
      .update({ current_participant_id: participants[0].id, status: 'in_progress' })
      .eq('id', draftId!);
    if (err) setError('Failed to start draft: ' + err.message);
  }

  async function makePick(playerId: string) {
    setError('');
    if (!draft || !currentParticipant) { setError('Cannot make pick: no active participant'); return; }

    const alreadyPicked = picks.find(p => p.player_id === playerId);
    if (alreadyPicked) { setError('This player has already been drafted'); setShowPlayerSearch(false); return; }

    const pickNumber = draft.current_pick_number;
    const round = Math.ceil(pickNumber / participants.length);
    const pickInRound = ((pickNumber - 1) % participants.length) + 1;
    const nextPickNumber = pickNumber + 1;
    const nextParticipant = getNextParticipant(pickNumber);
    const isForcePick = isOwner && currentParticipant.user_id !== user?.id;

    if (isForcePick) {
      const { error: pickError } = await supabase.from('draft_picks').insert({
        draft_id: draftId!, participant_id: currentParticipant.id, player_id: playerId,
        pick_number: pickNumber, round, pick_in_round: pickInRound,
        picked_at: new Date().toISOString(), time_taken_seconds: 0, is_autopick: false,
      });
      if (pickError) { setError('Error making pick: ' + pickError.message); setShowPlayerSearch(false); return; }

      const { error: advErr } = await supabase.from('drafts')
        .update({ current_pick_number: nextPickNumber, current_participant_id: nextParticipant?.id ?? null })
        .eq('id', draftId!);
      if (advErr) { setError('Error advancing draft: ' + advErr.message); setShowPlayerSearch(false); return; }
    } else {
      const { error: rpcError } = await supabase.rpc('advance_draft_turn', {
        p_draft_id: draftId!, p_player_id: playerId, p_pick_number: pickNumber,
        p_round: round, p_pick_in_round: pickInRound,
        p_next_pick_number: nextPickNumber, p_next_participant_id: nextParticipant?.id ?? null,
      });
      if (rpcError) { setError('Error making pick: ' + rpcError.message); setShowPlayerSearch(false); return; }
    }

    if (nextParticipant?.user_id) {
      const notificationPayload = {
        leagueName: league?.name ?? 'Unknown League',
        pickNumber: nextPickNumber,
        teamName: nextParticipant.team_name,
        draftName: draft.name,
      };
      const messageText = `${nextParticipant.team_name}, you're on the clock! Pick #${nextPickNumber} in ${draft.name}`;
      void Promise.all([
        enqueueNotification({ channel: 'email', userId: nextParticipant.user_id, leagueId: draft.league_id, templateKey: 'draft_turn', payload: notificationPayload, messageText }),
        enqueueNotification({ channel: 'sms',   userId: nextParticipant.user_id, leagueId: draft.league_id, templateKey: 'draft_turn', payload: notificationPayload, messageText }),
      ]);
    }

    setShowPlayerSearch(false);
    setDraft(prev => prev ? { ...prev, current_pick_number: nextPickNumber, current_participant_id: nextParticipant?.id ?? null } : prev);
    setCurrentParticipant(nextParticipant ?? null);
    reloadPicks();
  }

  function getNextParticipant(currentPickNumber: number): Participant | null {
    if (!participants.length) return null;
    const nextPickNumber = currentPickNumber + 1;
    const nextRound = Math.ceil(nextPickNumber / participants.length);
    const fmt = draftSettings?.draft_format || draft?.draft_type || 'snake';
    if (fmt === 'snake') {
      const odd = nextRound % 2 === 1;
      if (odd) return participants[(nextPickNumber - 1) % participants.length];
      return participants[participants.length - 1 - ((nextPickNumber - 1) % participants.length)];
    }
    return participants[(nextPickNumber - 1) % participants.length];
  }

  if (loading) return <div style={{ padding: '40px', background: bg, minHeight: '100vh', color: textPrimary }}>Loading...</div>;
  if (!draft) return <div style={{ padding: '40px', background: bg, minHeight: '100vh', color: textPrimary }}>Draft not found</div>;

  const isOwner = !!(user && league && league.owner_id === user.id);
  const myParticipant = participants.find(p => p.user_id === user?.id) ?? null;
  const isMyTurn = !!(currentParticipant && myParticipant && currentParticipant.id === myParticipant.id);
  const draftNotStarted = draft.status === 'in_progress' && !currentParticipant && participants.length > 0;
  const canMakePick = draft.status === 'in_progress' && currentParticipant && isMyTurn;
  const canForcePick = draft.status === 'in_progress' && currentParticipant && isOwner && !isMyTurn;

  const totalRounds = draftSettings
    ? (draftSettings.roster_qb ?? 0) + (draftSettings.roster_rb ?? 0) + (draftSettings.roster_wr ?? 0)
      + (draftSettings.roster_te ?? 0) + (draftSettings.roster_flex ?? 0) + (draftSettings.roster_k ?? 0)
      + (draftSettings.roster_dst ?? 0) + (draftSettings.bench ?? 0)
    : null;
  const currentRound = participants.length > 0 ? Math.ceil(draft.current_pick_number / participants.length) : 1;
  const roundsRemaining = totalRounds != null ? Math.max(0, totalRounds - currentRound + 1) : null;

  const roundNumbers = Array.from(new Set(picks.map(p => p.round))).sort((a, b) => a - b);

  const filteredPicks = picks.filter(pick => {
    if (filterMode === 'round') return pick.round === filterRound;
    if (filterMode === 'owner') return pick.participant_id === filterOwner;
    return true;
  });

  const pickedPlayerIds = new Set(picks.map(p => p.player_id).filter(Boolean) as string[]);
  const boardedPlayerIds = new Set(boardPlayers.map(p => p.id));
  const showBoardSearch = boardSearch.length >= 2 || boardPositionFilter !== 'All';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: Record<string, any> = {
    page: { padding: '24px 32px', fontFamily: 'system-ui, sans-serif', color: textPrimary, background: bg, minHeight: '100vh' },
    card: { background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '20px', marginBottom: '20px' },
    h2: { color: textPrimary, margin: '0 0 14px 0', fontSize: '18px' },
    pill: (active: boolean, col: string) => ({
      padding: '4px 14px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
      background: active ? col : 'transparent',
      color: active ? 'white' : textSecondary,
      border: `1px solid ${active ? col : border}`,
      cursor: 'pointer',
    }),
    btn: (col: string) => ({
      padding: '10px 22px', background: col, color: 'white', border: 'none',
      borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '15px',
    }),
    btnOutline: {
      padding: '10px 22px', background: 'transparent', color: amber, border: `1px solid ${amber}`,
      borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '15px',
    },
    tab: (active: boolean) => ({
      padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', border: 'none',
      background: 'transparent',
      color: active ? textPrimary : textSecondary,
      borderBottom: active ? `2px solid ${blue}` : '2px solid transparent',
      transition: 'color 0.15s, border-color 0.15s',
    }),
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to={`/leagues/${draft.league_id}`} style={{ color: blue, textDecoration: 'none', fontSize: '14px' }}>
          ← Back to League
        </Link>
        <UserMenu />
      </div>

      <h1 style={{ color: textPrimary, marginBottom: '20px', fontSize: '26px' }}>{draft.name}</h1>

      {/* Status card */}
      <div style={s.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <span style={{ color: textSecondary, fontWeight: '600' }}>Status:</span>
          <span style={{
            padding: '2px 12px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
            background: draft.status === 'in_progress' ? '#14532d' : draft.status === 'paused' ? '#451a03' : '#1e293b',
            color: draft.status === 'in_progress' ? green : draft.status === 'paused' ? amber : textSecondary,
            border: `1px solid ${draft.status === 'in_progress' ? greenDark : draft.status === 'paused' ? amber : border}`,
          }}>
            {draft.status.replace('_', ' ')}
          </span>
        </div>
        <p style={{ margin: '0 0 6px', color: textPrimary, fontWeight: '700', fontSize: '17px' }}>
          Round {currentRound}{totalRounds != null ? ` of ${totalRounds}` : ''}
          {roundsRemaining != null && (
            <span style={{ marginLeft: '10px', color: textSecondary, fontWeight: '400', fontSize: '14px' }}>
              · {roundsRemaining} round{roundsRemaining !== 1 ? 's' : ''} remaining · Pick #{draft.current_pick_number}
            </span>
          )}
        </p>
        {draftSettings && (
          <p style={{ margin: '0 0 8px', fontSize: '13px', color: textSecondary }}>
            {draftSettings.draft_format === 'snake' ? 'Snake' : 'Linear'} Draft ·
            {draftSettings.pick_timer_seconds === 0 ? ' Unlimited time' : ` ${draftSettings.pick_timer_seconds}s per pick`} ·
            Roster: {draftSettings.roster_qb}QB {draftSettings.roster_rb}RB {draftSettings.roster_wr}WR {draftSettings.roster_te}TE {draftSettings.roster_flex}FLEX {draftSettings.roster_k}K {draftSettings.roster_dst}DST {draftSettings.bench}Bench
          </p>
        )}
        {currentParticipant && (
          <p style={{ margin: '0', fontSize: '16px', color: green, fontWeight: '700' }}>
            On the clock: {currentParticipant.team_name}
          </p>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {isOwner && draftNotStarted && (
          <button onClick={startDraft} style={s.btn(greenDark)}>Start Draft</button>
        )}
        {canMakePick && (
          <button onClick={() => setShowPlayerSearch(true)} style={s.btn(blue)}>Make Pick</button>
        )}
        {canForcePick && (
          <button onClick={() => setShowPlayerSearch(true)} style={s.btn('#0f766e')}>
            Force Pick for {currentParticipant!.team_name}
          </button>
        )}
        {isOwner && draft.status === 'in_progress' && (
          <button onClick={async () => { await supabase.from('drafts').update({ status: 'paused' }).eq('id', draftId!); }} style={s.btnOutline}>
            Pause Draft
          </button>
        )}
        {isOwner && draft.status === 'paused' && (
          <button onClick={async () => { await supabase.from('drafts').update({ status: 'in_progress' }).eq('id', draftId!); }} style={s.btn(greenDark)}>
            Resume Draft
          </button>
        )}
        {myParticipant && (
          <Link
            to={`/drafts/${draftId}/my-team`}
            style={{
              padding: '10px 22px', background: 'transparent', color: '#94a3b8',
              border: '1px solid #334155', borderRadius: '7px', fontWeight: '600',
              fontSize: '15px', textDecoration: 'none', lineHeight: '1',
              display: 'inline-flex', alignItems: 'center',
            }}
          >
            My Team
          </Link>
        )}
      </div>

      {draft.status === 'paused' && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#451a03', border: `1px solid ${amber}`, borderRadius: '6px', color: amber, fontSize: '14px' }}>
          Draft is paused.{isOwner ? ' Use Resume Draft to continue.' : ' Waiting for the commissioner to resume.'}
        </div>
      )}

      {showPlayerSearch && (
        <PlayerSearch draftId={draftId!} onSelectPlayer={makePick} onClose={() => setShowPlayerSearch(false)} />
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${border}`, marginBottom: '20px', gap: '0' }}>
        <button style={s.tab(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>
          Overview
        </button>
        <button style={s.tab(activeTab === 'myboard')} onClick={() => setActiveTab('myboard')}>
          My Board
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Draft order */}
          <div style={s.card}>
            <h2 style={s.h2}>Draft Order</h2>
            {participants.length === 0 ? (
              <p style={{ color: textSecondary }}>No participants yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {participants.map(p => (
                  <div key={p.id} style={{
                    padding: '11px 14px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '10px',
                    border: `2px solid ${p.id === currentParticipant?.id ? green : border}`,
                    background: p.id === currentParticipant?.id ? '#052e16' : '#0f172a',
                  }}>
                    <span style={{ fontWeight: '700', color: p.id === currentParticipant?.id ? green : textSecondary, minWidth: '24px' }}>
                      {p.draft_position}.
                    </span>
                    <span style={{ color: textPrimary, fontWeight: p.id === currentParticipant?.id ? '600' : '400' }}>
                      {p.team_name}
                    </span>
                    {p.id === currentParticipant?.id && (
                      <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: '700', color: green }}>On the clock</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Picks log */}
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ ...s.h2, margin: 0 }}>Picks Made ({picks.length})</h2>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button style={s.pill(filterMode === 'all', blue)} onClick={() => setFilterMode('all')}>All</button>
                <button style={s.pill(filterMode === 'round', blue)} onClick={() => setFilterMode('round')}>By Round</button>
                <button style={s.pill(filterMode === 'owner', blue)} onClick={() => setFilterMode('owner')}>By Team</button>
              </div>
            </div>

            {filterMode === 'round' && roundNumbers.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {roundNumbers.map(r => (
                  <button key={r} style={s.pill(filterRound === r, greenDark)} onClick={() => setFilterRound(r)}>
                    Rd {r}
                  </button>
                ))}
              </div>
            )}

            {filterMode === 'owner' && participants.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {participants.map(p => (
                  <button key={p.id} style={s.pill(filterOwner === p.id, greenDark)} onClick={() => setFilterOwner(p.id)}>
                    {p.team_name}
                  </button>
                ))}
              </div>
            )}

            {filteredPicks.length === 0 ? (
              <p style={{ color: textSecondary }}>No picks yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredPicks.map(pick => {
                  const participant = participants.find(p => p.id === pick.participant_id);
                  return (
                    <div key={pick.id} style={{ padding: '13px 16px', border: `1px solid ${border}`, borderRadius: '7px', background: '#0f172a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: '700', color: textPrimary }}>Pick {pick.pick_number}</span>
                          <span style={{ marginLeft: '8px', fontSize: '13px', color: textSecondary }}>Rd {pick.round}, Pick {pick.pick_in_round}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '600', color: textPrimary }}>{pick.player?.display_name ?? 'Unknown Player'}</div>
                          <div style={{ fontSize: '13px', color: textSecondary }}>
                            {pick.player?.fantasy_position ?? pick.player?.position ?? '—'}
                            {pick.player?.team?.abbreviation ? ` · ${pick.player.team.abbreviation}` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop: '4px', fontSize: '13px', color: textSecondary }}>
                        {participant?.team_name}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'myboard' && (
        <MyBoard
          draftId={draftId!}
  
          isMyTurn={!!isMyTurn}
          canForcePick={!!canForcePick}
          currentParticipant={currentParticipant}
          draftStatus={draft.status}
          boardPlayers={boardPlayers}
          boardLoading={boardLoading}
          boardSearch={boardSearch}
          setBoardSearch={setBoardSearch}
          boardPositionFilter={boardPositionFilter}
          setBoardPositionFilter={setBoardPositionFilter}
          boardAvailablePlayers={boardAvailablePlayers}
          boardAvailableLoading={boardAvailableLoading}
          pickedPlayerIds={pickedPlayerIds}
          boardedPlayerIds={boardedPlayerIds}
          showBoardSearch={showBoardSearch}
          onAddPlayer={addPlayerToBoard}
          onAddAllAvailable={addAllAvailableToBoard}
          onRemovePlayer={removePlayerFromBoard}
          onReorder={reorderBoard}
          onPickFromBoard={makePick}
          s={s}
        />
      )}
    </div>
  );
}

// ─── My Board sub-component ──────────────────────────────────────────────────

interface MyBoardProps {
  draftId: string;
  isMyTurn: boolean;
  canForcePick: boolean;
  currentParticipant: Participant | null;
  draftStatus: string;
  boardPlayers: BoardPlayer[];
  boardLoading: boolean;
  boardSearch: string;
  setBoardSearch: (v: string) => void;
  boardPositionFilter: PositionFilter;
  setBoardPositionFilter: (v: PositionFilter) => void;
  boardAvailablePlayers: Omit<BoardPlayer, 'rank' | 'rankingId'>[];
  boardAvailableLoading: boolean;
  pickedPlayerIds: Set<string>;
  boardedPlayerIds: Set<string>;
  showBoardSearch: boolean;
  onAddPlayer: (id: string) => void;
  onAddAllAvailable: () => void;
  onRemovePlayer: (rankingId: string) => void;
  onReorder: (from: number, to: number) => void;
  onPickFromBoard: (playerId: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: Record<string, any>;
}

function MyBoard({
  isMyTurn, canForcePick, currentParticipant, draftStatus,
  boardPlayers, boardLoading, boardSearch, setBoardSearch,
  boardPositionFilter, setBoardPositionFilter,
  boardAvailablePlayers, boardAvailableLoading,
  pickedPlayerIds, boardedPlayerIds,
  showBoardSearch, onAddPlayer, onAddAllAvailable, onRemovePlayer, onReorder, onPickFromBoard, s,
}: MyBoardProps) {
  const border2 = '#334155';
  const textPrimary2 = '#f1f5f9';
  const textSecondary2 = '#94a3b8';
  const green2 = '#22c55e';
  const blue2 = '#3b82f6';

  const canPick = (isMyTurn || canForcePick) && draftStatus === 'in_progress';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

      {/* Left: My Rankings */}
      <div>
        <div style={{ ...s.card, marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
            <div>
              <h2 style={{ color: textPrimary2, margin: '0 0 4px', fontSize: '18px' }}>My Rankings</h2>
              <p style={{ color: textSecondary2, margin: 0, fontSize: '13px' }}>
                Use arrows to reorder · {boardPlayers.filter(p => !pickedPlayerIds.has(p.id)).length} available
              </p>
            </div>
            {canPick && boardPlayers.some(p => !pickedPlayerIds.has(p.id)) && (
              <div style={{
                padding: '4px 12px', borderRadius: '9999px', fontSize: '12px', fontWeight: '700',
                background: '#14532d', color: green2, border: `1px solid #16a34a`,
              }}>
                {isMyTurn ? 'Your turn!' : `Force pick for ${currentParticipant?.team_name}`}
              </div>
            )}
          </div>

          {boardLoading ? (
            <p style={{ color: textSecondary2, fontSize: '14px', textAlign: 'center', padding: '30px 0' }}>Loading...</p>
          ) : boardPlayers.length === 0 ? (
            <p style={{ color: textSecondary2, fontSize: '14px', textAlign: 'center', padding: '30px 0' }}>
              Add players from the right to build your board.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '560px', overflowY: 'auto' }}>
              {boardPlayers.map((player, index) => {
                const isPicked = pickedPlayerIds.has(player.id);
                const injuryLabel = player.injury_status;
                const injuryColor = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;

                return (
                  <div
                    key={player.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '7px',
                      border: `1px solid ${isPicked ? '#1e3a5f' : border2}`,
                      background: isPicked ? '#0c1929' : '#0f172a',
                      opacity: isPicked ? 0.5 : 1,
                      display: 'flex', alignItems: 'center', gap: '8px',
                    }}
                  >
                    {/* Rank + up/down buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', minWidth: '32px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: isPicked ? textSecondary2 : textPrimary2, lineHeight: 1 }}>
                        {index + 1}
                      </span>
                      {!isPicked && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                          <button
                            onClick={() => index > 0 && onReorder(index, index - 1)}
                            disabled={index === 0}
                            style={{
                              padding: '0 4px', lineHeight: '14px', fontSize: '10px', fontWeight: '700',
                              background: 'transparent', color: index === 0 ? '#334155' : '#64748b',
                              border: 'none', cursor: index === 0 ? 'default' : 'pointer',
                            }}
                            title="Move up"
                          >▲</button>
                          <button
                            onClick={() => index < boardPlayers.length - 1 && onReorder(index, index + 1)}
                            disabled={index === boardPlayers.length - 1}
                            style={{
                              padding: '0 4px', lineHeight: '14px', fontSize: '10px', fontWeight: '700',
                              background: 'transparent', color: index === boardPlayers.length - 1 ? '#334155' : '#64748b',
                              border: 'none', cursor: index === boardPlayers.length - 1 ? 'default' : 'pointer',
                            }}
                            title="Move down"
                          >▼</button>
                        </div>
                      )}
                    </div>

                    {/* Headshot */}
                    {player.headshot_url ? (
                      <img src={player.headshot_url} alt="" style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#334155' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#334155', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: textSecondary2 }}>
                        {player.fantasy_position === 'DST' ? 'D' : '?'}
                      </div>
                    )}

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: '600', fontSize: '13px', color: isPicked ? textSecondary2 : textPrimary2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                          {player.display_name}
                        </span>
                        {isPicked && <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: '#1e3a8a', color: '#93c5fd' }}>Drafted</span>}
                        {injuryLabel && injuryColor && !isPicked && (
                          <span style={{ fontSize: '10px', fontWeight: '600', color: injuryColor }}>{injuryLabel}</span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: textSecondary2, marginTop: '1px' }}>
                        {player.team_abbr ? `${player.team_abbr} · ` : ''}{player.fantasy_position ?? player.position ?? '—'}
                      </div>
                    </div>

                    {/* Position badge */}
                    <span style={{
                      padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
                      background: positionBadgeBg(player.fantasy_position), color: positionBadgeColor(player.fantasy_position), flexShrink: 0,
                    }}>
                      {player.fantasy_position ?? player.position ?? '—'}
                    </span>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      {canPick && !isPicked && (
                        <button
                          onClick={() => onPickFromBoard(player.id)}
                          style={{
                            padding: '4px 10px', fontSize: '12px', fontWeight: '700',
                            background: '#14532d', color: green2, border: `1px solid #16a34a`,
                            borderRadius: '5px', cursor: 'pointer',
                          }}
                          title="Pick this player"
                        >
                          Pick
                        </button>
                      )}
                      <button
                        onClick={() => player.rankingId && onRemovePlayer(player.rankingId)}
                        style={{
                          padding: '4px 8px', fontSize: '14px', background: 'transparent',
                          color: '#64748b', border: 'none', cursor: 'pointer', lineHeight: 1,
                          borderRadius: '4px',
                        }}
                        title="Remove from board"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: Available Players */}
      <div>
        <div style={{ ...s.card, marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h2 style={{ color: textPrimary2, margin: 0, fontSize: '18px' }}>Available Players</h2>
            {(() => {
              const addableCount = boardAvailablePlayers.filter(p => !pickedPlayerIds.has(p.id) && !boardedPlayerIds.has(p.id)).length;
              return addableCount > 0 ? (
                <button
                  onClick={onAddAllAvailable}
                  style={{
                    padding: '5px 12px', fontSize: '12px', fontWeight: '600',
                    background: 'transparent', color: blue2, border: `1px solid ${blue2}`,
                    borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  + Add All ({addableCount})
                </button>
              ) : null;
            })()}
          </div>

          {/* Search */}
          <input
            type="text"
            value={boardSearch}
            onChange={e => setBoardSearch(e.target.value)}
            placeholder="Search by name..."
            style={{
              width: '100%', padding: '9px 12px', border: `1px solid ${border2}`,
              borderRadius: '7px', fontSize: '14px', color: textPrimary2,
              background: '#0f172a', boxSizing: 'border-box', marginBottom: '10px', outline: 'none',
            }}
          />

          {/* Position tabs */}
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {POSITIONS.map(pos => (
              <button
                key={pos}
                onClick={() => setBoardPositionFilter(pos)}
                style={{
                  padding: '4px 11px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                  border: boardPositionFilter === pos ? 'none' : `1px solid ${border2}`,
                  background: boardPositionFilter === pos ? blue2 : 'transparent',
                  color: boardPositionFilter === pos ? 'white' : textSecondary2,
                }}
              >
                {pos}
              </button>
            ))}
          </div>

          {/* Player list */}
          <div style={{ maxHeight: '480px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {boardAvailableLoading && (
              <p style={{ color: textSecondary2, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Searching...</p>
            )}

            {!boardAvailableLoading && !showBoardSearch && (
              <p style={{ color: textSecondary2, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
                Type at least 2 characters or select a position to browse.
              </p>
            )}

            {!boardAvailableLoading && showBoardSearch && boardAvailablePlayers.length === 0 && (
              <p style={{ color: textSecondary2, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>No players found.</p>
            )}

            {boardAvailablePlayers.map(player => {
              const isPicked = pickedPlayerIds.has(player.id);
              const isOnBoard = boardedPlayerIds.has(player.id);
              const injuryLabel = player.injury_status;
              const injuryColor = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;

              return (
                <div
                  key={player.id}
                  style={{
                    padding: '10px 12px', borderRadius: '7px',
                    border: `1px solid ${border2}`,
                    background: '#0f172a',
                    opacity: isPicked ? 0.45 : 1,
                    display: 'flex', alignItems: 'center', gap: '10px',
                  }}
                >
                  {/* Headshot */}
                  {player.headshot_url ? (
                    <img src={player.headshot_url} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#334155' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#334155', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: textSecondary2 }}>
                      {player.fantasy_position === 'DST' ? 'D' : '?'}
                    </div>
                  )}

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '600', fontSize: '13px', color: textPrimary2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                        {player.display_name}
                      </span>
                      {isPicked && <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: '#1e3a8a', color: '#93c5fd' }}>Drafted</span>}
                      {isOnBoard && !isPicked && <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: '#064e3b', color: '#6ee7b7' }}>On Board</span>}
                      {injuryLabel && injuryColor && !isPicked && (
                        <span style={{ fontSize: '10px', fontWeight: '600', color: injuryColor }}>{injuryLabel}</span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: textSecondary2, marginTop: '1px' }}>
                      {player.team_abbr ? `${player.team_abbr} · ` : ''}{player.fantasy_position ?? player.position ?? '—'}
                    </div>
                  </div>

                  {/* Position badge */}
                  <span style={{
                    padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
                    background: positionBadgeBg(player.fantasy_position), color: positionBadgeColor(player.fantasy_position), flexShrink: 0,
                  }}>
                    {player.fantasy_position ?? player.position ?? '—'}
                  </span>

                  {/* Add / Pick button */}
                  {!isPicked && !isOnBoard && (
                    <button
                      onClick={() => onAddPlayer(player.id)}
                      style={{
                        padding: '4px 10px', fontSize: '12px', fontWeight: '600',
                        background: 'transparent', color: blue2, border: `1px solid ${blue2}`,
                        borderRadius: '5px', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      + Add
                    </button>
                  )}
                  {!isPicked && isOnBoard && canPick && (
                    <button
                      onClick={() => onPickFromBoard(player.id)}
                      style={{
                        padding: '4px 10px', fontSize: '12px', fontWeight: '700',
                        background: '#14532d', color: green2, border: `1px solid #16a34a`,
                        borderRadius: '5px', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      Pick
                    </button>
                  )}
                  {isPicked && (
                    <span style={{ fontSize: '12px', color: textSecondary2, flexShrink: 0 }}>Drafted</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function positionBadgeBg(pos: string | null): string {
  switch (pos) {
    case 'QB':  return '#1e3a8a';
    case 'RB':  return '#14532d';
    case 'WR':  return '#713f12';
    case 'TE':  return '#7c2d12';
    case 'K':   return '#3b0764';
    case 'DST': return '#450a0a';
    default:    return '#1e293b';
  }
}

function positionBadgeColor(pos: string | null): string {
  switch (pos) {
    case 'QB':  return '#93c5fd';
    case 'RB':  return '#86efac';
    case 'WR':  return '#fde68a';
    case 'TE':  return '#fdba74';
    case 'K':   return '#d8b4fe';
    case 'DST': return '#fca5a5';
    default:    return '#94a3b8';
  }
}
