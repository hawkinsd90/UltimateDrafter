import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export interface TradeProposalPlayer {
  id:                      string;
  direction:               'send' | 'receive';
  league_roster_player_id: string;
  sports_player_id:        string | null;
  snapshot_player_name:    string;
  snapshot_position:       string | null;
  snapshot_team_name:      string | null;
}

export interface TradeProposal {
  id:                  string;
  league_id:           string;
  proposer_member_id:  string;
  proposer_user_id:    string;
  receiver_member_id:  string;
  receiver_user_id:    string | null;  // resolved from league_members
  status:              'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired';
  resolved_by_user_id: string | null;
  commissioner_action: boolean;
  commissioner_note:   string | null;
  message:             string | null;
  expires_at:          string;
  created_at:          string;
  updated_at:          string;
  players:             TradeProposalPlayer[];
  proposer_team_name:  string | null;
  receiver_team_name:  string | null;
}

export function useTrades(leagueId: string, userId: string, _isLeagueOwner: boolean) {
  const [pending, setPending] = useState<TradeProposal[]>([]);
  const [recent,  setRecent]  = useState<TradeProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const loadTrades = useCallback(async () => {
    setLoading(true);
    setError('');

    const { data, error: err } = await supabase
      .from('league_trade_proposals')
      .select(`
        id, league_id, proposer_member_id, proposer_user_id,
        receiver_member_id, status, resolved_by_user_id,
        commissioner_action, commissioner_note, message,
        expires_at, created_at, updated_at,
        league_trade_proposal_players (
          id, direction, league_roster_player_id, sports_player_id,
          snapshot_player_name, snapshot_position, snapshot_team_name
        )
      `)
      .eq('league_id', leagueId)
      .in('status', ['pending', 'accepted', 'rejected', 'canceled', 'expired'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    if (!data) {
      setLoading(false);
      return;
    }

    // Collect all member IDs to resolve team names
    const memberIds = new Set<string>();
    for (const p of data) {
      memberIds.add(p.proposer_member_id);
      memberIds.add(p.receiver_member_id);
    }

    const { data: memberRows } = await supabase
      .from('league_members')
      .select('id, user_id')
      .in('id', Array.from(memberIds));

    const { data: importedRows } = await supabase
      .from('league_imported_members')
      .select('id, invited_user_id, team_name')
      .eq('league_id', leagueId);

    const userIdByMemberId = new Map<string, string | null>();
    for (const lm of memberRows ?? []) {
      userIdByMemberId.set(lm.id, lm.user_id ?? null);
    }

    const teamNameByMemberId = new Map<string, string>();
    for (const lm of memberRows ?? []) {
      const imp = (importedRows ?? []).find(im => im.invited_user_id === lm.user_id);
      if (imp) teamNameByMemberId.set(lm.id, imp.team_name);
    }

    const proposals: TradeProposal[] = data.map(row => ({
      ...row,
      players:            (row.league_trade_proposal_players ?? []) as TradeProposalPlayer[],
      receiver_user_id:   userIdByMemberId.get(row.receiver_member_id) ?? null,
      proposer_team_name: teamNameByMemberId.get(row.proposer_member_id) ?? null,
      receiver_team_name: teamNameByMemberId.get(row.receiver_member_id) ?? null,
    }));

    setPending(proposals.filter(p => p.status === 'pending'));
    setRecent(proposals.filter(p => p.status !== 'pending').slice(0, 10));
    setLoading(false);
  }, [leagueId]);

  useEffect(() => { loadTrades(); }, [loadTrades]);

  function isMyProposal(p: TradeProposal): boolean {
    return p.proposer_user_id === userId;
  }

  function isMyReceiving(p: TradeProposal): boolean {
    return p.receiver_user_id === userId;
  }

  return {
    pending,
    recent,
    loading,
    error,
    loadTrades,
    isMyProposal,
    isMyReceiving,
  };
}
