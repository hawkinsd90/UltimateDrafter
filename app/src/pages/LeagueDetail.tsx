import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../contexts/AuthContext';
import LeagueDraftsTab from '../components/league/LeagueDraftsTab';
import LeagueMembersTab from '../components/league/LeagueMembersTab';
import LeagueSettingsTab from '../components/league/LeagueSettingsTab';
import type { ImportedMember } from '../components/league/ImportedLeaguematesPanel';
import type { Database } from '../types/supabase';

type League = Database['public']['Tables']['leagues']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];
type Draft = Database['public']['Tables']['drafts']['Row'];
type LeagueMember = Database['public']['Tables']['league_members']['Row'];
type LeagueInvite = Database['public']['Tables']['league_invites']['Row'];

type Tab = 'drafts' | 'members' | 'settings';
const TABS: Tab[] = ['drafts', 'members', 'settings'];

export default function LeagueDetail() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { user }     = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [league, setLeague]                 = useState<League | null>(null);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings | null>(null);
  const [drafts, setDrafts]                 = useState<Draft[]>([]);
  const [members, setMembers]               = useState<LeagueMember[]>([]);
  const [invites, setInvites]               = useState<LeagueInvite[]>([]);
  const [myDraftIds, setMyDraftIds]         = useState<Set<string>>(new Set());
  const [importedMembers, setImportedMembers] = useState<ImportedMember[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState('');

  const tabParam  = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam && TABS.includes(tabParam) ? tabParam : 'drafts'
  );

  const loadLeagueData = useCallback(async () => {
    if (!leagueId || !user) return;
    try {
      const [leagueResult, settingsResult, draftsResult, membersResult, invitesResult, importedResult] = await Promise.all([
        supabase.from('leagues').select('*').eq('id', leagueId).maybeSingle(),
        supabase.from('league_settings').select('*').eq('league_id', leagueId).maybeSingle(),
        supabase.from('drafts').select('*').eq('league_id', leagueId).order('created_at', { ascending: false }),
        supabase.from('league_members').select('*').eq('league_id', leagueId).order('joined_at', { ascending: true }),
        supabase.from('league_invites').select('*').eq('league_id', leagueId).is('accepted_at', null).order('created_at', { ascending: false }),
        supabase.from('league_imported_members').select('id, external_owner_name, team_name, provider, invite_id, invited_user_id').eq('league_id', leagueId).order('created_at', { ascending: true }),
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
            .eq('user_id', user.id);
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
  }, [leagueId, user]);

  useEffect(() => {
    loadLeagueData();
  }, [loadLeagueData]);

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`league-${leagueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_members',          filter: `league_id=eq.${leagueId}` }, () => loadLeagueData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_invites',           filter: `league_id=eq.${leagueId}` }, () => loadLeagueData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_imported_members',  filter: `league_id=eq.${leagueId}` }, () => loadLeagueData())
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

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setSearchParams({ tab });
  }

  const isOwner = !!(user && league && league.owner_id === user.id);

  if (loading) return <div style={{ padding: '40px' }}>Loading...</div>;

  if (!league) {
    return (
      <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <p style={{ marginTop: '20px', color: '#ef4444' }}>{error || 'League not found'}</p>
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
        <p style={{ margin: '0', color: '#6b7280', fontSize: '16px' }}>{league.sport} - {league.season}</p>
        <p style={{ margin: '5px 0 0 0', color: '#9ca3af', fontSize: '14px' }}>
          Created {new Date(league.created_at).toLocaleDateString()}
        </p>
      </div>

      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '30px' }}>
        <div style={{ display: 'flex', gap: '30px' }}>
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              style={{
                background: 'none', border: 'none', padding: '10px 0', fontSize: '16px', cursor: 'pointer',
                fontWeight: activeTab === tab ? '600' : '400',
                color: activeTab === tab ? '#2563eb' : '#6b7280',
                borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'drafts' && (
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

      {activeTab === 'members' && user && (
        <LeagueMembersTab
          leagueId={leagueId!}
          leagueName={league.name}
          userId={user.id}
          isOwner={isOwner}
          members={members}
          invites={invites}
          importedMembers={importedMembers}
          drafts={drafts}
          myDraftIds={myDraftIds}
          onRefresh={loadLeagueData}
        />
      )}

      {activeTab === 'settings' && (
        <LeagueSettingsTab
          leagueId={leagueId!}
          leagueSettings={leagueSettings}
          isOwner={isOwner}
          onSaved={loadLeagueData}
        />
      )}
    </div>
  );
}
