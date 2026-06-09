import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export interface TransactionRow {
  id:                   string;
  transaction_type:     string;
  actor_user_id:        string | null;
  external_player_name: string | null;
  external_position:    string | null;
  metadata:             Record<string, unknown>;
  created_at:           string;
  league_imported_members: { team_name: string }[] | null;
}

export function useTransactions(leagueId: string) {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);

  const loadTransactions = useCallback(async () => {
    const { data } = await supabase
      .from('league_roster_transactions')
      .select(`
        id, transaction_type, actor_user_id,
        external_player_name, external_position,
        metadata, created_at,
        league_imported_members!imported_member_id(team_name)
      `)
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setTransactions(data as TransactionRow[]);
  }, [leagueId]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  return { transactions, loadTransactions };
}
