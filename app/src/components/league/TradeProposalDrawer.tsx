import { useState, useEffect, useCallback } from 'react';
import type { ImportedMember } from './ImportedLeaguematesPanel';
import type { RosterPlayer } from '../../hooks/league/useRosterData';
import type { Database } from '../../types/supabase';
import { posColor } from '../../utils/positionColors';
import { computeTradeWarnings } from '../../utils/tradeWarnings';
import { loadTeamRoster } from '../../utils/loadRoster';
import { useTradeProposal } from '../../hooks/league/useTradeProposal';
import { useConfirm } from '../../hooks/useConfirm';
import ConfirmModal from '../ConfirmModal';

type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];
type LeagueMember   = Database['public']['Tables']['league_members']['Row'];

const overlay       = 'rgba(0,0,0,0.65)';
const drawerBg      = '#0f172a';
const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';
const blue          = '#3b82f6';
const amber         = '#f59e0b';
const green         = '#22c55e';
const red           = '#f87171';

interface PartnerRoster {
  memberId:    string;
  players:     RosterPlayer[];
  loading:     boolean;
  loadError:   string;
  rosterEmpty: boolean;
}

interface Props {
  open:            boolean;
  leagueId:        string;
  userId:          string;
  myMember:        ImportedMember | null;
  joinedMembers:   ImportedMember[];
  leagueMembers:   LeagueMember[];
  myRoster:        RosterPlayer[];
  leagueSettings:  LeagueSettings | null;
  preselectedPartnerId?: string | null;
  onClose:         () => void;
  onProposalSent:  () => void;
}

type Step = 'partner' | 'players' | 'review';

function PlayerSelectRow({
  player, selected, onToggle, disabled,
}: {
  player: RosterPlayer; selected: boolean; onToggle: () => void; disabled: boolean;
}) {
  const c = posColor(player.fantasyPosition);
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
        background: selected ? 'rgba(59,130,246,0.12)' : 'transparent',
        border: `1px solid ${selected ? blue : border}`,
        borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer',
        width: '100%', textAlign: 'left', marginBottom: '4px',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: c.bg, color: c.text, flexShrink: 0 }}>
        {player.fantasyPosition ?? '?'}
      </span>
      <span style={{ fontSize: '13px', fontWeight: '600', color: textPrimary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {player.displayName}
      </span>
      {player.teamAbbr && (
        <span style={{ fontSize: '11px', color: textSecondary, flexShrink: 0 }}>{player.teamAbbr}</span>
      )}
      {selected && (
        <span style={{ color: blue, fontSize: '14px', fontWeight: '700', flexShrink: 0 }}>✓</span>
      )}
    </button>
  );
}

function PartnerRow({
  member, claimedMember, active, onSelect,
}: {
  member: ImportedMember;
  claimedMember: LeagueMember | null;
  active: boolean;
  onSelect: () => void;
}) {
  const providerBadge = member.provider?.toUpperCase() ?? null;
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex', flexDirection: 'column', gap: '3px',
        width: '100%', padding: '10px 14px', marginBottom: '6px',
        background: active ? 'rgba(59,130,246,0.12)' : card,
        border: `1px solid ${active ? blue : border}`,
        borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>{member.teamName}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {providerBadge && (
            <span style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: 'rgba(148,163,184,0.15)', color: textSecondary, letterSpacing: '0.04em' }}>
              {providerBadge}
            </span>
          )}
          {active && <span style={{ color: blue, fontSize: '14px', fontWeight: '700' }}>✓</span>}
        </div>
      </div>
      {claimedMember && (
        <div style={{ fontSize: '11px', color: textSecondary }}>
          Claimed by: {claimedMember.display_name ?? claimedMember.phone_e164 ?? 'unknown'}
        </div>
      )}
      {member.externalOwnerName && member.externalOwnerName !== member.teamName && (
        <div style={{ fontSize: '11px', color: textSecondary }}>
          Imported owner: {member.externalOwnerName}
        </div>
      )}
    </button>
  );
}

