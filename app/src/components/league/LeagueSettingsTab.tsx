import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/supabase';

type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

interface Props {
  leagueId: string;
  leagueSettings: LeagueSettings | null;
  isOwner: boolean;
  onSaved: () => void;
}

type FormData = {
  draft_format: string;
  pick_timer_seconds: number;
  default_draft_type: string;
  default_rounds: number;
  allow_pauses: boolean;
  drafting_hours_enabled: boolean;
  drafting_hours_start: string;
  drafting_hours_end: string;
  roster_qb: number;
  roster_rb: number;
  roster_wr: number;
  roster_te: number;
  roster_flex: number;
  roster_k: number;
  roster_dst: number;
  roster_op: number;
  bench: number;
  allow_trades: boolean;
  allow_pick_trades: boolean;
  allow_future_picks: boolean;
  future_pick_years: number;
  roster_limits_enabled: boolean;
  max_qb: number | null;
  max_rb: number | null;
  max_wr: number | null;
  max_te: number | null;
  max_k: number | null;
  max_dst: number | null;
};

type ExtLeagueSettings = LeagueSettings & {
  roster_op?: number;
  roster_limits_enabled?: boolean;
  max_qb?: number | null;
  max_rb?: number | null;
  max_wr?: number | null;
  max_te?: number | null;
  max_k?: number | null;
  max_dst?: number | null;
  allow_future_picks?: boolean;
  future_pick_years?: number;
  default_draft_type?: string;
  default_rounds?: number;
};

function settingsToForm(s: LeagueSettings): FormData {
  const ext = s as ExtLeagueSettings;
  return {
    draft_format: s.draft_format,
    pick_timer_seconds: s.pick_timer_seconds,
    default_draft_type: ext.default_draft_type ?? 'snake',
    default_rounds: ext.default_rounds ?? 15,
    allow_pauses: s.allow_pauses,
    drafting_hours_enabled: s.drafting_hours_enabled,
    drafting_hours_start: s.drafting_hours_start || '',
    drafting_hours_end: s.drafting_hours_end || '',
    roster_qb: s.roster_qb,
    roster_rb: s.roster_rb,
    roster_wr: s.roster_wr,
    roster_te: s.roster_te,
    roster_flex: s.roster_flex,
    roster_k: s.roster_k,
    roster_dst: s.roster_dst,
    roster_op: ext.roster_op ?? 0,
    bench: s.bench,
    allow_trades: s.allow_trades,
    allow_pick_trades: s.allow_pick_trades,
    allow_future_picks: ext.allow_future_picks ?? false,
    future_pick_years: ext.future_pick_years ?? 1,
    roster_limits_enabled: ext.roster_limits_enabled ?? false,
    max_qb:  ext.max_qb  ?? null,
    max_rb:  ext.max_rb  ?? null,
    max_wr:  ext.max_wr  ?? null,
    max_te:  ext.max_te  ?? null,
    max_k:   ext.max_k   ?? null,
    max_dst: ext.max_dst ?? null,
  };
}

const DEFAULTS: FormData = {
  draft_format: 'snake', pick_timer_seconds: 90, default_draft_type: 'snake', default_rounds: 15,
  allow_pauses: true,
  drafting_hours_enabled: false, drafting_hours_start: '', drafting_hours_end: '',
  roster_qb: 1, roster_rb: 2, roster_wr: 2, roster_te: 1, roster_flex: 1,
  roster_k: 1, roster_dst: 1, roster_op: 0, bench: 6, allow_trades: true, allow_pick_trades: true,
  allow_future_picks: false, future_pick_years: 1,
  roster_limits_enabled: false, max_qb: null, max_rb: null, max_wr: null, max_te: null, max_k: null, max_dst: null,
};

const ROSTER_SLOTS = [
  { key: 'roster_qb',   label: 'QB' },
  { key: 'roster_rb',   label: 'RB' },
  { key: 'roster_wr',   label: 'WR' },
  { key: 'roster_te',   label: 'TE' },
  { key: 'roster_flex', label: 'FLEX' },
  { key: 'roster_k',    label: 'K' },
  { key: 'roster_dst',  label: 'DST' },
  { key: 'roster_op',   label: 'SuperFlex (OP)' },
  { key: 'bench',       label: 'Bench' },
] as const;

const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' };

