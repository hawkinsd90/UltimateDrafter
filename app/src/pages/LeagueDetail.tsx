import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../contexts/AuthContext';
import LeagueDraftsTab from '../components/league/LeagueDraftsTab';
import LeagueMembersTab from '../components/league/LeagueMembersTab';
import LeagueSettingsTab from '../components/league/LeagueSettingsTab';
import LeagueRosterTab from '../components/league/LeagueRosterTab';
import LeagueImportPanel from '../components/league/LeagueImportPanel';
import type { ImportedMember } from '../components/league/ImportedLeaguematesPanel';
import type { Database } from '../types/supabase';

type League = Database['public']['Tables']['leagues']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];
type Draft = Database['public']['Tables']['drafts']['Row'];
type LeagueMember = Database['public']['Tables']['league_members']['Row'];
type LeagueInvite = Database['public']['Tables']['league_invites']['Row'];

type Tab = 'drafts' | 'members' | 'roster' | 'settings';
const ALL_TABS: Tab[] = ['drafts', 'members', 'roster', 'settings'];
const BASE_TABS: Tab[] = ['drafts', 'members', 'settings'];

export default function LeagueDetail() {
  const { leagueId }                        = useParams<{ leagueId: string }>();
  const { user, isLoadingAuth }             = useAuth();
  const [searchParams, setSearchParams]     = useSearchParams();
  const navigate                            = useNavigate();

  const [league, setLeague]                   = useState<League | null>(null);
  const [leagueSettings, setLeagueSettings]   = useState<LeagueSettings | null>(null);
  const [drafts, setDrafts]                   = useState<Draft[]>([]);
  const [members, setMembers]                 = useState<LeagueMember[]>([]);
  const [invites, setInvites]                 = useState<LeagueInvite[]>([]);
  const [myDraftIds, setMyDraftIds]           = useState<Set<string>>(new Set());
  const [importedMembers, setImportedMembers] = useState<ImportedMember[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');

  const tabParam = searchParams.get('tab') as Tab | null;
  // Derive active tab directly from the URL — no duplicate state.
  // This ensures "View My Roster" link changes in the URL immediately reflect in rendered content.
  const activeTab: Tab = tabParam && ALL_TABS.includes(tabParam) ? tabParam : 'drafts';

  const userId = user?.id;

  const loadLeagueData = useCallback(async () => {
    if (!leagueId || !userId) return;
    try {
      const [leagueResult, settingsResult, draftsResult, membersResult, invitesResult, importedResult] = await Promise.all([
        supabase.from('leagues').select('*').eq('id', leagueId).maybeSingle(),
        supabase.from('league_settings').select('*').eq('league_id', leagueId).maybeSingle(),
        supabase.from('drafts').select('*').eq('league_id', leagueId).order('created_at', { ascending: false }),
        supabase.from('league_members').select('*').eq('league_id', leagueId).order('joined_at', { ascending: true }),
        supabase.from('league_invites').select('*').eq('league_id', leagueId).is('accepted_at', null).order('created_at', { ascending: false }),
        // Include external_team_id and external_league_id so LeagueRosterTab can traverse
        // the import chain without a draft_id
        supabase.from('league_imported_members')
          .select('id, external_owner_name, team_name, provider, invite_id, invited_user_id, external_team_id, external_league_id')
          .eq('league_id', leagueId)
          .order('created_at', { ascending: true }),
      ]);

      if (leagueResult.error || !leagueResult.data) {
        setError(leagueResult.error?.message ?? 'League not found');
      } else {
        setLeague(leagueResult.data);
      }
      if (!settingsResult.error && settingsResult.data) setLeagueSettings(settingsResult.data);
      if (!membersResult.error && membersResult.data)   setMembers(membersResult.data);
      if (!invitesResult.error && invitesResult.data)   setInvites(invitesResult.data);
      if (!importedResult.error && importedResult.data) {
        setImportedMembers(importedResult.data.map(r => ({
          id: r.id,
          externalOwnerName: r.external_owner_name,
          teamName: r.team_name,
          provider: r.provider,
          inviteId: r.invite_id,
          invitedUserId: r.invited_user_id,
          externalTeamId: (r as Record<string, unknown>).external_team_id as string | null ?? null,
          externalLeagueId: (r as Record<string, unknown>).external_league_id as string | null ?? null,
        })));
      }
      if (!draftsResult.error && draftsResult.data) {
        setDrafts(draftsResult.data);
        if (draftsResult.data.length > 0) {
          const draftIds = draftsResult.data.map(d => d.id);
          const { data: participantRows } = await supabase
            .from('draft_participants')
            .select('draft_id')
            .in('draft_id', draftIds)
            .eq('user_id', userId);
          setMyDraftIds(new Set((participantRows ?? []).map(r => r.draft_id)));
        } else {
          setMyDraftIds(new Set());
        }
      }
    } catch {
      setError('Error loading league data');
    } finally {
      setLoading(false);
    }
  }, [leagueId, userId]);

  useEffect(() => {
    if (!isLoadingAuth && !userId) {
      setLoading(false);
    }
  }, [isLoadingAuth, userId]);

  useEffect(() => {
    if (userId) {
      setLoading(true);
      loadLeagueData();
    }
  }, [userId, loadLeagueData]);

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`league-${leagueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_members',         filter: `league_id=eq.${leagueId}` }, () => loadLeagueData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_invites',          filter: `league_id=eq.${leagueId}` }, () => loadLeagueData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_imported_members', filter: `league_id=eq.${leagueId}` }, () => loadLeagueData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leagueId, loadLeagueData]);

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

  async function handleDeleteLeague() {
    if (!league) return;
    if (!window.confirm(`Delete league "${league.name}"?\n\nAll data will be preserved but the league will no longer be visible. This cannot be undone.`)) return;
    await supabase.from('leagues').update({ is_active: false }).eq('id', league.id);
    navigate('/leagues');
  }

  function switchTab(tab: Tab) {
    setSearchParams({ tab });
  }

  const isOwner = !!(user && league && league.owner_id === user.id);
  const hasImport = importedMembers.length > 0;
  // Visible tabs: always show drafts/members/settings; only show roster if an import exists
  const visibleTabs: Tab[] = hasImport
    ? ['drafts', 'members', 'roster', 'settings']
    : BASE_TABS;

  if (isLoadingAuth) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!userId) {
    return (
      <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <p style={{ marginTop: '20px', color: '#374151' }}>
          Please <Link to="/login" style={{ color: '#2563eb' }}>sign in</Link> to view this league.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!league) {
    return (
      <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <p style={{ marginTop: '20px', color: '#ef4444' }}>{error || 'League not found'}</p>
      </div>
    );
  }

  // If the user landed on ?tab=roster but no import exists, redirect to drafts
  const safeActiveTab: Tab = activeTab === 'roster' && !hasImport ? 'drafts' : activeTab;

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '12px', flexWrap: 'nowrap', minWidth: 0 }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <UserMenu />
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 10px 0' }}>{league.name}</h1>
        <p style={{ margin: '0', color: '#6b7280', fontSize: '16px' }}>{league.sport} - {league.season}</p>
        <p style={{ margin: '5px 0 0 0', color: '#9ca3af', fontSize: '14px' }}>
          Created {new Date(league.created_at).toLocaleDateString()}
        </p>
      </div>

      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '30px' }}>
        <div style={{ display: 'flex', gap: '30px' }}>
          {visibleTabs.map(tab => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              style={{
                background: 'none', border: 'none', padding: '10px 0', fontSize: '16px', cursor: 'pointer',
                fontWeight: safeActiveTab === tab ? '600' : '400',
                color: safeActiveTab === tab ? '#2563eb' : '#6b7280',
                borderBottom: safeActiveTab === tab ? '2px solid #2563eb' : '2px solid transparent',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {safeActiveTab === 'drafts' && (
        <LeagueDraftsTab
          drafts={drafts}
          leagueId={leagueId!}
          isOwner={isOwner}
          myDraftIds={myDraftIds}
          onPause={pauseDraft}
          onResume={resumeDraft}
          onDelete={deleteDraft}
        />
      )}

      {safeActiveTab === 'members' && (
        <LeagueMembersTab
          leagueId={leagueId!}
          leagueName={league.name}
          userId={userId}
          isOwner={isOwner}
          members={members}
          invites={invites}
          importedMembers={importedMembers}
          onRefresh={loadLeagueData}
        />
      )}

      {safeActiveTab === 'roster' && hasImport && (
        <LeagueRosterTab
          leagueId={leagueId!}
          userId={userId}
          importedMembers={importedMembers}
          leagueMembers={members}
          leagueSettings={leagueSettings}
          initialMemberId={searchParams.get('member')}
        />
      )}

      {safeActiveTab === 'settings' && (
        <>
          <LeagueSettingsTab
            leagueId={leagueId!}
            leagueSettings={leagueSettings}
            isOwner={isOwner}
            onSaved={loadLeagueData}
          />
          {isOwner && (
            <LeagueImportPanel leagueId={leagueId!} onImportComplete={loadLeagueData} />
          )}
          {isOwner && (
            <div style={{ marginTop: '48px', borderTop: '1px solid #fca5a5', paddingTop: '32px' }}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '600', color: '#991b1b' }}>
                Danger Zone
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#6b7280', lineHeight: '1.5' }}>
                Deleting a league hides it from your league list. All data — drafts, members, and
                imported rosters — is preserved and can be recovered by an admin if needed.
              </p>
              <button
                onClick={handleDeleteLeague}
                style={{
                  padding: '9px 20px', fontSize: '14px', fontWeight: '500',
                  background: 'transparent', color: '#dc2626',
                  border: '1px solid #dc2626', borderRadius: '6px', cursor: 'pointer',
                }}
              >
                Delete League
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