export default function TradeProposalDrawer({
  open, leagueId, userId, myMember, joinedMembers, leagueMembers,
  myRoster, leagueSettings, preselectedPartnerId, onClose, onProposalSent,
}: Props) {
  const [step,             setStep]             = useState<Step>('partner');
  const [partnerMemberId,  setPartnerMemberId]  = useState<string | null>(null);
  const [partnerRoster,    setPartnerRoster]    = useState<PartnerRoster | null>(null);
  const [sendIds,          setSendIds]          = useState<Set<string>>(new Set());
  const [receiveIds,       setReceiveIds]       = useState<Set<string>>(new Set());
  const [message,          setMessage]          = useState('');
  const [stepError,        setStepError]        = useState('');

  const { submitting, error: rpcError, clearError, createProposal } = useTradeProposal();
  const { confirm, pending: confirmPending, handleConfirm, handleCancel } = useConfirm();

  const partners = joinedMembers.filter(m => m.invitedUserId !== userId);

  const partnerMember = joinedMembers.find(m => m.id === partnerMemberId) ?? null;
  const partnerLeagueMember = leagueMembers.find(lm => lm.user_id === partnerMember?.invitedUserId) ?? null;

  const sendablePlayers    = myRoster.filter(p => !p.unresolved && !!p.lrpId);
  const receivablePlayers  = partnerRoster?.players.filter(p => !p.unresolved && !!p.lrpId) ?? [];
  const selectedSend       = sendablePlayers.filter(p => sendIds.has(p.id));
  const selectedReceive    = receivablePlayers.filter(p => receiveIds.has(p.id));

  const warnings = computeTradeWarnings(
    myRoster, partnerRoster?.players ?? [],
    selectedSend, selectedReceive,
    leagueSettings,
  );

  const leagueSettingsExt = leagueSettings as (LeagueSettings & {
    allow_pick_trades?: boolean; allow_future_pick_trades?: boolean;
  }) | null;
  const pickTradesEnabled = leagueSettingsExt?.allow_pick_trades ?? false;

  const loadPartnerRoster = useCallback(async (member: ImportedMember) => {
    setPartnerRoster({ memberId: member.id, players: [], loading: true, loadError: '', rosterEmpty: false });
    const result = await loadTeamRoster(member, leagueId);
    setPartnerRoster({
      memberId:    member.id,
      players:     result.players,
      loading:     false,
      loadError:   result.error,
      rosterEmpty: result.rosterEmpty,
    });
  }, [leagueId]);

  // When drawer opens, handle preselected partner
  useEffect(() => {
    if (!open) {
      setStep('partner');
      setPartnerMemberId(null);
      setPartnerRoster(null);
      setSendIds(new Set());
      setReceiveIds(new Set());
      setMessage('');
      setStepError('');
      clearError();
      return;
    }

    if (preselectedPartnerId) {
      const partner = joinedMembers.find(m => m.id === preselectedPartnerId && m.invitedUserId !== userId);
      if (partner) {
        setPartnerMemberId(partner.id);
        setSendIds(new Set());
        setReceiveIds(new Set());
        setStep('players');
        loadPartnerRoster(partner);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSelectPartner(member: ImportedMember) {
    setPartnerMemberId(member.id);
    setSendIds(new Set());
    setReceiveIds(new Set());
    loadPartnerRoster(member);
  }

  function toggleSend(playerId: string) {
    setSendIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId); else next.add(playerId);
      return next;
    });
  }

  function toggleReceive(playerId: string) {
    setReceiveIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId); else next.add(playerId);
      return next;
    });
  }

  function goToPlayers() {
    setStepError('');
    if (!partnerMemberId) { setStepError('Select a trade partner.'); return; }
    setStep('players');
  }

  function goToReview() {
    setStepError('');
    if (sendIds.size === 0) { setStepError('Select at least one player to send.'); return; }
    if (receiveIds.size === 0) {
      if (partnerRoster?.loadError) {
        setStepError('Partner roster failed to load. Try going back and reselecting the partner.');
      } else if (receivablePlayers.length === 0) {
        setStepError('No resolved tradeable players found for this team.');
      } else {
        setStepError('Select at least one player to receive.');
      }
      return;
    }
    setStep('review');
  }

  async function handleSubmit() {
    setStepError('');
    clearError();

    if (!partnerLeagueMember) {
      setStepError('Trade partner has no league account. They must join the league first.');
      return;
    }

    const warningText = warnings.length > 0
      ? '\n\nRoster warnings:\n' + warnings.join('\n')
      : '';

    const ok = await confirm({
      title:        'Send trade proposal?',
      message:      `Send this trade to ${partnerMember?.teamName ?? 'trade partner'}? They will need to accept or reject it.${warningText}`,
      confirmLabel: 'Send Proposal',
    });
    if (!ok) return;

    const sendLrpIds    = selectedSend.map(p => p.lrpId!).filter(Boolean);
    const receiveLrpIds = selectedReceive.map(p => p.lrpId!).filter(Boolean);

    const proposalId = await createProposal({
      leagueId,
      receiverMemberId: partnerLeagueMember.id,
      sendLrpIds,
      receiveLrpIds,
      message: message.trim() || undefined,
    });

    if (proposalId) {
      onProposalSent();
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end', background: overlay }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: '480px', height: '100%', background: drawerBg,
          borderLeft: `1px solid ${border}`, display: 'flex', flexDirection: 'column',
          fontFamily: 'system-ui, sans-serif', overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: textPrimary }}>Propose Trade</div>
            <div style={{ fontSize: '12px', color: textSecondary, marginTop: '2px' }}>
              {step === 'partner' ? 'Step 1: Choose partner' : step === 'players' ? 'Step 2: Select players' : 'Step 3: Review'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: textSecondary, fontSize: '20px', padding: '4px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* Error display */}
          {(stepError || rpcError) && (
            <div style={{ marginBottom: '14px', padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '13px', color: red }}>
              {stepError || rpcError}
            </div>
          )}

          {/* Step 1: Partner selection */}
          {step === 'partner' && (
            <>
              <p style={{ margin: '0 0 14px', fontSize: '13px', color: textSecondary }}>
                Who do you want to trade with?
              </p>
              {partners.length === 0 && (
                <p style={{ color: textSecondary, fontSize: '13px' }}>No other teams available.</p>
              )}
              {partners.map(m => {
                const active = m.id === partnerMemberId;
                const claimedMember = leagueMembers.find(lm => lm.user_id === m.invitedUserId) ?? null;
                return (
                  <PartnerRow
                    key={m.id}
                    member={m}
                    claimedMember={claimedMember}
                    active={active}
                    onSelect={() => handleSelectPartner(m)}
                  />
                );
              })}
            </>
          )}

          {/* Step 2: Player selection */}
          {step === 'players' && (
            <>
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                  Your players to send ({myMember?.teamName ?? 'Your team'})
                </div>
                {sendablePlayers.length === 0 && (
                  <p style={{ color: textSecondary, fontSize: '13px' }}>No resolved players on your roster.</p>
                )}
                {sendablePlayers.map(p => (
                  <PlayerSelectRow
                    key={p.id}
                    player={p}
                    selected={sendIds.has(p.id)}
                    onToggle={() => toggleSend(p.id)}
                    disabled={false}
                  />
                ))}
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                  {partnerMember?.teamName ?? 'Partner'}'s players to receive
                </div>
                {partnerRoster?.loading && (
                  <p style={{ color: textSecondary, fontSize: '13px' }}>Loading roster...</p>
                )}
                {!partnerRoster?.loading && partnerRoster?.loadError && (
                  <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '13px', color: red, marginBottom: '8px' }}>
                    Failed to load roster: {partnerRoster.loadError}
                  </div>
                )}
                {!partnerRoster?.loading && !partnerRoster?.loadError && receivablePlayers.length === 0 && (
                  <p style={{ color: textSecondary, fontSize: '13px' }}>
                    No resolved tradeable players found for this team.
                  </p>
                )}
                {!partnerRoster?.loading && !partnerRoster?.loadError && receivablePlayers.length > 0 && (
                  <>
                    {receivablePlayers.map(p => (
                      <PlayerSelectRow
                        key={p.id}
                        player={p}
                        selected={receiveIds.has(p.id)}
                        onToggle={() => toggleReceive(p.id)}
                        disabled={false}
                      />
                    ))}
                    {partnerRoster!.players.some(p => p.unresolved || !p.lrpId) && (
                      <p style={{ fontSize: '11px', color: textSecondary, marginTop: '8px', fontStyle: 'italic' }}>
                        {partnerRoster!.players.filter(p => p.unresolved || !p.lrpId).length} player(s) without a tradeable roster record hidden from trade selection.
                      </p>
                    )}
                  </>
                )}
              </div>

              {pickTradesEnabled && (
                <div style={{ marginTop: '16px', padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: `1px solid rgba(245,158,11,0.2)`, borderRadius: '8px', fontSize: '12px', color: amber }}>
                  Pick trading is enabled for this league, but pick assets are not included in this player trade phase yet.
                </div>
              )}
            </>
          )}

          {/* Step 3: Review */}
          {step === 'review' && (
            <>
              <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                    You ({myMember?.teamName ?? 'Your team'}) send
                  </div>
                  {selectedSend.map(p => {
                    const c = posColor(p.fantasyPosition);
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: c.bg, color: c.text }}>{p.fantasyPosition ?? '?'}</span>
                        <span style={{ fontSize: '13px', color: textPrimary, fontWeight: '600' }}>{p.displayName}</span>
                        {p.teamAbbr && <span style={{ fontSize: '11px', color: textSecondary }}>{p.teamAbbr}</span>}
                      </div>
                    );
                  })}
                </div>
                <div style={{ borderTop: `1px solid ${border}`, paddingTop: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                    {partnerMember?.teamName ?? 'Partner'} sends
                  </div>
                  {selectedReceive.map(p => {
                    const c = posColor(p.fantasyPosition);
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: c.bg, color: c.text }}>{p.fantasyPosition ?? '?'}</span>
                        <span style={{ fontSize: '13px', color: textPrimary, fontWeight: '600' }}>{p.displayName}</span>
                        {p.teamAbbr && <span style={{ fontSize: '11px', color: textSecondary }}>{p.teamAbbr}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {warnings.length > 0 && (
                <div style={{ background: 'rgba(245,158,11,0.1)', border: `1px solid rgba(245,158,11,0.3)`, borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: amber, marginBottom: '6px' }}>Roster Warnings</div>
                  {warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: '12px', color: '#fcd34d', marginBottom: '3px' }}>• {w}</div>
                  ))}
                  <div style={{ fontSize: '11px', color: textSecondary, marginTop: '6px' }}>
                    Warnings do not block trade submission.
                  </div>
                </div>
              )}

              {pickTradesEnabled && (
                <div style={{ marginBottom: '16px', padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: `1px solid rgba(245,158,11,0.2)`, borderRadius: '8px', fontSize: '12px', color: amber }}>
                  Pick trading is enabled for this league, but pick assets are not included in this player trade phase yet.
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: textSecondary, marginBottom: '6px' }}>
                  Message to trade partner (optional)
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="e.g. Let me know if you want to adjust the deal"
                  maxLength={280}
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px', background: card, border: `1px solid ${border}`,
                    borderRadius: '8px', color: textPrimary, fontSize: '13px', resize: 'vertical',
                    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '16px 20px', borderTop: `1px solid ${border}`, display: 'flex', gap: '10px', flexShrink: 0 }}>
          {step !== 'partner' && (
            <button
              onClick={() => { setStepError(''); setStep(step === 'review' ? 'players' : 'partner'); }}
              style={{
                padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
                cursor: 'pointer', border: `1px solid ${border}`,
                background: 'transparent', color: textSecondary,
              }}
            >
              Back
            </button>
          )}
          <button
            onClick={step === 'partner' ? goToPlayers : step === 'players' ? goToReview : handleSubmit}
            disabled={submitting || (step === 'partner' && !partnerMemberId)}
            style={{
              flex: 1, padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '700',
              cursor: (submitting || (step === 'partner' && !partnerMemberId)) ? 'not-allowed' : 'pointer',
              border: 'none', background: step === 'review' ? green : blue, color: '#fff',
              opacity: (submitting || (step === 'partner' && !partnerMemberId)) ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {submitting ? 'Sending...' : step === 'review' ? 'Send Proposal' : 'Next'}
          </button>
        </div>
      </div>

      {confirmPending && (
        <ConfirmModal
          {...confirmPending.options}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
