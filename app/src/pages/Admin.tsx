import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AdminNFLRosterImportPanel from '../components/AdminNFLRosterImportPanel';
import AdminPlayerStatsPanel from '../components/AdminPlayerStatsPanel';
import AdminLastSeasonRankingsPanel from '../components/AdminLastSeasonRankingsPanel';
import AdminEspnRankingsPanel from '../components/AdminEspnRankingsPanel';
import UserMenu from '../components/UserMenu';

const KNOWN_SECRETS: { name: string; description: string; group: string }[] = [
  { name: 'SUPABASE_URL',              description: 'Supabase project URL',                     group: 'Supabase' },
  { name: 'SUPABASE_ANON_KEY',         description: 'Public anon key for client SDK',            group: 'Supabase' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', description: 'Service role key (bypasses RLS)',           group: 'Supabase' },
  { name: 'SUPABASE_DB_URL',           description: 'Direct Postgres connection URL',            group: 'Supabase' },
  { name: 'SUPABASE_JWKS',             description: 'JWKS endpoint for JWT verification',        group: 'Supabase' },
  { name: 'SUPABASE_PUBLISHABLE_KEYS', description: 'Publishable key set',                      group: 'Supabase' },
  { name: 'SUPABASE_SECRET_KEYS',      description: 'Secret key set',                           group: 'Supabase' },
  { name: 'TELNYX_API_KEY',            description: 'Telnyx API key for SMS delivery',          group: 'SMS / Messaging' },
  { name: 'TELNYX_FROM_NUMBER',        description: 'Telnyx sender phone number',               group: 'SMS / Messaging' },
  { name: 'TWILIO_ACCOUNT_SID',        description: 'Twilio account SID',                       group: 'SMS / Messaging' },
  { name: 'TWILIO_AUTH_TOKEN',         description: 'Twilio auth token',                        group: 'SMS / Messaging' },
  { name: 'TWILIO_FROM_NUMBER',        description: 'Twilio sender phone number',               group: 'SMS / Messaging' },
  { name: 'RESEND_API_KEY',            description: 'Resend API key for transactional email',   group: 'Email' },
  { name: 'VERIFICATION_SALT',         description: 'Salt for phone verification codes',        group: 'Auth' },
];

const CONFIGURED_SECRETS = new Set<string>([
  'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_DB_URL',
  'TELNYX_API_KEY','TELNYX_FROM_NUMBER','VERIFICATION_SALT','SUPABASE_JWKS',
  'TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER',
  'SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SECRET_KEYS','RESEND_API_KEY',
]);

const GROUPS = Array.from(new Set(KNOWN_SECRETS.map(s => s.group)));

function SecretsPanel() {
  return (
    <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      {GROUPS.map((group, gi) => {
        const secrets = KNOWN_SECRETS.filter(s => s.group === group);
        return (
          <div key={group}>
            {gi > 0 && <div style={{ borderTop: '1px solid #f1f5f9' }} />}
            <div style={{ padding: '10px 16px 4px', background: '#f8fafc' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {group}
              </span>
            </div>
            {secrets.map((secret, si) => {
              const configured = CONFIGURED_SECRETS.has(secret.name);
              return (
                <div
                  key={secret.name}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 16px',
                    borderBottom: si < secrets.length - 1 ? '1px solid #f1f5f9' : 'none',
                    background: 'white',
                  }}
                >
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    background: configured ? '#22c55e' : '#e2e8f0',
                    boxShadow: configured ? '0 0 0 2px #dcfce7' : 'none',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b', fontFamily: 'monospace' }}>
                      {secret.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '1px' }}>
                      {secret.description}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '9999px',
                    background: configured ? '#dcfce7' : '#f1f5f9',
                    color: configured ? '#16a34a' : '#94a3b8',
                    flexShrink: 0,
                  }}>
                    {configured ? 'Configured' : 'Not set'}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

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

        <div style={{ marginTop: '40px', marginBottom: '28px' }}>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: '700', color: '#1e293b' }}>Edge Function Secrets</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
            Read-only overview of environment secrets configured for Edge Functions. Secret values are never exposed — only names and configuration status are shown.
          </p>
        </div>

        <SecretsPanel />
      </div>
    </div>
  );
}
