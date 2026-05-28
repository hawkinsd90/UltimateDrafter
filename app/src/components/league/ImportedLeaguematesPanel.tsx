import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { normalizePhoneToE164 } from '../../utils/phone';
import { sendInviteNotification } from '../../utils/notifications';
import type { Database } from '../../types/supabase';

type LeagueMember = Database['public']['Tables']['league_members']['Row'];
type LeagueInvite = Database['public']['Tables']['league_invites']['Row'];

export interface ImportedMember {
  id: string;
  externalOwnerName: string | null;
  teamName: string;
  provider: string;
  inviteId: string | null;
  invitedUserId: string | null;
}

interface Props {
  importedMembers: ImportedMember[];
  leagueMembers: LeagueMember[];
  leagueId: string;
  userId: string;
  leagueName: string;
  invites: LeagueInvite[];
  onInviteSent: () => void;
  onError: (msg: string) => void;
}

function normalizeContact(raw: string): { normalized: string; type: 'email' | 'phone' | 'invalid' | 'empty' } {
  const contact = raw.trim();
  if (!contact) return { normalized: '', type: 'empty' };
  if (contact.includes('@')) return { normalized: contact, type: 'email' };
  const e164 = normalizePhoneToE164(contact);
  if (e164) return { normalized: e164, type: 'phone' };
  return { normalized: contact, type: 'invalid' };
}

