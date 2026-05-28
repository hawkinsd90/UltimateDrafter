import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { normalizePhoneToE164, validateE164 } from '../../utils/phone';
import { sendInviteNotification } from '../../utils/notifications';
import ImportedLeaguematesPanel, { type ImportedMember } from './ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';

type LeagueMember = Database['public']['Tables']['league_members']['Row'];
type LeagueInvite = Database['public']['Tables']['league_invites']['Row'];
type Draft = Database['public']['Tables']['drafts']['Row'];

interface Props {
  leagueId: string;
  leagueName: string;
  userId: string;
  isOwner: boolean;
  members: LeagueMember[];
  invites: LeagueInvite[];
  importedMembers: ImportedMember[];
  drafts: Draft[];
  myDraftIds: Set<string>;
  onRefresh: () => void;
}

export default function LeagueMembersTab({
  leagueId, leagueName, userId, isOwner,
  members, invites, importedMembers, drafts, myDraftIds, onRefresh,
}: Props) {
  const [phoneInputs, setPhoneInputs]     = useState<string[]>(['']);
  const [addingPhone, setAddingPhone]     = useState(false);
  const [formError, setFormError]         = useState('');
  const [formSuccess, setFormSuccess]     = useState('');
  const [bannerError, setBannerError]     = useState('');
  const [copiedId, setCopiedId]           = useState<string | null>(null);
  const [resendingId, setResendingId]     = useState<string | null>(null);
  const [resentId, setResentId]           = useState<string | null>(null);

  function normalizeEntry(raw: string): string {
    if (raw.includes('@')) return raw;
    return normalizePhoneToE164(raw) ?? raw;
  }

  async function handleCopyInviteLink() {
    setBannerError('');
    const { data, error } = await supabase
      .from('league_invites')
      .insert({ league_id: leagueId, invited_by: userId })
      .select()
      .single();
    if (error || !data) { setBannerError('Failed to create invite link: ' + (error?.message ?? 'unknown error')); return; }
    const inviteUrl = `${window.location.origin}/leagues/join/${data.id}`;
    await navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopiedId(data.id);
    setTimeout(() => setCopiedId(null), 3000);
    onRefresh();
  }

  async function handleAddMembers(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;
    setAddingPhone(true);
    setFormError('');
    setFormSuccess('');

    const entries = phoneInputs.map(p => p.trim()).filter(Boolean);
    if (entries.length === 0) {
      setFormError('Enter at least one email or phone number.');
      setAddingPhone(false);
      return;
    }

    const normalized = entries.map(normalizeEntry);
    const invalid = normalized.filter(en => !en.includes('@') && !validateE164(en));
    if (invalid.length > 0) {
      setFormError(`Invalid: "${invalid.join(', ')}" — use an email address or a 10-digit US phone number`);
      setAddingPhone(false);
      return;
    }

    // Block inviting people already in the league.
    // Use the server-side RPC which joins auth.users to get actual emails + verified phones.
    const { data: memberContacts } = await supabase.rpc('get_league_member_contacts', { p_league_id: leagueId });
    const memberEmails = new Set<string>();
    const memberPhones = new Set<string>();
    (memberContacts ?? []).forEach((row: { email: string | null; phone_e164: string | null }) => {
      if (row.email) memberEmails.add(row.email.toLowerCase());
      if (row.phone_e164) memberPhones.add(row.phone_e164);
    });

    const alreadyMembers = normalized.filter(en =>
      en.includes('@') ? memberEmails.has(en.toLowerCase()) : memberPhones.has(en)
    );
    if (alreadyMembers.length > 0) {
      setFormError(`Already in this league: ${alreadyMembers.join(', ')}`);
      setAddingPhone(false);
      return;
    }

    // Create all invite records in parallel, then send notifications in parallel
    const results = await Promise.all(normalized.map(async entry => {
      const isEmail = entry.includes('@');
      const payload: Record<string, unknown> = { league_id: leagueId, invited_by: userId };
      if (isEmail) payload.email = entry; else payload.phone_e164 = entry;

      const { data: invite, error: inviteError } = await supabase
        .from('league_invites').insert(payload).select().single();

      if (inviteError || !invite) return { entry, success: false, error: inviteError?.message ?? 'unknown' };

      const inviteUrl = `${window.location.origin}/leagues/join/${invite.id}`;
      const notifRes = await sendInviteNotification({ contact: entry, inviteUrl, leagueName });
      return { entry, success: true, notifError: notifRes.success ? null : notifRes.error };
    }));

    const failures   = results.filter(r => !r.success);
    const successes  = results.filter(r => r.success);
    const notifErrs  = successes.filter(r => r.notifError).map(r => `${r.entry}: ${r.notifError}`);

    if (failures.length > 0) {
      setFormError('Some entries failed: ' + failures.map(r => `${r.entry}: ${r.error}`).join('; '));
    }
    if (successes.length > 0) {
      const note = notifErrs.length > 0 ? ` Note: notification issue — ${notifErrs.join('; ')}` : ' Invite notification sent.';
      setFormSuccess(`Invited ${successes.length} person(s).${note}`);
      setPhoneInputs(['']);
      onRefresh();
    }
    setAddingPhone(false);
  }

  async function handleRemoveMember(memberId: string) {
    const memberToRemove = members.find(m => m.id === memberId);
    const { error } = await supabase.from('league_members').delete().eq('id', memberId);
    if (error) { setBannerError('Failed to remove member: ' + error.message); return; }
    if (memberToRemove?.user_id) {
      await supabase
        .from('league_imported_members')
        .update({ invited_user_id: null, invite_id: null })
        .eq('league_id', leagueId)
        .eq('invited_user_id', memberToRemove.user_id);
    }
    onRefresh();
  }

  async function handleRevokeInvite(inviteId: string) {
    await supabase.from('league_invites').delete().eq('id', inviteId);
    onRefresh();
  }

  async function handleResendInvite(inv: LeagueInvite) {
    const contact = inv.email ?? inv.phone_e164;
    if (!contact) return;
    setResendingId(inv.id);
    const inviteUrl = `${window.location.origin}/leagues/join/${inv.id}`;
    await sendInviteNotification({ contact, inviteUrl, leagueName });
    setResendingId(null);
    setResentId(inv.id);
    setTimeout(() => setResentId(null), 3000);
  }

  const filledCount = phoneInputs.filter(p => p.trim()).length;

  // "Your Team" card — shown to members who claimed an imported team
  const myImportedTeam = importedMembers.find(m => m.invitedUserId === userId);
  const myDraft = myImportedTeam ? drafts.find(d => myDraftIds.has(d.id)) : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: '0' }}>Members ({members.length})</h2>
        {isOwner && (
          <button
            onClick={handleCopyInviteLink}
            style={{ padding: '10px 20px', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', fontSize: '14px' }}
          >
            {copiedId ? 'Link Copied!' : 'Copy Invite Link'}
          </button>
        )}
      </div>

      {bannerError && (
        <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626', marginBottom: '16px' }}>
          {bannerError}
        </div>
      )}

      {isOwner && importedMembers.length > 0 && (
        <ImportedLeaguematesPanel
          importedMembers={importedMembers}
          leagueMembers={members}
          leagueId={leagueId}
          userId={userId}
          leagueName={leagueName}
          invites={invites}
          onInviteSent={onRefresh}
          onError={setBannerError}
        />
      )}

      {isOwner && (
        <div style={{ marginBottom: '24px', padding: '20px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#374151' }}>Add by Phone or Email</h3>
          <p style={{ margin: '0 0 14px 0', fontSize: '14px', color: '#6b7280' }}>
            Enter an email address or a US phone number (e.g. <strong>7343588854</strong>). Add multiple rows to invite several people at once.
          </p>
          {formError && (
            <div style={{ padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#dc2626', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5' }}>
              {formError}
            </div>
          )}
          {formSuccess && (
            <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', color: '#166534', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5', wordBreak: 'break-all' }}>
              {formSuccess}
            </div>
          )}
          <form onSubmit={handleAddMembers}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {phoneInputs.map((val, idx) => {
                const trimmed = val.trim();
                const normalized = (!trimmed || trimmed.includes('@')) ? null : normalizePhoneToE164(trimmed);
                return (
                  <div key={idx}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={val}
                        onChange={e => {
                          const next = [...phoneInputs];
                          next[idx] = e.target.value;
                          setPhoneInputs(next);
                          setFormError('');
                          setFormSuccess('');
                        }}
                        placeholder="email@example.com or 7343588854"
                        style={{ flex: 1, padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px', color: '#111827', background: 'white' }}
                      />
                      {phoneInputs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setPhoneInputs(phoneInputs.filter((_, i) => i !== idx))}
                          style={{ padding: '10px 12px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', color: '#6b7280', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
                          title="Remove"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {normalized && normalized !== trimmed && (
                      <p style={{ margin: '3px 0 0 2px', fontSize: '12px', color: '#059669' }}>
                        Will send SMS to {normalized}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setPhoneInputs([...phoneInputs, ''])}
                style={{ padding: '8px 14px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', color: '#374151', cursor: 'pointer', fontSize: '14px' }}
              >
                + Add Another
              </button>
              <button
                type="submit"
                disabled={addingPhone}
                style={{ padding: '8px 20px', background: addingPhone ? '#9ca3af' : '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: addingPhone ? 'not-allowed' : 'pointer', fontWeight: '500', fontSize: '14px' }}
              >
                {addingPhone ? 'Sending invite...' : `Invite ${filledCount > 1 ? `${filledCount} People` : 'Person'}`}
              </button>
            </div>
          </form>
        </div>
      )}

      {members.length === 0 ? (
        <div style={{ padding: '40px', background: '#f9fafb', border: '2px dashed #d1d5db', borderRadius: '8px', textAlign: 'center' }}>
          <p style={{ margin: '0', color: '#6b7280' }}>
            {isOwner ? 'No members yet. Use the invite link or add by phone number above.' : 'No members yet.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '30px' }}>
          {members.map(m => (
            <div key={m.id} style={{ padding: '14px 18px', border: '1px solid #e5e7eb', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
              <div>
                <span style={{ fontWeight: '500', color: '#111827' }}>{m.display_name || m.phone_e164 || 'Unknown'}</span>
                {m.phone_e164 && m.display_name !== m.phone_e164 && (
                  <span style={{ marginLeft: '10px', fontSize: '13px', color: '#6b7280' }}>{m.phone_e164}</span>
                )}
                <span style={{ marginLeft: '10px', fontSize: '12px', padding: '2px 8px', borderRadius: '9999px', background: m.role === 'owner' ? '#dbeafe' : '#f3f4f6', color: m.role === 'owner' ? '#1d4ed8' : '#374151' }}>
                  {m.role}
                </span>
                {!m.user_id && (
                  <span style={{ marginLeft: '8px', fontSize: '12px', color: '#f59e0b' }}>pending</span>
                )}
              </div>
              {isOwner && (
                <button
                  onClick={() => handleRemoveMember(m.id)}
                  style={{ padding: '6px 12px', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {myImportedTeam && (
        <div style={{ marginBottom: '24px', padding: '16px 20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#0c4a6e' }}>Your Team</h3>
          <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#0369a1' }}>
            You are connected to the <strong>{myImportedTeam.teamName}</strong> team imported from {myImportedTeam.provider?.toUpperCase()}.
          </p>
          {myDraft ? (
            <Link
              to={`/drafts/${myDraft.id}/my-team`}
              style={{ display: 'inline-block', padding: '7px 16px', background: '#0f766e', color: 'white', textDecoration: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600' }}
            >
              View My Roster
            </Link>
          ) : (
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>A roster view will be available once a draft is created for this league.</p>
          )}
        </div>
      )}

      {isOwner && invites.length > 0 && (
        <div>
          <h3 style={{ fontSize: '16px', color: '#374151', marginBottom: '12px' }}>Pending Invites</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {invites.map(inv => {
              const inviteUrl    = `${window.location.origin}/leagues/join/${inv.id}`;
              const contactLabel = inv.email ?? inv.phone_e164 ?? 'General invite';
              const canResend    = !!(inv.email || inv.phone_e164);
              return (
                <div key={inv.id} style={{ padding: '12px 16px', border: '1px solid #e5e7eb', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#fafafa' }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: '13px', color: '#111827', fontWeight: canResend ? '500' : '400' }}>{contactLabel}</span>
                    <span style={{ marginLeft: '10px', fontSize: '12px', color: '#9ca3af' }}>
                      Expires {new Date(inv.expires_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    {canResend && (
                      <button
                        onClick={() => handleResendInvite(inv)}
                        disabled={resendingId === inv.id}
                        style={{ padding: '6px 12px', background: resentId === inv.id ? '#059669' : 'none', border: `1px solid ${resentId === inv.id ? '#059669' : '#0284c7'}`, color: resentId === inv.id ? '#fff' : '#0284c7', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}
                      >
                        {resendingId === inv.id ? 'Sending…' : resentId === inv.id ? 'Sent!' : `Resend ${inv.email ? 'Email' : 'SMS'}`}
                      </button>
                    )}
                    <button
                      onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopiedId(inv.id); setTimeout(() => setCopiedId(null), 3000); }}
                      style={{ padding: '6px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      {copiedId === inv.id ? 'Copied!' : 'Copy Link'}
                    </button>
                    <button
                      onClick={() => handleRevokeInvite(inv.id)}
                      style={{ padding: '6px 12px', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
