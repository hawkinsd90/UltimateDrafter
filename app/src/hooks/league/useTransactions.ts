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

export interface TradeGroup {
  kind:              'trade_group';
  trade_proposal_id: string;
  rows:              TransactionRow[];
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
    const { data } = await supabase
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
      .limit(30);

    if (!data) return;

    const rows = data as TransactionRow[];
    setTransactions(rows);

    // Group trade_accept rows by trade_proposal_id into TradeGroup items
    const grouped: ActivityItem[] = [];
    const seenProposalIds = new Set<string>();

    for (const row of rows) {
      if (row.transaction_type === 'trade_accept' && row.trade_proposal_id) {
        if (seenProposalIds.has(row.trade_proposal_id)) continue;
        seenProposalIds.add(row.trade_proposal_id);
        const siblings = rows.filter(r => r.trade_proposal_id === row.trade_proposal_id && r.transaction_type === 'trade_accept');
        grouped.push({
          kind:              'trade_group',
          trade_proposal_id: row.trade_proposal_id,
          rows:              siblings,
          created_at:        row.created_at,
        });
      } else {
        grouped.push(row);
      }
    }

    setActivity(grouped);
  }, [leagueId]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  return { transactions, activity, loadTransactions };
}
