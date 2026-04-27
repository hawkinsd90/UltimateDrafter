import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserMenu from '../components/UserMenu';

type Provider = 'espn' | 'sleeper';
type ImportMode = 'manual_keeper_select' | 'all_rostered_as_keepers' | 'reference_only';

interface Draft {
  id: string;
  name: string;
  status: string;
}

interface ImportSummary {
  success: true;
  linkId: string;
  provider: Provider;
  displayName: string;
  numTeams: number;
  teamsImported: number;
  rosterPlayersImported: number;
  matchedPlayers: number;
  unresolvedPlayers: number;
  scoringType: string;
  warnings: string[];
}

const CURRENT_YEAR = new Date().getFullYear();

const IMPORT_MODE_LABELS: Record<ImportMode, { label: string; description: string }> = {
  manual_keeper_select: { label: 'Manual Keeper Select', description: 'Review and pick keepers per team before the draft.' },
  all_rostered_as_keepers: { label: 'All Rostered as Keepers', description: 'Every rostered player is automatically kept.' },
  reference_only: { label: 'Reference Only', description: 'Import for reference — no keepers assigned.' },
};

export default function ExternalLeagueImportWizard() {
  const { draftId } = useParams<{ draftId: string }>();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [draftError, setDraftError] = useState('');

  const [provider, setProvider] = useState<Provider>('espn');
  const [leagueId, setLeagueId] = useState('');
  const [season, setSeason] = useState(String(CURRENT_YEAR));
  const [importMode, setImportMode] = useState<ImportMode>('manual_keeper_select');
  const [isPrivate, setIsPrivate] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    if (draftId) loadDraft();
  }, [draftId]);

  async function loadDraft() {
    setLoadingDraft(true);
    const { data } = await supabase
      .from('drafts')
      .select('id, name, status')
      .eq('id', draftId!)
      .maybeSingle();
    if (!data) {
      setDraftError('Draft not found.');
    } else {
      setDraft(data);
    }
    setLoadingDraft(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSubmitting(true);
    setSubmitError('');

    const seasonNum = parseInt(season, 10);

    const body: Record<string, unknown> = {
      draftId: draft.id,
      provider,
      leagueId: leagueId.trim(),
      season: seasonNum,
      importMode,
    };

    if (provider === 'espn') {
      body.isPrivate = isPrivate;
      if (isPrivate) {
        body.swid = swid;
        body.espnS2 = espnS2;
      }
    }

    const { data, error } = await supabase.functions.invoke('import-external-league', { body });

    if (error || !data?.success) {
      setSubmitError(data?.error ?? error?.message ?? 'Import failed. Please check your inputs and try again.');
      setSubmitting(false);
      return;
    }

    // Clear credentials from state after success — do not render them again
    setSwid('');
    setEspnS2('');
    setSummary(data as ImportSummary);
    setSubmitting(false);
  }

  // ── Loading / error states ────────────────────────────────────────────────

  if (loadingDraft) {
    return <div style={styles.page}><p style={{ color: '#9ca3af' }}>Loading...</p></div>;
  }

  if (draftError || !draft) {
    return (
      <div style={styles.page}>
        <p style={{ color: '#ef4444' }}>{draftError || 'Draft not found.'}</p>
        <Link to="/leagues" style={styles.linkBlue}>Back to Leagues</Link>
      </div>
    );
  }

  if (draft.status !== 'pending') {
    return (
      <div style={styles.page}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <Link to={`/drafts/${draftId}/participants`} style={styles.linkBlue}>← Back to Participants</Link>
          <UserMenu />
        </div>
        <div style={styles.errorBox}>
          <strong>Import not available</strong>
          <p style={{ margin: '6px 0 0 0' }}>
            External league imports can only be run before the draft starts. This draft has status: <strong>{draft.status}</strong>.
          </p>
        </div>
      </div>
    );
  }

  // ── Success summary ───────────────────────────────────────────────────────

  if (summary) {
    return (
      <div style={styles.page}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <Link to={`/drafts/${draftId}/participants`} style={styles.linkBlue}>← Back to Participants</Link>
          <UserMenu />
        </div>

        <h1 style={styles.heading}>Import Complete</h1>
        <p style={{ margin: '0 0 28px 0', color: '#6b7280', fontSize: '15px' }}>{draft.name}</p>

        <div style={styles.card}>
          <div style={styles.summaryGrid}>
            <SummaryRow label="League" value={summary.displayName} />
            <SummaryRow label="Provider" value={summary.provider.toUpperCase()} />
            <SummaryRow label="Scoring" value={summary.scoringType} />
            <SummaryRow label="Teams imported" value={String(summary.teamsImported)} />
            <SummaryRow label="Roster players imported" value={String(summary.rosterPlayersImported)} />
            <SummaryRow label="Players matched" value={String(summary.matchedPlayers)} />
            <SummaryRow label="Unresolved players" value={String(summary.unresolvedPlayers)} highlight={summary.unresolvedPlayers > 0} />
          </div>

          {summary.warnings.length > 0 && (
            <div style={{ marginTop: '20px', padding: '14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px' }}>
              <strong style={{ fontSize: '13px', color: '#92400e' }}>Warnings</strong>
              <ul style={{ margin: '8px 0 0 0', paddingLeft: '18px', color: '#78350f', fontSize: '13px', lineHeight: '1.7' }}>
                {summary.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <Link to={`/drafts/${draftId}/participants`} style={styles.btnSecondary}>
            Back to Participants
          </Link>
          <span
            title="Team mapping coming soon"
            style={{ ...styles.btnDisabled }}
          >
            Next: Map Teams (coming soon)
          </span>
        </div>
      </div>
    );
  }

  // ── Import form ───────────────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <Link to={`/drafts/${draftId}/participants`} style={styles.linkBlue}>← Back to Participants</Link>
        <UserMenu />
      </div>

      <h1 style={styles.heading}>External League Import</h1>
      <p style={{ margin: '0 0 6px 0', color: '#6b7280', fontSize: '15px' }}>{draft.name}</p>
      <p style={{ margin: '0 0 28px 0', color: '#9ca3af', fontSize: '13px' }}>
        ESPN and Sleeper imports are supported.
      </p>

      {submitError && (
        <div style={{ ...styles.errorBox, marginBottom: '20px' }}>
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit}>

        {/* Provider selection */}
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>Provider</legend>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {(['espn', 'sleeper'] as Provider[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => { setProvider(p); setIsPrivate(false); }}
                style={provider === p ? styles.providerCardActive : styles.providerCard}
              >
                <span style={{ fontSize: '18px', fontWeight: '700', display: 'block', marginBottom: '2px' }}>
                  {p === 'espn' ? 'ESPN' : 'Sleeper'}
                </span>
                <span style={{ fontSize: '12px', color: provider === p ? '#1e40af' : '#6b7280' }}>
                  {p === 'espn' ? 'Fantasy Football' : 'Fantasy App'}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* League ID */}
        <div style={styles.fieldGroup}>
          <label style={styles.label} htmlFor="leagueId">
            {provider === 'espn' ? 'ESPN League ID' : 'Sleeper League ID'}
          </label>
          <input
            id="leagueId"
            type="text"
            value={leagueId}
            onChange={e => setLeagueId(e.target.value)}
            placeholder={provider === 'espn' ? 'e.g. 12345678' : 'e.g. 1048572304857'}
            required
            style={styles.input}
          />
          {provider === 'espn' && (
            <p style={styles.hint}>Found in your ESPN league URL: .../league?leagueId=XXXXXXXX</p>
          )}
          {provider === 'sleeper' && (
            <p style={styles.hint}>Found in your Sleeper league URL: sleeper.com/leagues/XXXXXXXXXX</p>
          )}
        </div>

        {/* Season */}
        <div style={styles.fieldGroup}>
          <label style={styles.label} htmlFor="season">Season Year</label>
          <input
            id="season"
            type="number"
            value={season}
            onChange={e => setSeason(e.target.value)}
            min={2000}
            max={2100}
            required
            style={{ ...styles.input, maxWidth: '160px' }}
          />
        </div>

        {/* Import mode */}
        <div style={styles.fieldGroup}>
          <label style={styles.label} htmlFor="importMode">Import Mode</label>
          <select
            id="importMode"
            value={importMode}
            onChange={e => setImportMode(e.target.value as ImportMode)}
            style={styles.select}
          >
            {(Object.keys(IMPORT_MODE_LABELS) as ImportMode[]).map(m => (
              <option key={m} value={m}>{IMPORT_MODE_LABELS[m].label}</option>
            ))}
          </select>
          <p style={styles.hint}>{IMPORT_MODE_LABELS[importMode].description}</p>
        </div>

        {/* ESPN-only fields */}
        {provider === 'espn' && (
          <fieldset style={styles.fieldset}>
            <legend style={styles.legend}>ESPN Access</legend>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <button
                type="button"
                role="switch"
                aria-checked={isPrivate}
                onClick={() => setIsPrivate(!isPrivate)}
                style={isPrivate ? styles.toggleOn : styles.toggleOff}
              >
                <span style={isPrivate ? styles.toggleThumbOn : styles.toggleThumbOff} />
              </button>
              <span style={{ fontSize: '14px', color: '#374151' }}>Private league</span>
            </div>

            {isPrivate && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={styles.label} htmlFor="swid">SWID Cookie</label>
                  <input
                    id="swid"
                    type="password"
                    value={swid}
                    onChange={e => setSwid(e.target.value)}
                    placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                    required
                    autoComplete="off"
                    style={styles.input}
                  />
                  <p style={styles.hint}>Found in ESPN cookies as "SWID"</p>
                </div>
                <div>
                  <label style={styles.label} htmlFor="espnS2">espn_s2 Cookie</label>
                  <input
                    id="espnS2"
                    type="password"
                    value={espnS2}
                    onChange={e => setEspnS2(e.target.value)}
                    placeholder="Long alphanumeric string"
                    required
                    autoComplete="off"
                    style={styles.input}
                  />
                  <p style={styles.hint}>Found in ESPN cookies as "espn_s2"</p>
                </div>
              </div>
            )}
          </fieldset>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={submitting ? styles.btnDisabled : styles.btnPrimary}
        >
          {submitting ? 'Importing...' : 'Import League'}
        </button>
      </form>
    </div>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span style={{ fontSize: '14px', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '14px', fontWeight: '600', color: highlight ? '#dc2626' : '#111827' }}>{value}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  page: {
    padding: '32px 24px',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: '600px',
    margin: '0 auto',
  } as React.CSSProperties,

  heading: {
    margin: '0 0 8px 0',
    fontSize: '24px',
    fontWeight: '700',
    color: '#111827',
  } as React.CSSProperties,

  card: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px 24px',
  } as React.CSSProperties,

  summaryGrid: {
    display: 'flex',
    flexDirection: 'column',
  } as React.CSSProperties,

  fieldset: {
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px 20px',
    marginBottom: '20px',
  } as React.CSSProperties,

  legend: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
    padding: '0 6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  } as React.CSSProperties,

  fieldGroup: {
    marginBottom: '20px',
  } as React.CSSProperties,

  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '6px',
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#111827',
    background: '#ffffff',
    boxSizing: 'border-box' as const,
    outline: 'none',
  } as React.CSSProperties,

  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#111827',
    background: '#ffffff',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  hint: {
    margin: '5px 0 0 0',
    fontSize: '12px',
    color: '#9ca3af',
  } as React.CSSProperties,

  providerCard: {
    flex: 1,
    minWidth: '120px',
    padding: '14px 18px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    background: '#ffffff',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'border-color 0.15s',
  } as React.CSSProperties,

  providerCardActive: {
    flex: 1,
    minWidth: '120px',
    padding: '14px 18px',
    border: '2px solid #2563eb',
    borderRadius: '8px',
    background: '#eff6ff',
    cursor: 'pointer',
    textAlign: 'left' as const,
  } as React.CSSProperties,

  btnPrimary: {
    width: '100%',
    padding: '13px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '600',
    fontSize: '16px',
    cursor: 'pointer',
    marginTop: '8px',
  } as React.CSSProperties,

  btnSecondary: {
    display: 'inline-block',
    padding: '11px 20px',
    background: '#ffffff',
    color: '#2563eb',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    fontWeight: '600',
    fontSize: '15px',
    textDecoration: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnDisabled: {
    display: 'inline-block',
    padding: '11px 20px',
    background: '#f3f4f6',
    color: '#9ca3af',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    fontWeight: '600',
    fontSize: '15px',
    cursor: 'not-allowed',
    textDecoration: 'none',
  } as React.CSSProperties,

  errorBox: {
    padding: '14px 16px',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '6px',
    color: '#dc2626',
    fontSize: '14px',
  } as React.CSSProperties,

  linkBlue: {
    color: '#2563eb',
    textDecoration: 'none',
    fontSize: '14px',
  } as React.CSSProperties,

  toggleOff: {
    position: 'relative' as const,
    width: '44px',
    height: '24px',
    borderRadius: '9999px',
    background: '#d1d5db',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  } as React.CSSProperties,

  toggleOn: {
    position: 'relative' as const,
    width: '44px',
    height: '24px',
    borderRadius: '9999px',
    background: '#2563eb',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  } as React.CSSProperties,

  toggleThumbOff: {
    position: 'absolute' as const,
    top: '3px',
    left: '3px',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: '#ffffff',
    transition: 'left 0.15s',
  } as React.CSSProperties,

  toggleThumbOn: {
    position: 'absolute' as const,
    top: '3px',
    left: '23px',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: '#ffffff',
    transition: 'left 0.15s',
  } as React.CSSProperties,
} as const;