function MemberNameCell({ member }: { member: ImportedMember }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span style={{ fontWeight: '600', fontSize: '14px', color: '#0c4a6e' }}>{member.teamName}</span>
      {member.externalOwnerName && member.externalOwnerName !== member.teamName && (
        <span style={{ marginLeft: '8px', fontSize: '12px', color: '#64748b' }}>{member.externalOwnerName}</span>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '8px',
  padding: '12px 14px', background: 'white', border: '1px solid #e0f2fe',
  borderRadius: '6px',
};

export default function ImportedLeaguematesPanel({
  importedMembers, leagueMembers, leagueId, userId, leagueName, invites, onInviteSent, onError,
}: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [contactInputs, setContactInputs] = useState<Record<string, string>>({});
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function setContact(memberId: string, val: string) {
    setContactInputs(prev => ({ ...prev, [memberId]: val }));
  }

  async function createInviteRecord(member: ImportedMember, contact: string, type: 'email' | 'phone' | null) {
    const insertPayload: Record<string, unknown> = {
      league_id: leagueId,
      invited_by: userId,
      imported_member_id: member.id,
    };
    if (type === 'email') insertPayload.email = contact;
    if (type === 'phone') insertPayload.phone_e164 = contact;

    const { data: invite, error } = await supabase
      .from('league_invites')
      .insert(insertPayload)
      .select()
      .single();
    if (error || !invite) {
      onError('Failed to create invite: ' + (error?.message ?? 'unknown'));
      return null;
    }
    await supabase.from('league_imported_members').update({ invite_id: invite.id }).eq('id', member.id);
    const inviteUrl = `${window.location.origin}/leagues/join/${invite.id}`;
    return { invite, inviteUrl };
  }

  async function handleCopyLink(member: ImportedMember) {
    const { normalized, type } = normalizeContact(contactInputs[member.id] ?? '');
    if (type === 'invalid') {
      onError(`"${contactInputs[member.id]}" is not a valid email or phone number.`);
      return;
    }
    const result = await createInviteRecord(member, normalized, type === 'empty' ? null : type);
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteUrl).catch(() => {});
    setCopiedId(member.id);
    setTimeout(() => setCopiedId(null), 3000);
    onInviteSent();
  }

  async function handleSend(member: ImportedMember) {
    const { normalized, type } = normalizeContact(contactInputs[member.id] ?? '');
    if (type === 'empty') { onError('Enter an email or phone number before sending.'); return; }
    if (type === 'invalid') { onError(`"${contactInputs[member.id]}" is not a valid email or phone number.`); return; }

    setSendingId(member.id);
    const result = await createInviteRecord(member, normalized, type);
    if (!result) { setSendingId(null); return; }

    const res = await sendInviteNotification({ contact: normalized, inviteUrl: result.inviteUrl, leagueName, teamName: member.teamName });
    setSendingId(null);
    if (!res.success) {
      onError(`Failed to send: ${res.error}`);
    } else {
      setSentId(member.id);
      setTimeout(() => setSentId(null), 4000);
      onInviteSent();
    }
  }

  async function handleResend(member: ImportedMember) {
    if (!member.inviteId) return;
    const invite = invites.find(i => i.id === member.inviteId);
    if (!invite) { onError('Invite not found.'); return; }
    const contact = invite.email ?? invite.phone_e164;
    if (!contact) { onError('No contact info on this invite to resend.'); return; }

    setSendingId(member.id);
    const inviteUrl = `${window.location.origin}/leagues/join/${member.inviteId}`;
    const res = await sendInviteNotification({ contact, inviteUrl, leagueName, teamName: member.teamName });
    setSendingId(null);
    if (!res.success) {
      onError(`Failed to resend: ${res.error}`);
    } else {
      setSentId(member.id);
      setTimeout(() => setSentId(null), 3000);
    }
  }

  async function handleRevoke(member: ImportedMember) {
    if (!member.inviteId) return;
    setRevokingId(member.id);
    await supabase.from('league_invites').delete().eq('id', member.inviteId);
    await supabase.from('league_imported_members').update({ invite_id: null }).eq('id', member.id);
    setRevokingId(null);
    onInviteSent();
  }

  async function handleReassign(importedMemberId: string, newMemberId: string | null) {
    setReassignLoading(true);
    const { error } = await supabase
      .from('league_imported_members')
      .update({ invited_user_id: newMemberId })
      .eq('id', importedMemberId);
    if (error) {
      onError('Failed to reassign: ' + error.message);
    } else {
      setReassigning(null);
      onInviteSent();
    }
    setReassignLoading(false);
  }

  const uninvited = importedMembers.filter(m => !m.inviteId && !m.invitedUserId);
  const invited   = importedMembers.filter(m => m.inviteId && !m.invitedUserId);
  const joined    = importedMembers.filter(m => m.invitedUserId);

  if (uninvited.length === 0 && invited.length === 0 && joined.length === 0) return null;

  return (
    <div style={{ marginBottom: '24px', padding: '20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#0c4a6e' }}>Leaguemates from Import</h3>
      <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: '#0369a1' }}>
        These members were imported from your {importedMembers[0]?.provider?.toUpperCase()} league.
        Enter an email or phone to send a direct invite, or just copy the link. The invite is pre-tied to that team.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {uninvited.map(m => {
          const { normalized: normContact, type: contactType } = normalizeContact(contactInputs[m.id] ?? '');
          const isSending = sendingId === m.id;
          const wasSent   = sentId === m.id;
          const canSend   = contactType === 'email' || contactType === 'phone';
          const sendLabel = isSending ? 'Sending…' : wasSent ? 'Sent!'
            : contactType === 'email' ? 'Send Email'
            : contactType === 'phone' ? 'Send SMS' : 'Send';

          return (
            <div key={m.id} style={rowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <MemberNameCell member={m} />
                <button
                  onClick={() => handleCopyLink(m)}
                  style={{ padding: '5px 12px', background: 'none', color: '#0284c7', border: '1px solid #0284c7', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {copiedId === m.id ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={contactInputs[m.id] ?? ''}
                      onChange={e => setContact(m.id, e.target.value)}
                      placeholder="Email or phone (e.g. 3135551234)"
                      style={{
                        width: '100%', padding: '7px 46px 7px 10px',
                        border: `1px solid ${contactType === 'invalid' ? '#f87171' : '#bae6fd'}`,
                        borderRadius: '5px', fontSize: '13px', color: '#0c4a6e',
                        background: '#f0f9ff', boxSizing: 'border-box',
                      }}
                    />
                    {contactType === 'email' && (
                      <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: '#0284c7', fontWeight: '700', pointerEvents: 'none' }}>EMAIL</span>
                    )}
                    {contactType === 'phone' && (
                      <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: '#059669', fontWeight: '700', pointerEvents: 'none' }}>SMS</span>
                    )}
                  </div>
                  {contactType === 'phone' && normContact !== (contactInputs[m.id] ?? '').trim() && (
                    <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#059669' }}>
                      Will send SMS to {normContact}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleSend(m)}
                  disabled={isSending || wasSent || !canSend}
                  style={{
                    padding: '7px 14px', borderRadius: '5px', fontSize: '13px', fontWeight: '600',
                    whiteSpace: 'nowrap', flexShrink: 0, marginTop: '1px',
                    cursor: (isSending || wasSent || !canSend) ? 'not-allowed' : 'pointer',
                    background: wasSent ? '#059669' : !canSend ? '#e0f2fe' : '#0284c7',
                    color: wasSent ? '#fff' : !canSend ? '#94a3b8' : '#fff',
                    border: 'none', transition: 'background 0.15s',
                  }}
                >
                  {sendLabel}
                </button>
              </div>
            </div>
          );
        })}

        {invited.map(m => {
          const invite       = invites.find(i => i.id === m.inviteId);
          const contactLabel = invite?.email ?? invite?.phone_e164 ?? null;
          const isSending    = sendingId === m.id;
          const wasSent      = sentId === m.id;
          const isRevoking   = revokingId === m.id;
          const canResend    = !!(invite?.email || invite?.phone_e164);
          return (
            <div key={m.id} style={{ ...rowStyle, background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <MemberNameCell member={m} />
                  {contactLabel && (
                    <span style={{ fontSize: '11px', color: '#92400e', display: 'block', marginTop: '2px' }}>{contactLabel}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', color: '#d97706', fontWeight: '600' }}>Invite Sent</span>
                  {canResend && (
                    <button
                      onClick={() => handleResend(m)}
                      disabled={isSending || wasSent}
                      style={{ fontSize: '11px', padding: '3px 8px', background: 'none', border: '1px solid #d97706', color: '#92400e', borderRadius: '4px', cursor: isSending ? 'not-allowed' : 'pointer' }}
                    >
                      {wasSent ? 'Sent!' : isSending ? '...' : 'Resend'}
                    </button>
                  )}
                  <button
                    onClick={() => handleRevoke(m)}
                    disabled={isRevoking}
                    style={{ fontSize: '11px', padding: '3px 8px', background: 'none', border: '1px solid #ef4444', color: '#dc2626', borderRadius: '4px', cursor: isRevoking ? 'not-allowed' : 'pointer' }}
                  >
                    {isRevoking ? '...' : 'Revoke'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {joined.map(m => {
          const claimedMember = leagueMembers.find(lm => lm.user_id === m.invitedUserId);
          return (
            <div key={m.id} style={{ ...rowStyle, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <MemberNameCell member={m} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {claimedMember && (
                    <span style={{ fontSize: '12px', color: '#15803d' }}>{claimedMember.display_name ?? claimedMember.phone_e164 ?? 'Member'}</span>
                  )}
                  <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: '600', whiteSpace: 'nowrap' }}>Joined</span>
                  <button
                    onClick={() => setReassigning(reassigning === m.id ? null : m.id)}
                    style={{ fontSize: '11px', padding: '3px 8px', background: 'none', border: '1px solid #86efac', color: '#166534', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Reassign
                  </button>
                </div>
              </div>
              {reassigning === m.id && (
                <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#166534' }}>
                    Assign this imported team to a different league member:
                  </p>
                  {leagueMembers.map(lm => (
                    <button
                      key={lm.id}
                      disabled={reassignLoading}
                      onClick={() => handleReassign(m.id, lm.user_id)}
                      style={{
                        padding: '6px 12px', borderRadius: '5px', cursor: 'pointer', textAlign: 'left', fontSize: '13px',
                        background: lm.user_id === m.invitedUserId ? '#dcfce7' : 'white',
                        border: `1px solid ${lm.user_id === m.invitedUserId ? '#86efac' : '#d1d5db'}`,
                        color: '#111827',
                      }}
                    >
                      {lm.display_name ?? lm.phone_e164 ?? 'Member'}
                      {lm.role === 'owner' ? ' (owner)' : ''}
                      {lm.user_id === m.invitedUserId ? ' ✓' : ''}
                    </button>
                  ))}
                  <button
                    disabled={reassignLoading}
                    onClick={() => handleReassign(m.id, null)}
                    style={{ padding: '6px 12px', borderRadius: '5px', cursor: 'pointer', textAlign: 'left', fontSize: '13px', background: 'none', border: '1px solid #d1d5db', color: '#6b7280' }}
                  >
                    Unclaim (no one)
                  </button>
                </div>
              )}
            </div>
          );
        })}

      </div>
    </div>
  );
}
