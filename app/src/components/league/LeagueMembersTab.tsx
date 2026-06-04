import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { normalizePhoneToE164, validateE164 } from '../../utils/phone';
import { sendInviteNotification } from '../../utils/notifications';
import ImportedLeaguematesPanel, { type ImportedMember } from './ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';

type LeagueMember = Database['public']['Tables']['league_members']['Row'];
type LeagueInvite = Database['public']['Tables']['league_invites']['Row'];

type ExtMember = LeagueMember & { draft_order?: number | null };

interface ExternalLeagueLink {
  id: string;
  provider: string;
  external_league_id: string;
  external_season: number | null;
}

interface TeamStanding {
  externalTeamId: string;
  teamName: string;
  externalOwnerId: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  playoffSeed: number | null;
  madePlayoffs: boolean;
  finalStanding: number | null;
}

interface Props {
  leagueId: string;
  leagueName: string;
  userId: string;
  isOwner: boolean;
  members: LeagueMember[];
  invites: LeagueInvite[];
  importedMembers: ImportedMember[];
  onRefresh: () => void;
}

export default function LeagueMembersTab({
  leagueId, leagueName, userId, isOwner,
  members, invites, importedMembers, onRefresh,
}: Props) {
  const navigate = useNavigate();

  const [phoneInputs, setPhoneInputs]     = useState<string[]>(['']);
  const [addingPhone, setAddingPhone]     = useState(false);
  const [formError, setFormError]         = useState('');
  const [formSuccess, setFormSuccess]     = useState('');
  const [bannerError, setBannerError]     = useState('');
  const [copiedId, setCopiedId]           = useState<string | null>(null);
  const [resendingId, setResendingId]     = useState<string | null>(null);
  const [resentId, setResentId]           = useState<string | null>(null);
  const [draftOrderIds, setDraftOrderIds] = useState<string[]>([]);
  const [savingOrder, setSavingOrder]     = useState(false);
  const [orderSaved, setOrderSaved]       = useState(false);

  // Standings auto-order
  const [externalLink, setExternalLink]   = useState<ExternalLeagueLink | null | undefined>(undefined);
  const [swid, setSwid]                   = useState('');
  const [espnS2, setEspnS2]               = useState('');
  const [standings, setStandings]         = useState<TeamStanding[] | null>(null);
  const [draftOrder, setDraftOrder]       = useState<TeamStanding[] | null>(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsError, setStandingsError]     = useState('');
  const [standingsApplied, setStandingsApplied] = useState(false);

  // Initialise draft order from members (sorted by draft_order, nulls last)
  useEffect(() => {
    const ext = members as ExtMember[];
    const sorted = [...ext].sort((a, b) => {
      if (a.draft_order != null && b.draft_order != null) return a.draft_order - b.draft_order;
      if (a.draft_order != null) return -1;
      if (b.draft_order != null) return 1;
      return 0;
    });
    setDraftOrderIds(sorted.map(m => m.id));
  }, [members]);

  function moveDraftOrder(id: string, dir: -1 | 1) {
    setDraftOrderIds(prev => {
      const idx  = prev.indexOf(id);
      if (idx === -1) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
    setOrderSaved(false);
  }

  async function saveDraftOrder() {
    setSavingOrder(true);
    setOrderSaved(false);
    await Promise.all(
      draftOrderIds.map((memberId, i) =>
        supabase.from('league_members').update({ draft_order: i + 1 } as Partial<ExtMember>).eq('id', memberId)
      )
    );
    setSavingOrder(false);
    setOrderSaved(true);
    setTimeout(() => setOrderSaved(false), 2500);
  }

  // Load external link for standings (owner only, if imported members exist)
  useEffect(() => {
    if (!isOwner || importedMembers.length === 0) { setExternalLink(null); return; }
    supabase
      .from('external_league_links')
      .select('id, provider, external_league_id, external_season')
      .eq('league_id', leagueId)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setExternalLink(data ?? null));
  }, [isOwner, leagueId, importedMembers.length]);

  // Auto-fetch standings once the external link resolves (no credentials needed for public leagues)
  useEffect(() => {
    if (!externalLink) return;
    // Only auto-fetch for Sleeper (always public) or ESPN public leagues
    // ESPN private leagues require credentials so we don't auto-fetch
    if (externalLink.provider === 'sleeper') {
      fetchStandings();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalLink]);

  async function fetchStandings() {
    if (!externalLink) return;
    setStandingsLoading(true);
    setStandingsError('');
    setStandings(null);
    setDraftOrder(null);
    setStandingsApplied(false);

    const season = externalLink.external_season ? externalLink.external_season - 1 : new Date().getFullYear() - 1;
    const body: Record<string, unknown> = {
      provider: externalLink.provider,
      leagueId: externalLink.external_league_id,
      season,
    };
    if (externalLink.provider === 'espn' && swid && espnS2) {
      body.isPrivate = true;
      body.swid      = swid;
      body.espnS2    = espnS2;
    }

    const { data, error } = await supabase.functions.invoke('fetch-league-standings', { body });
    setStandingsLoading(false);
    if (error) { setStandingsError(error.message ?? 'Failed to fetch standings'); return; }
    const result = data as { standings: TeamStanding[]; draftOrder: TeamStanding[] } | { error: string };
    if ('error' in result) { setStandingsError(result.error); return; }
    setStandings(result.standings);
    setDraftOrder(result.draftOrder);
  }

  function applyStandingsDraftOrder() {
    if (!draftOrder) return;
    // Match each standing entry to an imported member by externalTeamId, then to a league member
    const newOrder: string[] = [];
    for (const team of draftOrder) {
      const imported = importedMembers.find(m => m.externalTeamId === team.externalTeamId);
      if (!imported) continue;
      const member = members.find(m => m.user_id === imported.invitedUserId);
      if (member && !newOrder.includes(member.id)) newOrder.push(member.id);
    }
    // Append any members not matched (no imported team or unmatched)
    for (const m of members) {
      if (!newOrder.includes(m.id)) newOrder.push(m.id);
    }
    setDraftOrderIds(newOrder);
    setOrderSaved(false);
    setStandingsApplied(true);
    setTimeout(() => setStandingsApplied(false), 3000);
  }

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

    const seen = new Set<string>();
    const normalized = entries.map(normalizeEntry).filter(en => {
      const key = en.includes('@') ? en.toLowerCase() : en;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const invalid = normalized.filter(en => !en.includes('@') && !validateE164(en));
    if (invalid.length > 0) {
      setFormError(`Invalid: "${invalid.join(', ')}" — use an email address or a 10-digit US phone number`);
      setAddingPhone(false);
      return;
    }

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

    const pendingEmails = new Set(invites.map(i => i.email?.toLowerCase()).filter(Boolean) as string[]);
    const pendingPhones = new Set(invites.map(i => i.phone_e164).filter(Boolean) as string[]);
    const alreadyInvited = normalized.filter(en =>
      en.includes('@') ? pendingEmails.has(en.toLowerCase()) : pendingPhones.has(en)
    );
    if (alreadyInvited.length > 0) {
      setFormError(`Already invited (pending): ${alreadyInvited.join(', ')}`);
      setAddingPhone(false);
      return;
    }

    const results = await Promise.all(normalized.map(async entry => {
      const isEmail = entry.includes('@');
      const payload: Record<string, unknown> = { league_id: leagueId, invited_by: userId };
      if (isEmail) payload.email = entry; else payload.phone_e164 = entry;
      const { data: invite, error: inviteError } = await supabase.from('league_invites').insert(payload).select().single();
      if (inviteError || !invite) return { entry, success: false, error: inviteError?.message ?? 'unknown' };
      const inviteUrl = `${window.location.origin}/leagues/join/${invite.id}`;
      const notifRes  = await sendInviteNotification({ contact: entry, inviteUrl, leagueName });
      return { entry, success: true, notifError: notifRes.success ? null : notifRes.error };
    }));

    const failures  = results.filter(r => !r.success);
    const successes = results.filter(r => r.success);
    const notifErrs = successes.filter(r => r.notifError).map(r => `${r.entry}: ${r.notifError}`);

    if (failures.length > 0) setFormError('Some entries failed: ' + failures.map(r => `${r.entry}: ${r.error}`).join('; '));
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
      await supabase.from('league_imported_members')
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

  const filledCount    = phoneInputs.filter(p => p.trim()).length;
  const myImportedTeam = importedMembers.find(m => m.invitedUserId === userId);
  const memberMap      = Object.fromEntries(members.map(m => [m.id, m]));

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
        <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626', marginBottom: '16px' }}>{bannerError}</div>
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
            <div style={{ padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#dc2626', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5' }}>{formError}</div>
          )}
          {formSuccess && (
            <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', color: '#166534', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5', wordBreak: 'break-all' }}>{formSuccess}</div>
          )}
          <form onSubmit={handleAddMembers}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {phoneInputs.map((val, idx) => {
                const trimmed    = val.trim();
                const normalized = (!trimmed || trimmed.includes('@')) ? null : normalizePhoneToE164(trimmed);
                return (
                  <div key={idx}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text" value={val}
                        onChange={e => { const next = [...phoneInputs]; next[idx] = e.target.value; setPhoneInputs(next); setFormError(''); setFormSuccess(''); }}
                        placeholder="email@example.com or 7343588854"
                        style={{ flex: 1, padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px', color: '#111827', background: 'white' }}
                      />
                      {phoneInputs.length > 1 && (
                        <button type="button" onClick={() => setPhoneInputs(phoneInputs.filter((_, i) => i !== idx))}
                          style={{ padding: '10px 12px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', color: '#6b7280', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
                          title="Remove">×</button>
                      )}
                    </div>
                    {normalized && normalized !== trimmed && (
                      <p style={{ margin: '3px 0 0 2px', fontSize: '12px', color: '#059669' }}>Will send SMS to {normalized}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={() => setPhoneInputs([...phoneInputs, ''])}
                style={{ padding: '8px 14px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', color: '#374151', cursor: 'pointer', fontSize: '14px' }}>
                + Add Another
              </button>
              <button type="submit" disabled={addingPhone}
                style={{ padding: '8px 20px', background: addingPhone ? '#9ca3af' : '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: addingPhone ? 'not-allowed' : 'pointer', fontWeight: '500', fontSize: '14px' }}>
                {addingPhone ? 'Sending invite...' : `Invite ${filledCount > 1 ? `${filledCount} People` : 'Person'}`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Members list */}
      {members.length === 0 ? (
        <div style={{ padding: '40px', background: '#f9fafb', border: '2px dashed #d1d5db', borderRadius: '8px', textAlign: 'center' }}>
          <p style={{ margin: '0', color: '#6b7280' }}>
            {isOwner ? 'No members yet. Use the invite link or add by phone number above.' : 'No members yet.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '30px' }}>
          {members.map(m => {
            const importedTeam = importedMembers.find(im => im.invitedUserId === m.user_id && im.invitedUserId !== null);
            const isClickable  = !!importedTeam;
            return (
              <div
                key={m.id}
                onClick={() => isClickable && navigate(`/leagues/${leagueId}?tab=roster&member=${importedTeam!.id}`)}
                style={{
                  padding: '14px 18px', border: '1px solid #e5e7eb', borderRadius: '8px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'white',
                  cursor: isClickable ? 'pointer' : 'default',
                  transition: isClickable ? 'background 0.1s' : 'none',
                }}
                onMouseEnter={e => { if (isClickable) (e.currentTarget as HTMLDivElement).style.background = '#f0f9ff'; }}
                onMouseLeave={e => { if (isClickable) (e.currentTarget as HTMLDivElement).style.background = 'white'; }}
              >
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
                  {importedTeam && (
                    <span style={{ marginLeft: '8px', fontSize: '12px', color: '#0369a1' }}>{importedTeam.teamName}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {isClickable && (
                    <span style={{ fontSize: '12px', color: '#0369a1', fontWeight: '500' }}>View Roster →</span>
                  )}
                  {isOwner && (
                    <button
                      onClick={e => { e.stopPropagation(); handleRemoveMember(m.id); }}
                      style={{ padding: '6px 12px', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Your Team card — shown to non-owner members who have a claimed team */}
      {myImportedTeam && (
        <div style={{ marginBottom: '24px', padding: '16px 20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#0c4a6e' }}>Your Team</h3>
          <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#0369a1' }}>
            You are connected to the <strong>{myImportedTeam.teamName}</strong> team imported from {myImportedTeam.provider?.toUpperCase()}.
          </p>
          <button
            onClick={() => navigate(`/leagues/${leagueId}?tab=roster&member=${myImportedTeam.id}`)}
            style={{ display: 'inline-block', padding: '7px 16px', background: '#0f766e', color: 'white', textDecoration: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', border: 'none', cursor: 'pointer' }}
          >
            View My Roster
          </button>
        </div>
      )}

      {/* Draft Order — owner only, 2+ members */}
      {isOwner && members.length > 1 && (
        <div style={{ marginBottom: '30px', padding: '20px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px' }}>
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: '16px', color: '#374151' }}>Draft Order</h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>Set the default pick order for new drafts. Use arrows to reorder.</p>
            </div>
            <button
              onClick={saveDraftOrder}
              disabled={savingOrder}
              style={{
                padding: '8px 18px', fontWeight: '600', fontSize: '13px',
                background: orderSaved ? '#059669' : savingOrder ? '#9ca3af' : '#2563eb',
                color: 'white', border: 'none', borderRadius: '6px',
                cursor: savingOrder ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {orderSaved ? 'Saved!' : savingOrder ? 'Saving…' : 'Save Order'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '20px' }}>
            {draftOrderIds.map((memberId, idx) => {
              const m = memberMap[memberId];
              if (!m) return null;
              return (
                <div key={memberId} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '6px', background: 'white', border: '1px solid #e5e7eb' }}>
                  <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '12px', flexShrink: 0 }}>
                    {idx + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                    {m.display_name ?? m.phone_e164 ?? 'Unknown'}
                  </span>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    <DraftOrderBtn enabled={idx > 0} dir="up" onClick={() => moveDraftOrder(memberId, -1)} />
                    <DraftOrderBtn enabled={idx < draftOrderIds.length - 1} dir="down" onClick={() => moveDraftOrder(memberId, 1)} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Auto-order from standings */}
          {externalLink && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
              <h4 style={{ margin: '0 0 4px', fontSize: '14px', color: '#374151' }}>Auto-Order from Previous Season Standings</h4>
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#6b7280', lineHeight: '1.5' }}>
                Fetches {externalLink.external_season ? externalLink.external_season - 1 : 'previous'} season standings from {externalLink.provider.toUpperCase()} and orders teams worst-to-best (non-playoff teams first, then playoff teams, champion last).
              </p>

              {externalLink.provider === 'espn' && (
                <div style={{ marginBottom: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>SWID (optional, private leagues)</label>
                    <input
                      type="text" value={swid} onChange={e => setSwid(e.target.value)}
                      placeholder="{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}"
                      style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>espn_s2 (optional, private leagues)</label>
                    <input
                      type="text" value={espnS2} onChange={e => setEspnS2(e.target.value)}
                      placeholder="AEB..."
                      style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={fetchStandings}
                  disabled={standingsLoading}
                  style={{ padding: '8px 16px', fontSize: '13px', fontWeight: '600', background: standingsLoading ? '#9ca3af' : '#0f766e', color: 'white', border: 'none', borderRadius: '6px', cursor: standingsLoading ? 'not-allowed' : 'pointer' }}
                >
                  {standingsLoading ? 'Fetching…' : 'Fetch Standings'}
                </button>
                {draftOrder && (
                  <button
                    onClick={applyStandingsDraftOrder}
                    style={{ padding: '8px 16px', fontSize: '13px', fontWeight: '600', background: standingsApplied ? '#059669' : '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    {standingsApplied ? 'Applied!' : 'Apply Draft Order'}
                  </button>
                )}
              </div>

              {standingsError && (
                <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#dc2626', fontSize: '13px' }}>
                  {standingsError}
                </div>
              )}

              {standings && standings.length > 0 && (
                <div style={{ marginTop: '14px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left', color: '#374151', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Team</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center', color: '#374151', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>W-L-T</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center', color: '#374151', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>PF</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center', color: '#374151', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Playoffs</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center', color: '#374151', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Draft Pick</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((team, i) => {
                        const draftPos = draftOrder ? draftOrder.findIndex(t => t.externalTeamId === team.externalTeamId) + 1 : null;
                        return (
                          <tr key={team.externalTeamId} style={{ background: i % 2 === 0 ? 'white' : '#f9fafb' }}>
                            <td style={{ padding: '7px 10px', color: '#111827', fontWeight: '500' }}>{team.teamName}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'center', color: '#374151' }}>{team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'center', color: '#374151' }}>{team.pointsFor.toFixed(1)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                              {team.madePlayoffs ? (
                                <span style={{ padding: '2px 8px', borderRadius: '9999px', background: team.finalStanding === 1 ? '#fef3c7' : '#d1fae5', color: team.finalStanding === 1 ? '#92400e' : '#065f46', fontWeight: '600', fontSize: '12px' }}>
                                  {team.finalStanding === 1 ? 'Champion' : `Seed ${team.playoffSeed ?? ''}`}
                                </span>
                              ) : (
                                <span style={{ color: '#9ca3af', fontSize: '12px' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '7px 10px', textAlign: 'center', color: '#2563eb', fontWeight: '700' }}>
                              {draftPos ?? '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                    Note: Only teams matched to league members will be reordered. Unmatched teams will appear at the end.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pending Invites */}
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
                    <span style={{ marginLeft: '10px', fontSize: '12px', color: '#9ca3af' }}>Expires {new Date(inv.expires_at).toLocaleDateString()}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    {canResend && (
                      <button
                        onClick={() => handleResendInvite(inv)} disabled={resendingId === inv.id}
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

function DraftOrderBtn({ enabled, dir, onClick }: { enabled: boolean; dir: 'up' | 'down'; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={!enabled}
      style={{
        width: '24px', height: '24px', padding: 0,
        background: enabled ? '#eff6ff' : 'transparent',
        border: `1px solid ${enabled ? '#93c5fd' : '#e5e7eb'}`,
        borderRadius: '4px', cursor: enabled ? 'pointer' : 'default',
        color: enabled ? '#1d4ed8' : '#d1d5db',
        fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {dir === 'up' ? '▲' : '▼'}
    </button>
  );
}
