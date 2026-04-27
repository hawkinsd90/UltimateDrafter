import { Link, useParams } from 'react-router-dom';
import UserMenu from '../components/UserMenu';

export default function ExternalLeagueImportWizard() {
  const { draftId } = useParams<{ draftId: string }>();

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <Link
          to={`/drafts/${draftId}/participants`}
          style={{ color: '#2563eb', textDecoration: 'none', fontSize: '14px' }}
        >
          ← Back to Participants
        </Link>
        <UserMenu />
      </div>

      <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: '700', color: '#111827' }}>
        External League Import
      </h1>
      <p style={{ margin: '0 0 32px 0', fontSize: '16px', color: '#6b7280' }}>
        ESPN and Sleeper imports are supported.
      </p>

      <div style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '24px',
        marginBottom: '24px',
      }}>
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Draft ID
          </span>
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#111827', fontFamily: 'monospace' }}>
            {draftId}
          </p>
        </div>

        <div>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Provider
          </span>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            {(['ESPN', 'Sleeper'] as const).map((p) => (
              <div
                key={p}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  background: 'white',
                  color: '#9ca3af',
                  textAlign: 'center',
                  fontSize: '15px',
                  fontWeight: '500',
                  cursor: 'not-allowed',
                  userSelect: 'none',
                }}
              >
                {p}
              </div>
            ))}
          </div>
          <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#9ca3af' }}>
            Provider selection coming in the next step.
          </p>
        </div>
      </div>

      <div style={{
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: '8px',
        padding: '20px 24px',
      }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#1d4ed8' }}>
          Next steps
        </h2>
        <ol style={{ margin: 0, paddingLeft: '20px', color: '#1e40af', fontSize: '14px', lineHeight: '1.8' }}>
          <li>Provider lookup — enter league ID and credentials</li>
          <li>Team mapping — match imported teams to draft participants</li>
          <li>Keeper selection — choose keepers per team</li>
          <li>Lock import — confirm and lock before the draft starts</li>
        </ol>
      </div>
    </div>
  );
}
