import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AdminNFLRosterImportPanel from '../components/AdminNFLRosterImportPanel';
import AdminPlayerStatsPanel from '../components/AdminPlayerStatsPanel';
import AdminLastSeasonRankingsPanel from '../components/AdminLastSeasonRankingsPanel';
import AdminEspnRankingsPanel from '../components/AdminEspnRankingsPanel';
import UserMenu from '../components/UserMenu';

export default function Admin() {
  const { isAdmin, isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', color: '#f9fafb' }}>Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '600px', margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
        <h1 style={{ color: '#1e293b', marginBottom: '8px' }}>Admin Access Required</h1>
        <p style={{ color: '#64748b' }}>Your account does not have admin privileges.</p>
        <Link to="/leagues" style={{ display: 'inline-block', marginTop: '20px', color: '#2563eb' }}>← Back to Leagues</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#0f172a', borderBottom: '1px solid #1e293b', padding: '0 32px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <Link to="/leagues" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '13px' }}>← App</Link>
            <span style={{ color: '#f9fafb', fontWeight: '700', fontSize: '15px', letterSpacing: '0.02em' }}>Admin Panel</span>
          </div>
          <UserMenu />
        </div>
      </div>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px' }}>
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: '700', color: '#1e293b' }}>NFL Roster Import</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
            Import NFL player and roster data into the platform. Use <strong>Mock</strong> for testing,
            <strong> Sleeper</strong> for free live data, or <strong>SportsDataIO</strong> once the API key is configured.
          </p>
        </div>

        <AdminNFLRosterImportPanel />

        <div style={{ marginTop: '40px', marginBottom: '28px' }}>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: '700', color: '#1e293b' }}>Player Season Stats</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
            Sync previous season player stats from Sleeper. Required before Last Season fantasy point rankings can be calculated.
          </p>
        </div>

        <AdminPlayerStatsPanel />

        <div style={{ marginTop: '40px', marginBottom: '28px' }}>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: '700', color: '#1e293b' }}>Last Season Rankings</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
            Calculate league-specific last season fantasy points using a draft's imported scoring rules.
            Run after syncing player season stats. Results are stored in <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px', fontSize: '13px' }}>player_rankings</code> per draft.
          </p>
        </div>

        <AdminLastSeasonRankingsPanel />

        <div style={{ marginTop: '40px', marginBottom: '28px' }}>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: '700', color: '#1e293b' }}>ESPN Rankings</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
            Sync ESPN draft rankings and projections into the platform. Fetches overall rank, position rank, ADP, projected points,
            and ownership percentage for Standard and PPR scoring. Requires an imported ESPN league.
          </p>
        </div>

        <AdminEspnRankingsPanel />
      </div>
    </div>
  );
}
