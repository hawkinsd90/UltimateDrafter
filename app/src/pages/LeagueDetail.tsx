import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../types/supabase';

type League = Database['public']['Tables']['leagues']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];
type Draft = Database['public']['Tables']['drafts']['Row'];
type LeagueMember = Database['public']['Tables']['league_members']['Row'];
type LeagueInvite = Database['public']['Tables']['league_invites']['Row'];

type Tab = 'drafts' | 'members' | 'settings';

interface ImportedMember {
  id: string;
  externalOwnerName: string | null;
  teamName: string;
  provider: string;
  inviteId: string | null;
  invitedUserId: string | null;
}

function ImportedLeaguematesPanel({
  importedMembers, leagueMembers, leagueId, userId, leagueName, onInviteSent, onError,
}: {
  importedMembers: ImportedMember[];
  leagueMembers: LeagueMember[];
  leagueId: string;
  userId: string;
  leagueName: string;
  onInviteSent: () => void;
  onError: (msg: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [contactInputs, setContactInputs] = useState<Record<string, string>>({});
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [reassignLoading, setReassignLoading] = useState(false);

  function setContact(memberId: string, val: string) {
    setContactInputs(prev => ({ ...prev, [memberId]: val }));
  }

  function detectContactType(contact: string): 'email' | 'phone' | 'bare_number' | 'invalid' | 'empty' {
    if (!contact) return 'empty';
    if (contact.includes('@')) return 'email';
    if (/^\+[1-9]\d{1,14}$/.test(contact)) return 'phone';
    // Looks like a phone number but missing the + country code prefix
    if (/^\d[\d\s\-().]{6,}$/.test(contact)) return 'bare_number';
    return 'invalid';
  }

  // Creates the invite record and returns { invite, inviteUrl } or null on error
  async function createInviteRecord(member: ImportedMember, contact: string, contactType: 'email' | 'phone' | 'bare_number' | 'empty') {
    const insertPayload: Record<string, unknown> = {
      league_id: leagueId,
      invited_by: userId,
      imported_member_id: member.id,
    };
    if (contactType === 'email') insertPayload.email = contact;
    if (contactType === 'phone') insertPayload.phone_e164 = contact;

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
    const contact = contactInputs[member.id]?.trim() ?? '';
    const contactType = detectContactType(contact);
    if (contactType === 'bare_number') {
      onError(`Phone numbers must include the country code, e.g. +1${contact.replace(/\D/g, '')}`);
      return;
    }
    if (contactType === 'invalid') {
      onError(`"${contact}" is not a valid email or E.164 phone (+12125551234).`);
      return;
    }
    const result = await createInviteRecord(member, contact, contactType);
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteUrl).catch(() => {});
    setCopiedId(member.id);
    setTimeout(() => setCopiedId(null), 3000);
    onInviteSent();
  }

  async function handleSendNotification(member: ImportedMember) {
    const contact = contactInputs[member.id]?.trim() ?? '';
    const contactType = detectContactType(contact);

    if (contactType === 'empty') {
      onError('Enter an email or phone number before sending.');
      return;
    }
    if (contactType === 'bare_number') {
      onError(`Phone numbers must include the country code, e.g. +1${contact.replace(/\D/g, '')}`);
      return;
    }
    if (contactType === 'invalid') {
      onError(`"${contact}" is not a valid email or E.164 phone (+12125551234).`);
      return;
    }

    setSendingId(member.id);
    const result = await createInviteRecord(member, contact, contactType);
    if (!result) { setSendingId(null); return; }

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { onError('Not authenticated'); setSendingId(null); return; }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const fnSlug = contactType === 'email' ? 'send-invite-email' : 'send-invite-sms';
    const body = contactType === 'email'
      ? { email: contact, inviteUrl: result.inviteUrl, leagueName, teamName: member.teamName }
      : { phone: contact, inviteUrl: result.inviteUrl, leagueName, teamName: member.teamName };

    const resp = await fetch(`${supabaseUrl}/functions/v1/${fnSlug}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();

    setSendingId(null);
    if (!data.success) {
      onError(`Failed to send ${contactType === 'email' ? 'email' : 'SMS'}: ${data.error}`);
    } else {
      setSentId(member.id);
      setTimeout(() => setSentId(null), 4000);
      onInviteSent();
    }
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
  const invited = importedMembers.filter(m => m.inviteId && !m.invitedUserId);
  const joined = importedMembers.filter(m => m.invitedUserId);

  if (uninvited.length === 0 && invited.length === 0 && joined.length === 0) return null;

  const rowStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '8px',
    padding: '12px 14px', background: 'white', border: '1px solid #e0f2fe',
    borderRadius: '6px',
  };

  return (
    <div style={{ marginBottom: '24px', padding: '20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#0c4a6e' }}>Leaguemates from Import</h3>
      <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: '#0369a1' }}>
        These members were imported from your {importedMembers[0]?.provider?.toUpperCase()} league.
        Enter an email or phone to send a direct invite, or just copy the link. The invite is pre-tied to that team.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {uninvited.map(m => {
          const contact = contactInputs[m.id]?.trim() ?? '';
          const contactType = detectContactType(contact);
          const isSending = sendingId === m.id;
          const wasSent = sentId === m.id;
          const canSend = contactType === 'email' || contactType === 'phone';
          const sendLabel = isSending ? 'Sending…'
            : wasSent ? 'Sent!'
            : contactType === 'email' ? 'Send Email'
            : contactType === 'phone' ? 'Send SMS'
            : 'Send';

          return (
            <div key={m.id} style={rowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: '600', fontSize: '14px', color: '#0c4a6e' }}>{m.teamName}</span>
                  {m.externalOwnerName && m.externalOwnerName !== m.teamName && (
                    <span style={{ marginLeft: '8px', fontSize: '12px', color: '#64748b' }}>{m.externalOwnerName}</span>
                  )}
                </div>
                <button
                  onClick={() => handleCopyLink(m)}
                  style={{ padding: '5px 12px', background: 'none', color: '#0284c7', border: '1px solid #0284c7', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {copiedId === m.id ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
              {/* Contact input + Send button */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={contactInputs[m.id] ?? ''}
                      onChange={e => setContact(m.id, e.target.value)}
                      placeholder="Email or phone (+12125551234)"
                      style={{
                        width: '100%', padding: '7px 46px 7px 10px',
                        border: `1px solid ${contactType === 'invalid' || contactType === 'bare_number' ? '#f87171' : '#bae6fd'}`,
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
                  {contactType === 'bare_number' && (
                    <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#dc2626' }}>
                      Add country code: +1{contact.replace(/\D/g, '')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleSendNotification(m)}
                  disabled={isSending || wasSent || !canSend}
                  style={{
                    padding: '7px 14px', borderRadius: '5px', fontSize: '13px', fontWeight: '600',
                    whiteSpace: 'nowrap', flexShrink: 0, marginTop: '1px',
                    cursor: (isSending || wasSent || !canSend) ? 'not-allowed' : 'pointer',
                    background: wasSent ? '#059669' : !canSend ? '#e0f2fe' : '#0284c7',
                    color: wasSent ? '#fff' : !canSend ? '#94a3b8' : '#fff',
                    border: 'none',
                    transition: 'background 0.15s',
                  }}
                >
                  {sendLabel}
                </button>
              </div>
            </div>
          );
        })}

        {invited.map(m => (
          <div key={m.id} style={{ ...rowStyle, opacity: 0.8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: '600', fontSize: '14px', color: '#0c4a6e' }}>{m.teamName}</span>
                {m.externalOwnerName && m.externalOwnerName !== m.teamName && (
                  <span style={{ marginLeft: '8px', fontSize: '12px', color: '#64748b' }}>{m.externalOwnerName}</span>
                )}
              </div>
              <span style={{ fontSize: '12px', color: '#d97706', fontWeight: '600', whiteSpace: 'nowrap' }}>Invite Sent</span>
            </div>
          </div>
        ))}

        {joined.map(m => {
          const claimedMember = leagueMembers.find(lm => lm.user_id === m.invitedUserId);
          return (
            <div key={m.id} style={{ ...rowStyle, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: '600', fontSize: '14px', color: '#0c4a6e' }}>{m.teamName}</span>
                  {m.externalOwnerName && m.externalOwnerName !== m.teamName && (
                    <span style={{ marginLeft: '8px', fontSize: '12px', color: '#64748b' }}>{m.externalOwnerName}</span>
                  )}
                </div>
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

export default function LeagueDetail() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { user } = useAuth();

  const [league, setLeague] = useState<League | null>(null);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [invites, setInvites] = useState<LeagueInvite[]>([]);
  const [myDraftIds, setMyDraftIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('drafts');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // members tab state
  const [phoneInputs, setPhoneInputs] = useState<string[]>(['']);
  const [addingPhone, setAddingPhone] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [memberSuccess, setMemberSuccess] = useState('');
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  // inline error/success for the Add by Phone/Email form (visible without scrolling)
  const [addFormError, setAddFormError] = useState('');
  const [addFormSuccess, setAddFormSuccess] = useState('');

  // imported members from external league (Sleeper/ESPN)
  const [importedMembers, setImportedMembers] = useState<{
    id: string;
    externalOwnerName: string | null;
    teamName: string;
    provider: string;
    inviteId: string | null;
    invitedUserId: string | null;
  }[]>([]);

  const [formData, setFormData] = useState({
    draft_format: 'snake',
    pick_timer_seconds: 90,
    allow_pauses: true,
    drafting_hours_enabled: false,
    drafting_hours_start: '',
    drafting_hours_end: '',
    roster_qb: 1,
    roster_rb: 2,
    roster_wr: 2,
    roster_te: 1,
    roster_flex: 1,
    roster_k: 1,
    roster_dst: 1,
    bench: 6,
    allow_trades: true,
    allow_pick_trades: true,
  });

  useEffect(() => {
    if (leagueId) {
      loadLeagueData();
    }
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`league-${leagueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_members', filter: `league_id=eq.${leagueId}` }, () => {
        loadLeagueData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_invites', filter: `league_id=eq.${leagueId}` }, () => {
        loadLeagueData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_imported_members', filter: `league_id=eq.${leagueId}` }, () => {
        loadLeagueData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leagueId]);

  useEffect(() => {
    if (leagueSettings) {
      setFormData({
        draft_format: leagueSettings.draft_format,
        pick_timer_seconds: leagueSettings.pick_timer_seconds,
        allow_pauses: leagueSettings.allow_pauses,
        drafting_hours_enabled: leagueSettings.drafting_hours_enabled,
        drafting_hours_start: leagueSettings.drafting_hours_start || '',
        drafting_hours_end: leagueSettings.drafting_hours_end || '',
        roster_qb: leagueSettings.roster_qb,
        roster_rb: leagueSettings.roster_rb,
        roster_wr: leagueSettings.roster_wr,
        roster_te: leagueSettings.roster_te,
        roster_flex: leagueSettings.roster_flex,
        roster_k: leagueSettings.roster_k,
        roster_dst: leagueSettings.roster_dst,
        bench: leagueSettings.bench,
        allow_trades: leagueSettings.allow_trades,
        allow_pick_trades: leagueSettings.allow_pick_trades,
      });
    }
  }, [leagueSettings]);

  async function loadLeagueData() {
    try {
      const [leagueResult, settingsResult, draftsResult, membersResult, invitesResult, importedResult] = await Promise.all([
        supabase.from('leagues').select('*').eq('id', leagueId).maybeSingle(),
        supabase.from('league_settings').select('*').eq('league_id', leagueId).maybeSingle(),
        supabase.from('drafts').select('*').eq('league_id', leagueId).order('created_at', { ascending: false }),
        supabase.from('league_members').select('*').eq('league_id', leagueId).order('joined_at', { ascending: true }),
        supabase.from('league_invites').select('*').eq('league_id', leagueId).is('accepted_at', null).order('created_at', { ascending: false }),
        supabase.from('league_imported_members').select('id, external_owner_name, team_name, provider, invite_id, invited_user_id').eq('league_id', leagueId).order('created_at', { ascending: true }),
      ]);

      if (leagueResult.error) {
        console.error('Error loading league:', leagueResult.error);
        setMessage('Error loading league');
      } else if (!leagueResult.data) {
        setMessage('League not found');
      } else {
        setLeague(leagueResult.data);
      }

      if (!settingsResult.error && settingsResult.data) {
        setLeagueSettings(settingsResult.data);
      }
      if (!draftsResult.error && draftsResult.data) {
        setDrafts(draftsResult.data);
        // Find which of these drafts the current user is a participant in
        if (draftsResult.data.length > 0) {
          const draftIds = draftsResult.data.map(d => d.id);
          const { data: participantRows } = await supabase
            .from('draft_participants')
            .select('draft_id')
            .in('draft_id', draftIds)
            .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '');
          if (participantRows) {
            setMyDraftIds(new Set(participantRows.map(r => r.draft_id)));
          }
        }
      }
      if (!membersResult.error && membersResult.data) {
        setMembers(membersResult.data);
      }
      if (!invitesResult.error && invitesResult.data) {
        setInvites(invitesResult.data);
      }
      if (!importedResult.error && importedResult.data) {
        setImportedMembers(importedResult.data.map(r => ({
          id: r.id,
          externalOwnerName: r.external_owner_name,
          teamName: r.team_name,
          provider: r.provider,
          inviteId: r.invite_id,
          invitedUserId: r.invited_user_id,
        })));
      }
    } catch (error) {
      console.error('Error loading league data:', error);
      setMessage('Error loading league data');
    } finally {
      setLoading(false);
    }
  }

  async function createInviteLink() {
    if (!leagueId || !user) return;
    setMemberError('');
    const { data, error } = await supabase
      .from('league_invites')
      .insert({ league_id: leagueId, invited_by: user.id })
      .select()
      .single();
    if (error || !data) {
      setMemberError('Failed to create invite link: ' + (error?.message ?? 'unknown error'));
      return;
    }
    const inviteUrl = `${window.location.origin}/leagues/join/${data.id}`;
    await navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopiedInviteId(data.id);
    setTimeout(() => setCopiedInviteId(null), 3000);
    await loadLeagueData();
  }

  async function addMemberByPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!leagueId || !user || !league) return;
    setAddingPhone(true);
    setAddFormError('');
    setAddFormSuccess('');
    setMemberError('');
    setMemberSuccess('');

    const entries = phoneInputs.map(p => p.trim()).filter(Boolean);
    if (entries.length === 0) {
      setAddFormError('Enter at least one email or phone number.');
      setAddingPhone(false);
      return;
    }

    // Normalize entries: bare 10-digit or 11-digit US numbers get +1 prefix
    const normalized = entries.map(en => {
      if (en.includes('@')) return en;
      return normalizePhone(en);
    });

    const invalid = normalized.filter(en => !en.includes('@') && !en.match(/^\+[1-9]\d{1,14}$/));
    if (invalid.length > 0) {
      setAddFormError(`Invalid: "${invalid.join(', ')}" — use an email address or a 10-digit US phone number`);
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
    // Also add the owner's own email/phone (they are always a member even if no league_members row)
    if (user.email) memberEmails.add(user.email.toLowerCase());

    const alreadyMembers = normalized.filter(en => {
      if (en.includes('@')) return memberEmails.has(en.toLowerCase());
      return memberPhones.has(en);
    });
    if (alreadyMembers.length > 0) {
      setAddFormError(`Already in this league: ${alreadyMembers.join(', ')}`);
      setAddingPhone(false);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

    const inviteLinks: string[] = [];
    const errors: string[] = [];
    const notifErrors: string[] = [];

    for (const entry of normalized) {
      const isEmail = entry.includes('@');
      const invitePayload: Record<string, unknown> = { league_id: leagueId, invited_by: user.id };
      if (isEmail) invitePayload.email = entry;
      else invitePayload.phone_e164 = entry;

      const { data: invite, error: inviteError } = await supabase
        .from('league_invites')
        .insert(invitePayload)
        .select()
        .single();

      if (inviteError || !invite) {
        errors.push(`${entry}: ${inviteError?.message ?? 'unknown'}`);
        continue;
      }

      const inviteUrl = `${window.location.origin}/leagues/join/${invite.id}`;
      inviteLinks.push(inviteUrl);

      if (token) {
        const fnSlug = isEmail ? 'send-invite-email' : 'send-invite-sms';
        const body = isEmail
          ? { email: entry, inviteUrl, leagueName: league.name }
          : { phone: entry, inviteUrl, leagueName: league.name };

        const resp = await fetch(`${supabaseUrl}/functions/v1/${fnSlug}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!data.success) {
          notifErrors.push(`${entry}: ${data.error}`);
        }
      }
    }

    if (errors.length > 0) {
      setAddFormError('Some entries failed: ' + errors.join('; '));
    }
    if (inviteLinks.length > 0) {
      const notifNote = notifErrors.length > 0
        ? ` Note: notification delivery issue — ${notifErrors.join('; ')}`
        : ' Invite notification sent.';
      setAddFormSuccess(`Invited ${inviteLinks.length} person(s).${notifNote}`);
      setPhoneInputs(['']);
      await loadLeagueData();
    }
    setAddingPhone(false);
  }

  async function removeMember(memberId: string) {
    // Find the user_id before deleting so we can unclaim imported teams
    const memberToRemove = members.find(m => m.id === memberId);
    const { error } = await supabase.from('league_members').delete().eq('id', memberId);
    if (error) {
      setMemberError('Failed to remove member: ' + error.message);
      return;
    }
    // Clear invited_user_id on any imported team that was claimed by this user
    if (memberToRemove?.user_id) {
      await supabase
        .from('league_imported_members')
        .update({ invited_user_id: null, invite_id: null })
        .eq('league_id', leagueId!)
        .eq('invited_user_id', memberToRemove.user_id);
    }
    await loadLeagueData();
  }

  async function pauseDraft(draftId: string) {
    await supabase.from('drafts').update({ status: 'paused' }).eq('id', draftId);
    await loadLeagueData();
  }

  async function resumeDraft(draftId: string) {
    await supabase.from('drafts').update({ status: 'in_progress' }).eq('id', draftId);
    await loadLeagueData();
  }

  async function deleteDraft(draftId: string, draftName: string) {
    if (!window.confirm(`Delete draft "${draftName}"? This cannot be undone.`)) return;
    await supabase.from('drafts').delete().eq('id', draftId);
    await loadLeagueData();
  }

  async function revokeInvite(inviteId: string) {
    const { error } = await supabase.from('league_invites').delete().eq('id', inviteId);
    if (!error) await loadLeagueData();
  }

  // Normalizes US phone input: "7343588854" or "17343588854" → "+17343588854"
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (raw.startsWith('+')) return raw; // already E.164
    return raw; // pass through for validation to catch
  }

  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const [resentInviteId, setResentInviteId] = useState<string | null>(null);

  async function resendInvite(inv: LeagueInvite) {
    if (!league) return;
    setResendingInviteId(inv.id);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const inviteUrl = `${window.location.origin}/leagues/join/${inv.id}`;

    if (inv.email && token) {
      await fetch(`${supabaseUrl}/functions/v1/send-invite-email`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inv.email, inviteUrl, leagueName: league.name }),
      });
    } else if (inv.phone_e164 && token) {
      await fetch(`${supabaseUrl}/functions/v1/send-invite-sms`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: inv.phone_e164, inviteUrl, leagueName: league.name }),
      });
    }
    setResendingInviteId(null);
    setResentInviteId(inv.id);
    setTimeout(() => setResentInviteId(null), 3000);
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();

    if (!user || !league || league.owner_id !== user.id) {
      setMessage('Only the league owner can update settings');
      return;
    }

    if (formData.drafting_hours_enabled && (!formData.drafting_hours_start || !formData.drafting_hours_end)) {
      setMessage('Please provide both start and end times for drafting hours');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const { error } = await supabase
        .from('league_settings')
        .update({
          draft_format: formData.draft_format,
          pick_timer_seconds: formData.pick_timer_seconds,
          allow_pauses: formData.allow_pauses,
          drafting_hours_enabled: formData.drafting_hours_enabled,
          drafting_hours_start: formData.drafting_hours_enabled ? formData.drafting_hours_start : null,
          drafting_hours_end: formData.drafting_hours_enabled ? formData.drafting_hours_end : null,
          roster_qb: formData.roster_qb,
          roster_rb: formData.roster_rb,
          roster_wr: formData.roster_wr,
          roster_te: formData.roster_te,
          roster_flex: formData.roster_flex,
          roster_k: formData.roster_k,
          roster_dst: formData.roster_dst,
          bench: formData.bench,
          allow_trades: formData.allow_trades,
          allow_pick_trades: formData.allow_pick_trades,
        })
        .eq('league_id', leagueId);

      if (error) {
        console.error('Error updating settings:', error);
        setMessage('Error updating settings: ' + error.message);
      } else {
        setMessage('Settings updated successfully');
        await loadLeagueData();
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  }

  const isOwner = user && league && league.owner_id === user.id;

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!league) {
    return (
      <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <p style={{ marginTop: '20px', color: '#ef4444' }}>{message || 'League not found'}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '12px', flexWrap: 'nowrap', minWidth: 0 }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <UserMenu />
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 10px 0' }}>{league.name}</h1>
        <p style={{ margin: '0', color: '#6b7280', fontSize: '16px' }}>
          {league.sport} - {league.season}
        </p>
        <p style={{ margin: '5px 0 0 0', color: '#9ca3af', fontSize: '14px' }}>
          Created {new Date(league.created_at).toLocaleDateString()}
        </p>
      </div>

      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '30px' }}>
        <div style={{ display: 'flex', gap: '30px' }}>
          <button
            onClick={() => setActiveTab('drafts')}
            style={{
              background: 'none',
              border: 'none',
              padding: '10px 0',
              fontSize: '16px',
              fontWeight: activeTab === 'drafts' ? '600' : '400',
              color: activeTab === 'drafts' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'drafts' ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Drafts
          </button>
          <button
            onClick={() => setActiveTab('members')}
            style={{
              background: 'none',
              border: 'none',
              padding: '10px 0',
              fontSize: '16px',
              fontWeight: activeTab === 'members' ? '600' : '400',
              color: activeTab === 'members' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'members' ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Members
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              background: 'none',
              border: 'none',
              padding: '10px 0',
              fontSize: '16px',
              fontWeight: activeTab === 'settings' ? '600' : '400',
              color: activeTab === 'settings' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'settings' ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Settings
          </button>
        </div>
      </div>

      {activeTab === 'drafts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: '0' }}>Drafts</h2>
            {isOwner && (
              <Link
                to={`/leagues/${league.id}/drafts/create`}
                style={{
                  display: 'inline-block',
                  padding: '10px 20px',
                  background: '#059669',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Create New Draft
              </Link>
            )}
          </div>

          {drafts.length === 0 ? (
            <div style={{
              padding: '40px',
              background: '#f9fafb',
              border: '2px dashed #d1d5db',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#374151' }}>No Drafts Yet</h3>
              <p style={{ margin: '0 0 20px 0', color: '#6b7280' }}>
                Create your first draft to start selecting players for your fantasy team.
              </p>
              {isOwner && (
                <Link
                  to={`/leagues/${league.id}/drafts/create`}
                  style={{
                    display: 'inline-block',
                    padding: '12px 24px',
                    background: '#059669',
                    color: 'white',
                    textDecoration: 'none',
                    borderRadius: '6px',
                    fontWeight: '500'
                  }}
                >
                  Create Your First Draft
                </Link>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {drafts.map(draft => (
                <div key={draft.id} style={{
                  padding: '20px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <h3 style={{ margin: '0 0 5px 0' }}>{draft.name}</h3>
                    <p style={{ margin: '0', color: '#6b7280', fontSize: '14px' }}>
                      Status: {draft.status.replace('_', ' ')} • Type: {draft.draft_type}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {isOwner && draft.status === 'in_progress' && (
                      <button
                        onClick={() => pauseDraft(draft.id)}
                        style={{ padding: '8px 14px', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}
                      >
                        Pause
                      </button>
                    )}
                    {isOwner && draft.status === 'paused' && (
                      <button
                        onClick={() => resumeDraft(draft.id)}
                        style={{ padding: '8px 14px', background: '#f0fdf4', color: '#166534', border: '1px solid #86efac', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}
                      >
                        Resume
                      </button>
                    )}
                    <Link
                      to={`/drafts/${draft.id}/participants`}
                      style={{ padding: '8px 14px', background: '#f3f4f6', color: '#374151', textDecoration: 'none', borderRadius: '6px', fontSize: '14px' }}
                    >
                      Manage Participants
                    </Link>
                    <Link
                      to={`/drafts/${draft.id}`}
                      style={{ padding: '8px 14px', background: '#2563eb', color: 'white', textDecoration: 'none', borderRadius: '6px', fontSize: '14px' }}
                    >
                      View Draft
                    </Link>
                    {myDraftIds.has(draft.id) && (
                      <Link
                        to={`/drafts/${draft.id}/my-team`}
                        style={{ padding: '8px 14px', background: '#0f766e', color: 'white', textDecoration: 'none', borderRadius: '6px', fontSize: '14px' }}
                      >
                        My Team
                      </Link>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => deleteDraft(draft.id, draft.name)}
                        style={{ padding: '8px 14px', background: 'none', color: '#dc2626', border: '1px solid #dc2626', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: '0' }}>Members ({members.length})</h2>
            {isOwner && (
              <button
                onClick={createInviteLink}
                style={{
                  padding: '10px 20px',
                  background: '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '14px',
                }}
              >
                {copiedInviteId ? 'Link Copied!' : 'Copy Invite Link'}
              </button>
            )}
          </div>

          {memberError && (
            <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626', marginBottom: '16px' }}>
              {memberError}
            </div>
          )}
          {memberSuccess && (
            <div style={{ padding: '12px', background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: '6px', color: '#166534', marginBottom: '16px', wordBreak: 'break-all' }}>
              {memberSuccess}
            </div>
          )}

          {isOwner && importedMembers.length > 0 && (
            <ImportedLeaguematesPanel
              importedMembers={importedMembers}
              leagueMembers={members}
              leagueId={leagueId!}
              userId={user!.id}
              leagueName={league.name}
              onInviteSent={loadLeagueData}
              onError={setMemberError}
            />
          )}

          {isOwner && (
            <div style={{ marginBottom: '24px', padding: '20px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#374151' }}>Add by Phone or Email</h3>
              <p style={{ margin: '0 0 14px 0', fontSize: '14px', color: '#6b7280' }}>
                Enter an email address or a US phone number (e.g. <strong>7343588854</strong>). Add multiple rows to invite several people at once.
              </p>
              {addFormError && (
                <div style={{ padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#dc2626', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5' }}>
                  {addFormError}
                </div>
              )}
              {addFormSuccess && (
                <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', color: '#166534', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5', wordBreak: 'break-all' }}>
                  {addFormSuccess}
                </div>
              )}
              <form onSubmit={addMemberByPhone}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                  {phoneInputs.map((val, idx) => {
                    const trimmed = val.trim();
                    const looksLikePhone = trimmed && !trimmed.includes('@') && /^\d[\d\s\-().]{6,}$/.test(trimmed);
                    const normalized = looksLikePhone ? normalizePhone(trimmed) : null;
                    return (
                      <div key={idx}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="text"
                            value={val}
                            onChange={(e) => {
                              const next = [...phoneInputs];
                              next[idx] = e.target.value;
                              setPhoneInputs(next);
                              setAddFormError('');
                              setAddFormSuccess('');
                            }}
                            placeholder="email@example.com or 7343588854"
                            style={{
                              flex: 1, padding: '10px',
                              border: `1px solid #d1d5db`,
                              borderRadius: '6px', color: '#111827', background: 'white',
                            }}
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
                        {normalized && (
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
                    style={{
                      padding: '8px 20px',
                      background: addingPhone ? '#9ca3af' : '#2563eb',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: addingPhone ? 'not-allowed' : 'pointer',
                      fontWeight: '500',
                      fontSize: '14px',
                    }}
                  >
                    {addingPhone ? 'Sending invite...' : `Invite ${phoneInputs.filter(p => p.trim()).length > 1 ? `${phoneInputs.filter(p => p.trim()).length} People` : 'Person'}`}
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
                <div key={m.id} style={{
                  padding: '14px 18px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'white',
                }}>
                  <div>
                    <span style={{ fontWeight: '500', color: '#111827' }}>{m.display_name || m.phone_e164 || 'Unknown'}</span>
                    {m.phone_e164 && m.display_name !== m.phone_e164 && (
                      <span style={{ marginLeft: '10px', fontSize: '13px', color: '#6b7280' }}>{m.phone_e164}</span>
                    )}
                    <span style={{
                      marginLeft: '10px',
                      fontSize: '12px',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      background: m.role === 'owner' ? '#dbeafe' : '#f3f4f6',
                      color: m.role === 'owner' ? '#1d4ed8' : '#374151',
                    }}>
                      {m.role}
                    </span>
                    {!m.user_id && (
                      <span style={{ marginLeft: '8px', fontSize: '12px', color: '#f59e0b' }}>pending</span>
                    )}
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => removeMember(m.id)}
                      title={m.user_id === user?.id ? 'Remove yourself (you remain the commissioner)' : undefined}
                      style={{ padding: '6px 12px', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isOwner && invites.filter(i => !i.accepted_at).length > 0 && (
            <div>
              <h3 style={{ fontSize: '16px', color: '#374151', marginBottom: '12px' }}>Pending Invites</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {invites.filter(i => !i.accepted_at).map(inv => {
                  const inviteUrl = `${window.location.origin}/leagues/join/${inv.id}`;
                  const contactLabel = inv.email
                    ? inv.email
                    : inv.phone_e164
                    ? inv.phone_e164
                    : 'General invite';
                  const canResend = !!(inv.email || inv.phone_e164);
                  return (
                    <div key={inv.id} style={{
                      padding: '12px 16px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                      background: '#fafafa',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: '13px', color: '#111827', fontWeight: canResend ? '500' : '400' }}>
                          {contactLabel}
                        </span>
                        <span style={{ marginLeft: '10px', fontSize: '12px', color: '#9ca3af' }}>
                          Expires {new Date(inv.expires_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        {canResend && (
                          <button
                            onClick={() => resendInvite(inv)}
                            disabled={resendingInviteId === inv.id}
                            style={{
                              padding: '6px 12px',
                              background: resentInviteId === inv.id ? '#059669' : 'none',
                              border: `1px solid ${resentInviteId === inv.id ? '#059669' : '#0284c7'}`,
                              color: resentInviteId === inv.id ? '#fff' : '#0284c7',
                              borderRadius: '6px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap',
                            }}
                          >
                            {resendingInviteId === inv.id ? 'Sending…' : resentInviteId === inv.id ? 'Sent!' : `Resend ${inv.email ? 'Email' : 'SMS'}`}
                          </button>
                        )}
                        <button
                          onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopiedInviteId(inv.id); setTimeout(() => setCopiedInviteId(null), 3000); }}
                          style={{ padding: '6px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                        >
                          {copiedInviteId === inv.id ? 'Copied!' : 'Copy Link'}
                        </button>
                        <button
                          onClick={() => revokeInvite(inv.id)}
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
      )}

      {activeTab === 'settings' && (
        <div>
          <h2 style={{ margin: '0 0 20px 0' }}>League Settings</h2>

          {!leagueSettings ? (
            <div style={{
              padding: '40px',
              background: '#fef3c7',
              border: '1px solid #fbbf24',
              borderRadius: '8px'
            }}>
              <p style={{ margin: '0', color: '#92400e' }}>
                No settings configured for this league. Settings are created when the league is created.
              </p>
            </div>
          ) : !isOwner ? (
            <div>
              <div style={{
                padding: '20px',
                background: '#f3f4f6',
                borderRadius: '8px',
                marginBottom: '20px'
              }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#6b7280' }}>
                  You are viewing settings in read-only mode. Only the league owner can edit settings.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                <div>
                  <h3 style={{ marginTop: '0' }}>Draft Settings</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div>
                      <strong>Draft Format:</strong> {leagueSettings.draft_format}
                    </div>
                    <div>
                      <strong>Pick Timer:</strong> {leagueSettings.pick_timer_seconds === 0 ? 'Unlimited' : `${leagueSettings.pick_timer_seconds} seconds`}
                    </div>
                    <div>
                      <strong>Allow Pauses:</strong> {leagueSettings.allow_pauses ? 'Yes' : 'No'}
                    </div>
                    <div>
                      <strong>Drafting Hours:</strong> {leagueSettings.drafting_hours_enabled ? `${leagueSettings.drafting_hours_start} - ${leagueSettings.drafting_hours_end}` : 'Not restricted'}
                    </div>
                  </div>

                  <h3>Roster Settings</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div><strong>QB:</strong> {leagueSettings.roster_qb}</div>
                    <div><strong>RB:</strong> {leagueSettings.roster_rb}</div>
                    <div><strong>WR:</strong> {leagueSettings.roster_wr}</div>
                    <div><strong>TE:</strong> {leagueSettings.roster_te}</div>
                    <div><strong>FLEX:</strong> {leagueSettings.roster_flex}</div>
                    <div><strong>K:</strong> {leagueSettings.roster_k}</div>
                    <div><strong>DST:</strong> {leagueSettings.roster_dst}</div>
                    <div><strong>Bench:</strong> {leagueSettings.bench}</div>
                  </div>
                </div>

                <div>
                  <h3 style={{ marginTop: '0' }}>League Behavior</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div>
                      <strong>Allow Trades:</strong> {leagueSettings.allow_trades ? 'Yes' : 'No'}
                    </div>
                    <div>
                      <strong>Allow Pick Trades:</strong> {leagueSettings.allow_pick_trades ? 'Yes' : 'No'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveSettings}>
              {message && (
                <div style={{
                  padding: '12px 20px',
                  background: message.includes('Error') ? '#fef2f2' : '#f0fdf4',
                  color: message.includes('Error') ? '#991b1b' : '#166534',
                  borderRadius: '6px',
                  marginBottom: '20px'
                }}>
                  {message}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                <div>
                  <h3 style={{ marginTop: '0' }}>Draft Settings</h3>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                      Draft Format
                    </label>
                    <select
                      value={formData.draft_format}
                      onChange={(e) => setFormData({ ...formData, draft_format: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    >
                      <option value="snake">Snake</option>
                      <option value="linear">Linear</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                      Pick Timer (seconds, 0 = unlimited)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.pick_timer_seconds}
                      onChange={(e) => setFormData({ ...formData, pick_timer_seconds: parseInt(e.target.value) || 0 })}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData.allow_pauses}
                        onChange={(e) => setFormData({ ...formData, allow_pauses: e.target.checked })}
                      />
                      <span>Allow draft pauses</span>
                    </label>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '10px' }}>
                      <input
                        type="checkbox"
                        checked={formData.drafting_hours_enabled}
                        onChange={(e) => setFormData({ ...formData, drafting_hours_enabled: e.target.checked })}
                      />
                      <span>Restrict drafting hours</span>
                    </label>
                    {formData.drafting_hours_enabled && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginLeft: '30px' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>Start Time</label>
                          <input
                            type="time"
                            value={formData.drafting_hours_start}
                            onChange={(e) => setFormData({ ...formData, drafting_hours_start: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '14px'
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>End Time</label>
                          <input
                            type="time"
                            value={formData.drafting_hours_end}
                            onChange={(e) => setFormData({ ...formData, drafting_hours_end: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '14px'
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <h3>Roster Settings</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                    {[
                      { key: 'roster_qb', label: 'QB' },
                      { key: 'roster_rb', label: 'RB' },
                      { key: 'roster_wr', label: 'WR' },
                      { key: 'roster_te', label: 'TE' },
                      { key: 'roster_flex', label: 'FLEX' },
                      { key: 'roster_k', label: 'K' },
                      { key: 'roster_dst', label: 'DST' },
                      { key: 'bench', label: 'Bench' },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: '500' }}>
                          {label}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={formData[key as keyof typeof formData] as number}
                          onChange={(e) => setFormData({ ...formData, [key]: parseInt(e.target.value) || 0 })}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '14px'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 style={{ marginTop: '0' }}>League Behavior</h3>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData.allow_trades}
                        onChange={(e) => setFormData({ ...formData, allow_trades: e.target.checked })}
                      />
                      <span>Allow player trades</span>
                    </label>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData.allow_pick_trades}
                        onChange={(e) => setFormData({ ...formData, allow_pick_trades: e.target.checked })}
                      />
                      <span>Allow draft pick trades</span>
                    </label>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '12px 24px',
                    background: saving ? '#9ca3af' : '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '16px',
                    fontWeight: '500',
                    cursor: saving ? 'not-allowed' : 'pointer'
                  }}
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
