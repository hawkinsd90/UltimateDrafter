import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

interface ImportedTeam {
  id: string;
  teamName: string;
  externalOwnerName: string | null;
  provider: string;
}

export default function JoinLeague() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'ready' | 'joining' | 'error' | 'done'>('loading');
  const [leagueName, setLeagueName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Imported team selection
  const [importedTeams, setImportedTeams] = useState<ImportedTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (inviteId) loadInvite();
  }, [inviteId, user]);

  async function loadInvite() {
    if (!inviteId) return;
    const { data, error } = await supabase
      .from('league_invites')
      .select('*, leagues(name, id)')
      .eq('id', inviteId)
      .maybeSingle();

    if (error || !data) {
      setErrorMsg('This invite link is invalid or has expired.');
      setStatus('error');
      return;
    }
    if (data.accepted_at) {
      setErrorMsg('This invite has already been used.');
      setStatus('error');
      return;
    }
    if (new Date(data.expires_at) < new Date()) {
      setErrorMsg('This invite link has expired.');
      setStatus('error');
      return;
    }
    const league = data.leagues as { name: string; id: string } | null;
    setLeagueName(league?.name ?? 'the league');
    if (user?.email) setDisplayName(user.email.split('@')[0]);

    // Only load imported teams when signed in — RPC requires authenticated role
    if (user) {
      const { data: teams } = await supabase.rpc('get_join_invite_imported_teams', {
        p_invite_id: inviteId,
      });

      if (teams && teams.length > 0) {
        setImportedTeams(teams.map((t: { id: string; team_name: string; external_owner_name: string | null; provider: string }) => ({
          id: t.id,
          teamName: t.team_name,
          externalOwnerName: t.external_owner_name,
          provider: t.provider,
        })));
      }
    }

    setStatus('ready');
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !inviteId) return;
    setStatus('joining');
    setErrorMsg('');

    const name = displayName.trim() || user.email?.split('@')[0] || 'Member';
    const { data: joinedLeagueId, error } = await supabase.rpc('accept_league_invite', {
      p_invite_id: inviteId,
      p_display_name: name,
      p_imported_member_id: selectedTeamId ?? null,
    });

    if (error || !joinedLeagueId) {
      setErrorMsg('Failed to join league: ' + (error?.message ?? 'unknown'));
      setStatus('ready');
      return;
    }

    setStatus('done');
    setTimeout(() => navigate(`/leagues/${joinedLeagueId}`), 1500);
  }

  if (!user && status !== 'loading') {
    return (
      <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '500px', margin: '0 auto' }}>
        <div style={{ padding: '30px', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <h2 style={{ marginTop: 0 }}>Sign in to join</h2>
          <p style={{ color: '#6b7280' }}>You need to sign in before joining a league.</p>
          <Link to={`/login?redirect=/leagues/join/${inviteId}`} style={{ color: '#2563eb' }}>Sign in</Link>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', color: '#f9fafb' }}>Checking invite...</div>;
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '500px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← My Leagues</Link>
        <UserMenu />
      </div>

      {status === 'error' && (
        <div style={{ padding: '30px', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <h2 style={{ color: '#ef4444', marginTop: 0 }}>Invalid Invite</h2>
          <p style={{ color: '#6b7280' }}>{errorMsg}</p>
          <Link to="/leagues" style={{ color: '#2563eb' }}>Go to my leagues</Link>
        </div>
      )}

      {status === 'done' && (
        <div style={{ padding: '30px', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <h2 style={{ color: '#059669', marginTop: 0 }}>Joined!</h2>
          <p style={{ color: '#6b7280' }}>You've joined {leagueName}. Redirecting...</p>
        </div>
      )}

      {(status === 'ready' || status === 'joining') && (
        <div style={{ padding: '30px', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <h1 style={{ color: '#111827', marginTop: 0, fontSize: '24px' }}>Join League</h1>
          <p style={{ color: '#6b7280', marginBottom: '24px' }}>
            You've been invited to join <strong style={{ color: '#111827' }}>{leagueName}</strong>.
          </p>

          {errorMsg && (
            <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626', marginBottom: '16px' }}>
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Display name */}
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#374151' }}>
                Your display name in this league
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Team name or your name"
                required
                style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px', color: '#111827', boxSizing: 'border-box' }}
              />
            </div>

            {/* Imported team picker */}
            {importedTeams.length > 0 && (
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#374151' }}>
                  Link to your imported team (optional)
                </label>
                <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#6b7280' }}>
                  This league was imported from {importedTeams[0]?.provider?.toUpperCase()}. Select your team to connect your account.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {importedTeams.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        const isSelected = selectedTeamId === t.id;
                        setSelectedTeamId(isSelected ? null : t.id);
                        if (!isSelected) setDisplayName(t.teamName);
                      }}
                      style={{
                        padding: '10px 14px', borderRadius: '7px', cursor: 'pointer', textAlign: 'left',
                        background: selectedTeamId === t.id ? '#eff6ff' : 'white',
                        border: `2px solid ${selectedTeamId === t.id ? '#2563eb' : '#e5e7eb'}`,
                        transition: 'all 0.12s',
                      }}
                    >
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{t.teamName}</div>
                      {t.externalOwnerName && t.externalOwnerName !== t.teamName && (
                        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{t.externalOwnerName}</div>
                      )}
                    </button>
                  ))}
                  {selectedTeamId && (
                    <button
                      type="button"
                      onClick={() => setSelectedTeamId(null)}
                      style={{ fontSize: '12px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 0' }}
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!user || status === 'joining'}
              style={{
                width: '100%', padding: '12px',
                background: !user || status === 'joining' ? '#9ca3af' : '#059669',
                color: 'white', border: 'none', borderRadius: '6px',
                fontWeight: '600', fontSize: '16px',
                cursor: !user || status === 'joining' ? 'not-allowed' : 'pointer',
              }}
            >
              {status === 'joining' ? 'Joining...' : 'Join League'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
