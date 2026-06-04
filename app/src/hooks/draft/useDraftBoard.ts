import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
// import { enqueueNotification } from '../../utils/notifications'; // TODO: re-enable with notifications
import type { Draft, League, DraftSettings, Participant, Pick } from './draftTypes';

export interface UseDraftBoardReturn {
  // State
  draft: Draft | null;
  league: League | null;
  draftSettings: DraftSettings | null;
  participants: Participant[];
  picks: Pick[];
  currentParticipant: Participant | null;
  loading: boolean;
  error: string;
  setError: (msg: string) => void;

  // Derived
  isOwner: boolean;
  myParticipant: Participant | null;
  isMyTurn: boolean;
  draftNotStarted: boolean;
  canMakePick: boolean;
  canForcePick: boolean;
  pickedPlayerIds: Set<string>;
  totalRounds: number | null;
  currentRound: number;
  roundsRemaining: number | null;
  isRookieDraft: boolean;

  // Actions
  startDraft: () => Promise<void>;
  pauseDraft: () => Promise<void>;
  resumeDraft: () => Promise<void>;
  makePick: (playerId: string) => Promise<void>;
}

export function useDraftBoard(draftId: string, userId: string | undefined): UseDraftBoardReturn {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [draftSettings, setDraftSettings] = useState<DraftSettings | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [currentParticipant, setCurrentParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const participantsRef = useRef<Participant[]>([]);
  participantsRef.current = participants;
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reloadPicks = useCallback(() => {
    supabase
      .from('draft_picks')
      .select('*, player:sports_players(display_name, fantasy_position, position, team:sports_teams(abbreviation))')
      .eq('draft_id', draftId)
      .order('pick_number', { ascending: true })
      .then(({ data }) => {
        if (data) setPicks(data as Pick[]);
      });
  }, [draftId]);

  const reloadDraft = useCallback(() => {
    supabase
      .from('drafts')
      .select('*')
      .eq('id', draftId)
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

  async function loadData() {
    const draftRes = await supabase.from('drafts').select('*').eq('id', draftId).single();
    if (!draftRes.data) { setLoading(false); return; }

    const [participantsRes, picksRes, leagueRes, settingsRes] = await Promise.all([
      supabase.from('draft_participants').select('*').eq('draft_id', draftId).order('draft_position', { ascending: true }),
      supabase.from('draft_picks').select('*, player:sports_players(display_name, fantasy_position, position, team:sports_teams(abbreviation))').eq('draft_id', draftId).order('pick_number', { ascending: true }),
      supabase.from('leagues').select('*').eq('id', draftRes.data.league_id).single(),
      supabase.from('draft_settings').select('*').eq('draft_id', draftId).maybeSingle(),
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

  function subscribeToLiveUpdates(): () => void {
    const channel = supabase
      .channel(`draft-board-${draftId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `id=eq.${draftId}` }, (payload) => {
        const updated = payload.new as Draft;
        setDraft(updated);
        const current = participantsRef.current.find(p => p.id === updated.current_participant_id) ?? null;
        setCurrentParticipant(current);
        reloadPicks();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${draftId}` }, () => { reloadPicks(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${draftId}` }, () => { reloadPicks(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  async function startDraft() {
    if (!participants.length) return;
    const { error: err } = await supabase
      .from('drafts')
      .update({ current_participant_id: participants[0].id, status: 'in_progress' })
      .eq('id', draftId);
    if (err) setError('Failed to start draft: ' + err.message);
  }

  async function pauseDraft() {
    await supabase.from('drafts').update({ status: 'paused' }).eq('id', draftId);
  }

  async function resumeDraft() {
    await supabase.from('drafts').update({ status: 'in_progress' }).eq('id', draftId);
  }

  function getNextParticipant(currentPickNumber: number): Participant | null {
    if (!participants.length) return null;
    const nextPickNumber = currentPickNumber + 1;
    const nextRound = Math.ceil(nextPickNumber / participants.length);
    const fmt = draftSettings?.draft_format || draftRef.current?.draft_type || 'snake';
    if (fmt === 'snake') {
      const odd = nextRound % 2 === 1;
      if (odd) return participants[(nextPickNumber - 1) % participants.length];
      return participants[participants.length - 1 - ((nextPickNumber - 1) % participants.length)];
    }
    return participants[(nextPickNumber - 1) % participants.length];
  }

  async function makePick(playerId: string) {
    setError('');
    const currentDraft = draftRef.current;
    if (!currentDraft || !currentParticipant) { setError('Cannot make pick: no active participant'); return; }

    const alreadyPicked = picks.find(p => p.player_id === playerId);
    if (alreadyPicked) { setError('This player has already been drafted'); return; }

    const pickNumber = currentDraft.current_pick_number;
    const round = Math.ceil(pickNumber / participants.length);
    const pickInRound = ((pickNumber - 1) % participants.length) + 1;
    const nextPickNumber = pickNumber + 1;
    const nextParticipant = getNextParticipant(pickNumber);
    const isOwnerForcePick = league?.owner_id === userId && currentParticipant.user_id !== userId;

    if (isOwnerForcePick) {
      const { error: pickError } = await supabase.from('draft_picks').insert({
        draft_id: draftId, participant_id: currentParticipant.id, player_id: playerId,
        pick_number: pickNumber, round, pick_in_round: pickInRound,
        picked_at: new Date().toISOString(), time_taken_seconds: 0, is_autopick: false,
      });
      if (pickError) { setError('Error making pick: ' + pickError.message); return; }

      const { error: advErr } = await supabase.from('drafts')
        .update({ current_pick_number: nextPickNumber, current_participant_id: nextParticipant?.id ?? null })
        .eq('id', draftId);
      if (advErr) { setError('Error advancing draft: ' + advErr.message); return; }
    } else {
      const { error: rpcError } = await supabase.rpc('advance_draft_turn', {
        p_draft_id: draftId, p_player_id: playerId, p_pick_number: pickNumber,
        p_round: round, p_pick_in_round: pickInRound,
        p_next_pick_number: nextPickNumber, p_next_participant_id: nextParticipant?.id ?? null,
      });
      if (rpcError) { setError('Error making pick: ' + rpcError.message); return; }
    }

    // TODO: re-enable notifications after core workflow is verified
    // if (nextParticipant?.user_id) {
    //   const notificationPayload = {
    //     leagueName: league?.name ?? 'Unknown League',
    //     pickNumber: nextPickNumber,
    //     teamName: nextParticipant.team_name,
    //     draftName: currentDraft.name,
    //   };
    //   const messageText = `${nextParticipant.team_name}, you're on the clock! Pick #${nextPickNumber} in ${currentDraft.name}`;
    //   void Promise.all([
    //     enqueueNotification({ channel: 'email', userId: nextParticipant.user_id, leagueId: currentDraft.league_id, templateKey: 'draft_turn', payload: notificationPayload, messageText }),
    //     enqueueNotification({ channel: 'sms',   userId: nextParticipant.user_id, leagueId: currentDraft.league_id, templateKey: 'draft_turn', payload: notificationPayload, messageText }),
    //   ]);
    // }

    setDraft(prev => prev ? { ...prev, current_pick_number: nextPickNumber, current_participant_id: nextParticipant?.id ?? null } : prev);
    setCurrentParticipant(nextParticipant ?? null);
    reloadPicks();
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const isOwner = !!(userId && league && league.owner_id === userId);
  const myParticipant = participants.find(p => p.user_id === userId) ?? null;
  const isMyTurn = !!(currentParticipant && myParticipant && currentParticipant.id === myParticipant.id);
  const draftNotStarted = !!(draft && draft.status === 'pending' && participants.length > 0);
  const canMakePick = !!(draft && draft.status === 'in_progress' && currentParticipant && isMyTurn);
  const canForcePick = !!(draft && draft.status === 'in_progress' && currentParticipant && isOwner && !isMyTurn);
  const pickedPlayerIds = new Set(picks.map(p => p.player_id).filter(Boolean) as string[]);

  // For rookie drafts, num_rounds overrides the roster-sum calculation
  const settingsExt = draftSettings as (typeof draftSettings & { num_rounds?: number | null; draft_type?: string | null }) | null;
  const isRookieDraft = (settingsExt?.draft_type ?? draft?.draft_type) === 'rookie';
  const totalRounds = draftSettings
    ? (isRookieDraft && settingsExt?.num_rounds != null
        ? settingsExt.num_rounds
        : (draftSettings.roster_qb ?? 0) + (draftSettings.roster_rb ?? 0) + (draftSettings.roster_wr ?? 0)
          + (draftSettings.roster_te ?? 0) + (draftSettings.roster_flex ?? 0) + ((draftSettings as Record<string, unknown>).roster_op as number ?? 0)
          + (draftSettings.roster_k ?? 0) + (draftSettings.roster_dst ?? 0) + (draftSettings.bench ?? 0))
    : null;
  const currentRound = participants.length > 0 ? Math.ceil((draft?.current_pick_number ?? 1) / participants.length) : 1;
  const roundsRemaining = totalRounds != null ? Math.max(0, totalRounds - currentRound + 1) : null;

  return {
    draft, league, draftSettings, participants, picks, currentParticipant, loading, error, setError,
    isOwner, myParticipant, isMyTurn, draftNotStarted, canMakePick, canForcePick, pickedPlayerIds,
    totalRounds, currentRound, roundsRemaining, isRookieDraft,
    startDraft, pauseDraft, resumeDraft, makePick,
  };
}