export default function LeagueSettingsTab({ leagueId, leagueSettings, isOwner, onSaved }: Props) {
  const [formData, setFormData] = useState<FormData>(leagueSettings ? settingsToForm(leagueSettings) : DEFAULTS);
  const [saving, setSaving]     = useState(false);
  const [message, setMessage]   = useState('');

  useEffect(() => {
    if (leagueSettings) setFormData(settingsToForm(leagueSettings));
  }, [leagueSettings]);

  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setFormData(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (formData.drafting_hours_enabled && (!formData.drafting_hours_start || !formData.drafting_hours_end)) {
      setMessage('Please provide both start and end times for drafting hours');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const { error } = await supabase.from('league_settings').update({
        ...formData,
        drafting_hours_start: formData.drafting_hours_enabled ? formData.drafting_hours_start : null,
        drafting_hours_end:   formData.drafting_hours_enabled ? formData.drafting_hours_end   : null,
      }).eq('league_id', leagueId);

      if (error) {
        setMessage('Error updating settings: ' + error.message);
      } else {
        setMessage('Settings updated successfully');
        onSaved();
      }
    } catch {
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  }

  if (!leagueSettings) {
    return (
      <div style={{ padding: '40px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: '8px' }}>
        <p style={{ margin: '0', color: '#92400e' }}>No settings configured for this league.</p>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div>
        <div style={{ padding: '20px', background: '#f3f4f6', borderRadius: '8px', marginBottom: '20px' }}>
          <p style={{ margin: '0', fontSize: '14px', color: '#6b7280' }}>You are viewing settings in read-only mode. Only the league owner can edit settings.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '30px' }}>
          <div>
            <h3 style={{ marginTop: '0' }}>Draft Settings</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div><strong>Draft Format:</strong> {leagueSettings.draft_format}</div>
              <div><strong>Pick Timer:</strong> {leagueSettings.pick_timer_seconds === 0 ? 'Unlimited' : `${leagueSettings.pick_timer_seconds} seconds`}</div>
              <div><strong>Default Draft Type:</strong> {(leagueSettings as ExtLeagueSettings).default_draft_type ?? 'snake'}</div>
              <div><strong>Default Rounds:</strong> {(leagueSettings as ExtLeagueSettings).default_rounds ?? 15}</div>
              <div><strong>Allow Pauses:</strong> {leagueSettings.allow_pauses ? 'Yes' : 'No'}</div>
              <div><strong>Drafting Hours:</strong> {leagueSettings.drafting_hours_enabled ? `${leagueSettings.drafting_hours_start} - ${leagueSettings.drafting_hours_end}` : 'Not restricted'}</div>
            </div>
          </div>
          <div>
            <h3 style={{ marginTop: '0' }}>League Behavior</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div><strong>Allow Trades:</strong> {leagueSettings.allow_trades ? 'Yes' : 'No'}</div>
              <div><strong>Allow Pick Trades:</strong> {leagueSettings.allow_pick_trades ? 'Yes' : 'No'}</div>
              <div><strong>Allow Future Pick Trades:</strong> {(leagueSettings as ExtLeagueSettings).allow_future_picks ? `Yes (${(leagueSettings as ExtLeagueSettings).future_pick_years ?? 1} year${((leagueSettings as ExtLeagueSettings).future_pick_years ?? 1) !== 1 ? 's' : ''})` : 'No'}</div>
            </div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '24px' }}>
          <h3 style={{ marginTop: '0' }}>Roster Settings</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            {ROSTER_SLOTS.map(({ key, label }) => (
              <div key={key}><strong>{label}:</strong> {(leagueSettings as Record<string, unknown>)[key] as number}</div>
            ))}
          </div>
        </div>
        {(leagueSettings as ExtLeagueSettings).roster_limits_enabled && (
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '24px' }}>
            <h3 style={{ marginTop: '0' }}>Roster Limits</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {([
                { key: 'max_qb',  label: 'Max QB' },
                { key: 'max_rb',  label: 'Max RB' },
                { key: 'max_wr',  label: 'Max WR' },
                { key: 'max_te',  label: 'Max TE' },
                { key: 'max_k',   label: 'Max K' },
                { key: 'max_dst', label: 'Max DST' },
              ] as { key: keyof ExtLeagueSettings; label: string }[]).map(({ key, label }) => {
                const val = (leagueSettings as ExtLeagueSettings)[key];
                return <div key={key}><strong>{label}:</strong> {val == null ? 'No limit' : String(val)}</div>;
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 20px 0' }}>League Settings</h2>
      <form onSubmit={handleSave}>
        {message && (
          <div style={{ padding: '12px 20px', background: message.includes('Error') ? '#fef2f2' : '#f0fdf4', color: message.includes('Error') ? '#991b1b' : '#166534', borderRadius: '6px', marginBottom: '20px' }}>
            {message}
          </div>
        )}

        {/* Row 1: Draft Settings + League Behavior */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '30px' }}>
          <div>
            <h3 style={{ marginTop: '0' }}>Draft Settings</h3>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Draft Format</label>
              <select value={formData.draft_format} onChange={e => setField('draft_format', e.target.value)} style={inputStyle}>
                <option value="snake">Snake</option>
                <option value="linear">Linear</option>
              </select>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Pick Timer (seconds, 0 = unlimited)</label>
              <input type="number" min="0" value={formData.pick_timer_seconds} onChange={e => setField('pick_timer_seconds', parseInt(e.target.value) || 0)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Default Draft Type</label>
              <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>Used for new drafts and draft pick previews on rosters.</p>
              <div style={{ display: 'flex', gap: '10px' }}>
                {(['snake', 'linear'] as const).map(type => (
                  <button
                    key={type} type="button"
                    onClick={() => setField('default_draft_type', type)}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '6px', cursor: 'pointer',
                      border: `2px solid ${formData.default_draft_type === type ? '#2563eb' : '#d1d5db'}`,
                      background: formData.default_draft_type === type ? '#eff6ff' : 'white',
                      fontWeight: formData.default_draft_type === type ? '600' : '400',
                      color: formData.default_draft_type === type ? '#1d4ed8' : '#374151',
                    }}
                  >
                    {type === 'snake' ? 'Snake' : 'Linear'}
                    <div style={{ fontSize: '11px', color: formData.default_draft_type === type ? '#3b82f6' : '#9ca3af', marginTop: '2px' }}>
                      {type === 'snake' ? 'Order reverses each round' : 'Same order every round'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Default Number of Rounds</label>
              <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>Used for new drafts and draft pick previews on rosters.</p>
              <input type="number" min="1" max="50" value={formData.default_rounds} onChange={e => setField('default_rounds', parseInt(e.target.value) || 15)} style={{ ...inputStyle, maxWidth: '120px' }} />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={formData.allow_pauses} onChange={e => setField('allow_pauses', e.target.checked)} />
                <span>Allow draft pauses</span>
              </label>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '10px' }}>
                <input type="checkbox" checked={formData.drafting_hours_enabled} onChange={e => setField('drafting_hours_enabled', e.target.checked)} />
                <span>Restrict drafting hours</span>
              </label>
              {formData.drafting_hours_enabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginLeft: '30px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>Start Time</label>
                    <input type="time" value={formData.drafting_hours_start} onChange={e => setField('drafting_hours_start', e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>End Time</label>
                    <input type="time" value={formData.drafting_hours_end} onChange={e => setField('drafting_hours_end', e.target.value)} style={inputStyle} />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div>
            <h3 style={{ marginTop: '0' }}>League Behavior</h3>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={formData.allow_trades} onChange={e => setField('allow_trades', e.target.checked)} />
                <span>Allow player trades</span>
              </label>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={formData.allow_pick_trades} onChange={e => setField('allow_pick_trades', e.target.checked)} />
                <span>Allow draft pick trades</span>
              </label>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={formData.allow_future_picks} onChange={e => setField('allow_future_picks', e.target.checked)} />
                <span>Allow future draft pick trades</span>
              </label>
              {formData.allow_future_picks && (
                <div style={{ marginTop: '10px', marginLeft: '24px' }}>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: '500' }}>Years ahead</label>
                  <select
                    value={formData.future_pick_years}
                    onChange={e => setField('future_pick_years', parseInt(e.target.value, 10))}
                    style={{ ...inputStyle, maxWidth: '120px' }}
                  >
                    <option value={1}>1 year</option>
                    <option value={2}>2 years</option>
                    <option value={3}>3 years</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Roster Settings — full width, league-scoped */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '24px', marginBottom: '30px' }}>
          <h3 style={{ marginTop: '0' }}>Roster Settings</h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#6b7280' }}>
            These limits define the roster format for this league. They are automatically populated when you import an external league through a draft.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
            {ROSTER_SLOTS.map(({ key, label }) => (
              <div key={key}>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: '500' }}>{label}</label>
                <input type="number" min="0" value={formData[key] as number} onChange={e => setField(key, parseInt(e.target.value) || 0)} style={inputStyle} />
              </div>
            ))}
          </div>
        </div>

        {/* Roster Limits — per-position max caps, inherited by all drafts */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '24px', marginBottom: '30px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <h3 style={{ margin: '0' }}>Roster Limits</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: '#6b7280', fontWeight: '400' }}>
              <input type="checkbox" checked={formData.roster_limits_enabled} onChange={e => setField('roster_limits_enabled', e.target.checked)} />
              Enable
            </label>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#6b7280' }}>
            Optionally cap how many players of each position a team may draft. These limits apply to all drafts in this league.
          </p>
          {formData.roster_limits_enabled ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
              {([
                { key: 'max_qb',  label: 'Max QB' },
                { key: 'max_rb',  label: 'Max RB' },
                { key: 'max_wr',  label: 'Max WR' },
                { key: 'max_te',  label: 'Max TE' },
                { key: 'max_k',   label: 'Max K' },
                { key: 'max_dst', label: 'Max DST' },
              ] as { key: keyof FormData; label: string }[]).map(({ key, label }) => (
                <div key={key}>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: '500' }}>{label}</label>
                  <input
                    type="number" min="0" max="20"
                    value={(formData[key] as number | null) ?? ''}
                    placeholder="No limit"
                    onChange={e => setField(key, e.target.value === '' ? null : parseInt(e.target.value, 10))}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af', fontStyle: 'italic' }}>
              No per-position maximums. Teams can draft any number of a given position.
            </p>
          )}
        </div>

        <div style={{ paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
          <button
            type="submit"
            disabled={saving}
            style={{ padding: '12px 24px', background: saving ? '#9ca3af' : '#2563eb', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: '500', cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
