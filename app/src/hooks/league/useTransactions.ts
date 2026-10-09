import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export interface TransactionRow {
  id:                   string;
  transaction_type:     string;
  actor_user_id:        string | null;
  from_league_member_id: string | null;
  to_league_member_id:   string | null;
  external_player_name: string | null;
  external_position:    string | null;
  trade_proposal_id:    string | null;
  metadata:             Record<string, unknown>;
  created_at:           string;
  league_imported_members: { team_name: string }[] | null;
}

export interface PickTransactionRow {
  id:                  string;
  trade_proposal_id:   string | null;
  actor_user_id:       string | null;
  from_member_id:      string | null;
  to_member_id:        string | null;
  season_year:         number;
  round_number:        number;
  metadata:            Record<string, unknown>;
  created_at:          string;
}

export interface TradeGroup {
  kind:              'trade_group';
  trade_proposal_id: string;
  rows:              TransactionRow[];
  pickRows:          PickTransactionRow[];
  created_at:        string;
}

export type ActivityItem = TransactionRow | TradeGroup;

export function isTradeGroup(item: ActivityItem): item is TradeGroup {
  return (item as TradeGroup).kind === 'trade_group';
}

export function useTransactions(leagueId: string) {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [activity,     setActivity]     = useState<ActivityItem[]>([]);

  const loadTransactions = useCallback(async () => {
    const [playerRes, pickRes] = await Promise.all([
      supabase
        .from('league_roster_transactions')
        .select(`
          id, transaction_type, actor_user_id,
          from_league_member_id, to_league_member_id,
          external_player_name, external_position,
          trade_proposal_id, metadata, created_at,
          league_imported_members!imported_member_id(team_name)
        `)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('league_draft_pick_transactions')
        .select(`
          id, trade_proposal_id, actor_user_id,
          from_member_id, to_member_id,
          season_year, round_number,
          metadata, created_at
        `)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const rows = (playerRes.data as TransactionRow[]) ?? [];
    const pickRows = (pickRes.data as PickTransactionRow[]) ?? [];

    setTransactions(rows);

    // Group trade_accept rows (players + picks) by trade_proposal_id
    const grouped: ActivityItem[] = [];
    const seenProposalIds = new Set<string>();

    for (const row of rows) {
      if (row.transaction_type === 'trade_accept' && row.trade_proposal_id) {
        if (seenProposalIds.has(row.trade_proposal_id)) continue;
        seenProposalIds.add(row.trade_proposal_id);
        const siblings = rows.filter(r => r.trade_proposal_id === row.trade_proposal_id && r.transaction_type === 'trade_accept');
        const pickSiblings = pickRows.filter(pr => pr.trade_proposal_id === row.trade_proposal_id);
        grouped.push({
          kind:              'trade_group',
          trade_proposal_id: row.trade_proposal_id,
          rows:              siblings,
          pickRows:          pickSiblings,
          created_at:        row.created_at,
        });
      } else {
        grouped.push(row);
      }
    }

    // Also add pick-only trade groups that have no player rows (exclude rejects)
    for (const pr of pickRows) {
      if (pr.trade_proposal_id && !seenProposalIds.has(pr.trade_proposal_id) && pr.metadata?.action !== 'reject') {
        seenProposalIds.add(pr.trade_proposal_id);
        const pickSiblings = pickRows.filter(p => p.trade_proposal_id === pr.trade_proposal_id && (!p.metadata?.action || p.metadata.action !== 'reject'));
        if (pickSiblings.length > 0) {
          grouped.push({
            kind:              'trade_group',
            trade_proposal_id: pr.trade_proposal_id,
            rows:              [],
            pickRows:          pickSiblings,
            created_at:        pr.created_at,
          });
        }
      }
    }

    // Sort by created_at descending
    grouped.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime;
    });

    setActivity(grouped);
  }, [leagueId]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  return { transactions, activity, loadTransactions };
}
