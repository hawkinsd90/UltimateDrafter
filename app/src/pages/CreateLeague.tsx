import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getSeasonLabel } from '../utils/season';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';
import ScoringRulesPanel, { type ScoringRules } from '../components/ScoringRulesPanel';

type Provider = 'sleeper' | 'espn';

interface ImportedTeam {
  externalTeamId: string;
  externalOwnerId?: string;
  externalOwnerName?: string;
  teamName: string;
}

interface LeaguePreview {
  provider: Provider;
  externalLeagueId: string;
  displayName: string;
  numTeams: number;
  scoringType: string;
  rosterSettings: {
    qb: number; rb: number; wr: number; te: number;
    flex: number; op: number; k: number; dst: number; bench: number;
  };
  scoringRules: ScoringRules;
  teams: ImportedTeam[];
  warnings: string[];
}

export default function CreateLeague() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [sport, setSport] = useState('football');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [settings, setSettings] = useState({
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
    roster_op: 0,
    roster_k: 1,
    roster_dst: 1,
    bench: 6,
    allow_trades: true,
    allow_pick_trades: true,
    allow_future_picks: false,
    future_pick_years: 1,
  });

  const [scoringRules, setScoringRules] = useState<ScoringRules>({
    pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    xpm: 1, fgmiss: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_59: 5, fg_60p: 5,
    def_sack: 1, def_int: 2, def_fum_rec: 2, def_safe: 2, def_blk_kick: 2, def_td: 6,
    dst_pa0: 10, dst_pa1: 7, dst_pa7: 4, dst_pa14: 1, dst_pa28: -1, dst_pa35: -3, dst_pa46: -5,
    fum_lost: -2,
  });

  // Import section state
  const [showImport, setShowImport] = useState(false);
  const [importProvider, setImportProvider] = useState<Provider>('sleeper');
  const [importLeagueId, setImportLeagueId] = useState('');
  const [importSeason, setImportSeason] = useState(String(new Date().getFullYear()));
  const [importIsPrivate, setImportIsPrivate] = useState(false);
  const [importSwid, setImportSwid] = useState('');
  const [importEspnS2, setImportEspnS2] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [preview, setPreview] = useState<LeaguePreview | null>(null);

  const season = getSeasonLabel(sport);

  async function handleFetchPreview(e: React.FormEvent) {
    e.preventDefault();
    setImportLoading(true);
    setImportError('');
    setPreview(null);

    const body: Record<string, unknown> = {
      provider: importProvider,
      leagueId: importLeagueId.trim(),
      season: parseInt(importSeason, 10),
    };
    if (importProvider === 'espn') {
      body.isPrivate = importIsPrivate;
      if (importIsPrivate) {
        body.swid = importSwid;
        body.espnS2 = importEspnS2;
      }
    }

    const { data, error: fnError } = await supabase.functions.invoke('preview-external-league', { body });

    if (fnError || !data?.success) {
      // fnError.context holds the parsed 4xx body when the edge function returns non-2xx
      const contextError = fnError?.context && typeof fnError.context === 'object'
        ? (fnError.context as Record<string, unknown>).error as string | undefined
        : undefined;
      setImportError(contextError ?? data?.error ?? 'Failed to fetch league. Check the ID and try again.');
      setImportLoading(false);
      return;
    }

    const p = data as LeaguePreview & { success: true };
    setPreview(p);

    // Pre-fill name, roster settings, and scoring rules from the imported league
    setName(p.displayName);
    if (p.scoringRules && Object.keys(p.scoringRules).length > 0) {
      setScoringRules(p.scoringRules);
    }
    setSettings(prev => ({
      ...prev,
      roster_qb: p.rosterSettings.qb,
      roster_rb: p.rosterSettings.rb,
      roster_wr: p.rosterSettings.wr,
      roster_te: p.rosterSettings.te,
      roster_flex: p.rosterSettings.flex,
      roster_op: p.rosterSettings.op,
      roster_k: p.rosterSettings.k,
      roster_dst: p.rosterSettings.dst,
      bench: p.rosterSettings.bench,
    }));

    // Clear credentials from state after use
    setImportSwid('');
    setImportEspnS2('');
    setImportLoading(false);
  }

  function clearPreview() {
    setPreview(null);
    setImportLeagueId('');
    setImportError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!user?.id) {
      setError('You must be signed in to create a league');
      setLoading(false);
      return;
    }

    if (settings.drafting_hours_enabled && (!settings.drafting_hours_start || !settings.drafting_hours_end)) {
      setError('Please provide both start and end times for drafting hours');
      setLoading(false);
      return;
    }

    const { data: leagueData, error: leagueError } = await supabase
      .from('leagues')
      .insert({ name, sport, season, owner_id: user.id, settings: {} })
      .select()
      .single();

    if (leagueError || !leagueData) {
      setLoading(false);
      setError('Error creating league: ' + (leagueError?.message ?? 'Unknown error'));
      return;
    }

    await supabase.from('league_members').insert({
      league_id: leagueData.id,
      user_id: user.id,
      display_name: user.email?.split('@')[0] || 'Commissioner',
      role: 'owner',
    });

    const { error: settingsError } = await supabase.from('league_settings').insert({
      league_id: leagueData.id,
      created_by: user.id,
      draft_format: settings.draft_format,
      pick_timer_seconds: settings.pick_timer_seconds,
      allow_pauses: settings.allow_pauses,
      drafting_hours_enabled: settings.drafting_hours_enabled,
      drafting_hours_start: settings.drafting_hours_enabled ? settings.drafting_hours_start : null,
      drafting_hours_end: settings.drafting_hours_enabled ? settings.drafting_hours_end : null,
      roster_qb: settings.roster_qb,
      roster_rb: settings.roster_rb,
      roster_wr: settings.roster_wr,
      roster_te: settings.roster_te,
      roster_flex: settings.roster_flex,
      roster_op: settings.roster_op,
      roster_k: settings.roster_k,
      roster_dst: settings.roster_dst,
      bench: settings.bench,
      allow_trades: settings.allow_trades,
      allow_pick_trades: settings.allow_pick_trades,
      allow_future_picks: settings.allow_future_picks,
      future_pick_years: settings.allow_future_picks ? settings.future_pick_years : 1,
    });

    if (settingsError) {
      setLoading(false);
      setError('League created but error saving settings: ' + settingsError.message);
      return;
    }

    // Save scoring rules
    const scoringRows = Object.entries(scoringRules)
      .filter(([, pts]) => pts !== 0)
      .map(([stat_key, points]) => ({ league_id: leagueData.id, stat_key, points }));
    if (scoringRows.length > 0) {
      await supabase.from('league_scoring_rules').insert(scoringRows);
    }

    // Save imported member names so they can be invited later
    if (preview && preview.teams.length > 0) {
      const rows = preview.teams
        .filter(t => t.externalOwnerId || t.externalOwnerName)
        .map(t => ({
          league_id: leagueData.id,
          provider: preview.provider,
          external_league_id: preview.externalLeagueId,
          external_team_id: t.externalTeamId,
          external_owner_id: t.externalOwnerId ?? null,
          external_owner_name: t.externalOwnerName ?? null,
          team_name: t.teamName,
        }));
      if (rows.length > 0) {
        await supabase.from('league_imported_members').insert(rows);
      }
    }

    setLoading(false);
    navigate(`/leagues/${leagueData.id}`);
  }

  const cardStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '20px',
    padding: '20px', background: 'white', borderRadius: '8px',
    border: '1px solid #e5e7eb', color: '#111827',
  };
  const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '5px', fontWeight: '500', color: '#374151' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px', color: '#111827', background: 'white', boxSizing: 'border-box' };

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '12px', flexWrap: 'nowrap', minWidth: 0 }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <UserMenu />
      </div>

      <h1 style={{ color: '#f9fafb' }}>Create League</h1>

      {/* Import from existing league */}
      <div style={{ maxWidth: '960px', marginBottom: '24px' }}>
        <button
          type="button"
          onClick={() => { setShowImport(v => !v); setImportError(''); }}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '12px 18px', background: showImport ? '#1e3a5f' : '#1e293b',
            border: `1px solid ${showImport ? '#3b82f6' : '#334155'}`,
            borderRadius: '8px', cursor: 'pointer', color: '#e2e8f0',
            fontSize: '14px', fontWeight: '600', width: '100%', justifyContent: 'space-between',
            transition: 'background 0.15s, border-color 0.15s',
          }}
        >
          <span>Import settings from Sleeper or ESPN</span>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            {showImport ? '▲ Hide' : '▼ Expand'}
          </span>
        </button>

        {showImport && (
          <div style={{
            padding: '20px', background: '#0f172a',
            border: '1px solid #334155', borderTop: 'none',
            borderRadius: '0 0 8px 8px',
          }}>
            {!preview ? (
              <form onSubmit={handleFetchPreview} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                  Importing here pre-fills league settings and saves team/member names for invites. Roster/keeper import is completed when setting up a draft.
                </p>

                {/* Provider toggle */}
                <div style={{ display: 'flex', gap: '10px' }}>
                  {(['sleeper', 'espn'] as Provider[]).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { setImportProvider(p); setImportIsPrivate(false); }}
                      style={{
                        flex: 1, padding: '10px 14px', fontSize: '14px', fontWeight: '700',
                        borderRadius: '7px', cursor: 'pointer',
                        background: importProvider === p ? '#1d4ed8' : 'transparent',
                        color: importProvider === p ? '#fff' : '#94a3b8',
                        border: `1px solid ${importProvider === p ? '#2563eb' : '#334155'}`,
                        transition: 'all 0.12s',
                      }}
                    >
                      {p === 'sleeper' ? 'Sleeper' : 'ESPN'}
                    </button>
                  ))}
                </div>

                {/* League ID */}
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#cbd5e1', marginBottom: '5px' }}>
                    {importProvider === 'espn' ? 'ESPN League ID' : 'Sleeper League ID'}
                  </label>
                  <input
                    type="text"
                    value={importLeagueId}
                    onChange={e => setImportLeagueId(e.target.value)}
                    placeholder={importProvider === 'espn' ? 'e.g. 12345678' : 'e.g. 1048572304857'}
                    required
                    style={{ ...inputStyle, background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' }}
                  />
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                    {importProvider === 'espn'
                      ? 'Found in your ESPN league URL: .../league?leagueId=XXXXXXXX'
                      : 'Found in your Sleeper league URL: sleeper.com/leagues/XXXXXXXXXX'}
                  </p>
                </div>

                {/* Season (ESPN only) */}
                {importProvider === 'espn' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#cbd5e1', marginBottom: '5px' }}>
                      Season Year
                    </label>
                    <input
                      type="number"
                      value={importSeason}
                      onChange={e => setImportSeason(e.target.value)}
                      min={2000} max={2100}
                      style={{ ...inputStyle, maxWidth: '140px', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' }}
                    />
                  </div>
                )}

                {/* ESPN private toggle */}
                {importProvider === 'espn' && (
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#cbd5e1' }}>
                      <input
                        type="checkbox"
                        checked={importIsPrivate}
                        onChange={e => setImportIsPrivate(e.target.checked)}
                      />
                      Private league (requires SWID + espn_s2 cookies)
                    </label>
                    {importIsPrivate && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px', marginLeft: '24px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#94a3b8', marginBottom: '4px' }}>SWID Cookie</label>
                          <input
                            type="password" value={importSwid} onChange={e => setImportSwid(e.target.value)}
                            placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                            autoComplete="off"
                            style={{ ...inputStyle, background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#94a3b8', marginBottom: '4px' }}>espn_s2 Cookie</label>
                          <input
                            type="password" value={importEspnS2} onChange={e => setImportEspnS2(e.target.value)}
                            placeholder="Long alphanumeric string"
                            autoComplete="off"
                            style={{ ...inputStyle, background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {importError && (
                  <div style={{ padding: '10px 14px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '13px' }}>
                    {importError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={importLoading}
                  style={{
                    padding: '10px 20px', background: importLoading ? '#1e293b' : '#2563eb',
                    color: importLoading ? '#64748b' : '#fff', border: 'none',
                    borderRadius: '7px', fontWeight: '600', fontSize: '14px',
                    cursor: importLoading ? 'not-allowed' : 'pointer', alignSelf: 'flex-start',
                  }}
                >
                  {importLoading ? 'Fetching...' : 'Fetch League'}
                </button>
              </form>
            ) : (
              <div>
                {/* Preview success */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ padding: '2px 8px', background: '#14532d', color: '#86efac', borderRadius: '4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>
                        Imported
                      </span>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9' }}>{preview.displayName}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      {preview.provider.toUpperCase()} · {preview.numTeams} teams · {preview.scoringType}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearPreview}
                    style={{ fontSize: '12px', color: '#94a3b8', background: 'transparent', border: '1px solid #334155', borderRadius: '5px', padding: '4px 10px', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                </div>

                {/* Roster settings preview */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '14px' }}>
                  {[
                    ['QB', preview.rosterSettings.qb],
                    ['RB', preview.rosterSettings.rb],
                    ['WR', preview.rosterSettings.wr],
                    ['TE', preview.rosterSettings.te],
                    ['FLEX', preview.rosterSettings.flex],
                    ...(preview.rosterSettings.op > 0 ? [['OP/SF', preview.rosterSettings.op]] : []),
                    ['K', preview.rosterSettings.k],
                    ['DST', preview.rosterSettings.dst],
                    ['Bench', preview.rosterSettings.bench],
                  ].map(([label, val]) => (
                    <div key={label as string} style={{ background: '#1e293b', borderRadius: '5px', padding: '6px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' }}>{label}</div>
                      <div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f5f9' }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Teams / members */}
                {preview.teams.length > 0 && (
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Teams ({preview.teams.length}) — member names will be saved for invites
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                      {preview.teams.map(t => (
                        <div key={t.externalTeamId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#1e293b', borderRadius: '5px' }}>
                          <span style={{ fontSize: '13px', color: '#e2e8f0' }}>{t.teamName}</span>
                          {t.externalOwnerName && t.externalOwnerName !== t.teamName && (
                            <span style={{ fontSize: '11px', color: '#64748b' }}>{t.externalOwnerName}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {preview.warnings.length > 0 && (
                  <div style={{ marginTop: '12px', padding: '10px 14px', background: '#451a03', border: '1px solid #f59e0b', borderRadius: '6px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#fbbf24', marginBottom: '4px' }}>Warnings</div>
                    <ul style={{ margin: 0, paddingLeft: '16px', color: '#fcd34d', fontSize: '12px', lineHeight: '1.6' }}>
                      {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <p style={{ margin: '12px 0 0', fontSize: '12px', color: '#64748b' }}>
                  League name and roster settings have been pre-filled below. You can adjust them before creating.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: '960px', display: 'flex', flexDirection: 'column', gap: '30px' }}>
        <div style={cardStyle}>
          <h2 style={{ margin: '0', fontSize: '20px', color: '#111827' }}>Basic Information</h2>

          <div>
            <label style={labelStyle}>League Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Sport</label>
            <select value={sport} onChange={(e) => setSport(e.target.value)} style={inputStyle}>
              <option value="football">Football</option>
              <option value="basketball">Basketball</option>
              <option value="baseball">Baseball</option>
              <option value="hockey">Hockey</option>
            </select>
          </div>

          <div>
            <label style={{ ...labelStyle, color: '#6b7280' }}>Season</label>
            <div style={{ padding: '10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', color: '#374151' }}>
              {season}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          <div style={cardStyle}>
            <h2 style={{ margin: '0', fontSize: '20px', color: '#111827' }}>Draft Settings</h2>

            <div>
              <label style={labelStyle}>Draft Format</label>
              <select value={settings.draft_format} onChange={(e) => setSettings({ ...settings, draft_format: e.target.value })} style={inputStyle}>
                <option value="snake">Snake Draft</option>
                <option value="linear">Linear Draft</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Pick Timer</label>
              <select value={settings.pick_timer_seconds} onChange={(e) => setSettings({ ...settings, pick_timer_seconds: parseInt(e.target.value) })} style={inputStyle}>
                <option value="30">30 seconds</option>
                <option value="60">60 seconds</option>
                <option value="90">90 seconds</option>
                <option value="120">2 minutes</option>
                <option value="0">Unlimited</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#374151' }}>
                <input type="checkbox" checked={settings.allow_pauses} onChange={(e) => setSettings({ ...settings, allow_pauses: e.target.checked })} />
                <span>Allow draft pauses</span>
              </label>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '10px', color: '#374151' }}>
                <input type="checkbox" checked={settings.drafting_hours_enabled} onChange={(e) => setSettings({ ...settings, drafting_hours_enabled: e.target.checked })} />
                <span>Restrict drafting hours</span>
              </label>
              {settings.drafting_hours_enabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginLeft: '30px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: '#374151' }}>Start Time</label>
                    <input type="time" value={settings.drafting_hours_start} onChange={(e) => setSettings({ ...settings, drafting_hours_start: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: '#374151' }}>End Time</label>
                    <input type="time" value={settings.drafting_hours_end} onChange={(e) => setSettings({ ...settings, drafting_hours_end: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              )}
            </div>

            <h3 style={{ margin: '10px 0 0 0', fontSize: '18px', color: '#111827' }}>League Behavior</h3>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#374151' }}>
                <input type="checkbox" checked={settings.allow_trades} onChange={(e) => setSettings({ ...settings, allow_trades: e.target.checked })} />
                <span>Allow player trades</span>
              </label>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#374151' }}>
                <input type="checkbox" checked={settings.allow_pick_trades} onChange={(e) => setSettings({ ...settings, allow_pick_trades: e.target.checked })} />
                <span>Allow draft pick trades</span>
              </label>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#374151' }}>
                <input type="checkbox" checked={settings.allow_future_picks} onChange={(e) => setSettings({ ...settings, allow_future_picks: e.target.checked })} />
                <span>Allow future draft pick trades</span>
              </label>
              {settings.allow_future_picks && (
                <div style={{ marginTop: '8px', marginLeft: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ fontSize: '13px', color: '#6b7280', whiteSpace: 'nowrap' }}>Years into the future</label>
                  <select
                    value={settings.future_pick_years}
                    onChange={(e) => setSettings({ ...settings, future_pick_years: parseInt(e.target.value, 10) })}
                    style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px', background: '#fff', color: '#111827' }}
                  >
                    <option value={1}>1 year</option>
                    <option value={2}>2 years</option>
                    <option value={3}>3 years</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ margin: '0', fontSize: '20px', color: '#111827' }}>Roster Settings</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              {[
                { key: 'roster_qb', label: 'QB' },
                { key: 'roster_rb', label: 'RB' },
                { key: 'roster_wr', label: 'WR' },
                { key: 'roster_te', label: 'TE' },
                { key: 'roster_flex', label: 'FLEX' },
                { key: 'roster_op', label: 'OP/SF' },
                { key: 'roster_k', label: 'K' },
                { key: 'roster_dst', label: 'DST' },
                { key: 'bench', label: 'Bench' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px', color: '#374151' }}>
                    {label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings[key as keyof typeof settings] as number}
                    onChange={(e) => setSettings({ ...settings, [key]: parseInt(e.target.value) || 0 })}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scoring Rules */}
        <div style={cardStyle}>
          <h2 style={{ margin: '0', fontSize: '20px', color: '#111827' }}>Scoring Rules</h2>
          <p style={{ margin: '0', fontSize: '13px', color: '#6b7280' }}>
            Customize how points are awarded. Importing a league above will pre-fill these from your platform.
          </p>
          <ScoringRulesPanel rules={scoringRules} onChange={setScoringRules} />
        </div>

        {error && (
          <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 24px',
            background: loading ? '#9ca3af' : '#059669',
            color: 'white', border: 'none', borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: '500', fontSize: '16px',
          }}
        >
          {loading ? 'Creating League...' : 'Create League'}
        </button>
      </form>
    </div>
  );
}
