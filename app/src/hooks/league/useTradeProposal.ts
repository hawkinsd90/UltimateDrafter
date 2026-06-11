import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface CreateTradeParams {
  leagueId:         string;
  receiverMemberId: string;
  sendLrpIds:       string[];
  receiveLrpIds:    string[];
  message?:         string;
}

export function useTradeProposal() {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  const createProposal = useCallback(async (params: CreateTradeParams): Promise<string | null> => {
    setSubmitting(true);
    setError('');

    const { data, error: err } = await supabase.rpc('create_player_trade_proposal', {
      p_league_id:          params.leagueId,
      p_receiver_member_id: params.receiverMemberId,
      p_send_lrp_ids:       params.sendLrpIds,
      p_receive_lrp_ids:    params.receiveLrpIds,
      p_message:            params.message ?? null,
    });

    setSubmitting(false);

    if (err) {
      setError(err.message ?? 'Failed to send trade proposal.');
      return null;
    }

    const result = data as { success?: boolean; trade_proposal_id?: string } | null;
    if (!result?.success) {
      setError('Failed to send trade proposal.');
      return null;
    }

    return result.trade_proposal_id ?? null;
  }, []);

  const acceptProposal = useCallback(async (proposalId: string): Promise<boolean> => {
    setSubmitting(true);
    setError('');

    const { data, error: err } = await supabase.rpc('accept_player_trade_proposal', {
      p_trade_proposal_id: proposalId,
    });

    setSubmitting(false);

    if (err) {
      setError(err.message ?? 'Failed to accept trade.');
      return false;
    }

    const result = data as { success?: boolean } | null;
    if (!result?.success) {
      setError('Failed to accept trade.');
      return false;
    }

    return true;
  }, []);

  const rejectProposal = useCallback(async (proposalId: string): Promise<boolean> => {
    setSubmitting(true);
    setError('');

    const { data, error: err } = await supabase.rpc('reject_player_trade_proposal', {
      p_trade_proposal_id: proposalId,
    });

    setSubmitting(false);

    if (err) {
      setError(err.message ?? 'Failed to reject trade.');
      return false;
    }

    const result = data as { success?: boolean } | null;
    return result?.success === true;
  }, []);

  const cancelProposal = useCallback(async (proposalId: string): Promise<boolean> => {
    setSubmitting(true);
    setError('');

    const { data, error: err } = await supabase.rpc('cancel_player_trade_proposal', {
      p_trade_proposal_id: proposalId,
    });

    setSubmitting(false);

    if (err) {
      setError(err.message ?? 'Failed to cancel trade.');
      return false;
    }

    const result = data as { success?: boolean } | null;
    return result?.success === true;
  }, []);

  function clearError() {
    setError('');
  }

  return {
    submitting,
    error,
    clearError,
    createProposal,
    acceptProposal,
    rejectProposal,
    cancelProposal,
  };
}
