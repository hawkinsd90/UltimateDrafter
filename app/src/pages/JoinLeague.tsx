import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

export default function JoinLeague() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'ready' | 'joining' | 'error' | 'done'>('loading');
  const [leagueName, setLeagueName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (inviteId) loadInvite();
  }, [inviteId, user]);

  async function loadInvite() {
    if (!inviteId) return;
    const { data, error } = await supabase
      .from('league_invites')
      .select('*, leagues(name)')
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
    const league = data.leagues as { name: string } | null;
    setLeagueName(league?.name ?? 'the league');
    if (user?.email) setDisplayName(user.email.split('@')[0]);
    setStatus('ready');
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !inviteId) return;
    setStatus('joining');
    setErrorMsg('');

    const name = displayName.trim() || user.email?.split('@')[0] || 'Member';
    const { data: leagueId, error } = await supabase.rpc('accept_league_invite', {
      p_invite_id: inviteId,
      p_display_name: name,
    });

    if (error || !leagueId) {
      setErrorMsg('Failed to join league: ' + (error?.message ?? 'unknown'));
      setStatus('ready');
      return;
    }

    setStatus('done');
    setTimeout(() => navigate(`/leagues/${leagueId}`), 1500);
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
          <p style={{ color: '#6b7280', marginBottom: '24px' }}>You've been invited to join <strong style={{ color: '#111827' }}>{leagueName}</strong>.</p>

          {!user && (
            <div style={{ padding: '12px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: '6px', marginBottom: '16px' }}>
              <p style={{ margin: 0, color: '#92400e', fontSize: '14px' }}>
                You need to <Link to="/login" style={{ color: '#92400e', fontWeight: '600' }}>sign in</Link> before joining a league.
              </p>
            </div>
          )}

          {errorMsg && (
            <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626', marginBottom: '16px' }}>
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleJoin}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#374151' }}>
              Your display name in this league
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Team name or your name"
              required
              style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px', color: '#111827', marginBottom: '20px', boxSizing: 'border-box' }}
            />
            <button
              type="submit"
              disabled={!user || status === 'joining'}
              style={{
                width: '100%',
                padding: '12px',
                background: !user || status === 'joining' ? '#9ca3af' : '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '16px',
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