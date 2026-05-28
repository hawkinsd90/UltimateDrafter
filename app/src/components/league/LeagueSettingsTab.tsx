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
  bench: number;
  allow_trades: boolean;
  allow_pick_trades: boolean;
};

function settingsToForm(s: LeagueSettings): FormData {
  return {
    draft_format: s.draft_format,
    pick_timer_seconds: s.pick_timer_seconds,
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
    bench: s.bench,
    allow_trades: s.allow_trades,
    allow_pick_trades: s.allow_pick_trades,
  };
}

const DEFAULTS: FormData = {
  draft_format: 'snake', pick_timer_seconds: 90, allow_pauses: true,
  drafting_hours_enabled: false, drafting_hours_start: '', drafting_hours_end: '',
  roster_qb: 1, roster_rb: 2, roster_wr: 2, roster_te: 1, roster_flex: 1,
  roster_k: 1, roster_dst: 1, bench: 6, allow_trades: true, allow_pick_trades: true,
};

const ROSTER_SLOTS = [
  { key: 'roster_qb',   label: 'QB' },
  { key: 'roster_rb',   label: 'RB' },
  { key: 'roster_wr',   label: 'WR' },
  { key: 'roster_te',   label: 'TE' },
  { key: 'roster_flex', label: 'FLEX' },
  { key: 'roster_k',    label: 'K' },
  { key: 'roster_dst',  label: 'DST' },
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          <div>
            <h3 style={{ marginTop: '0' }}>Draft Settings</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div><strong>Draft Format:</strong> {leagueSettings.draft_format}</div>
              <div><strong>Pick Timer:</strong> {leagueSettings.pick_timer_seconds === 0 ? 'Unlimited' : `${leagueSettings.pick_timer_seconds} seconds`}</div>
              <div><strong>Allow Pauses:</strong> {leagueSettings.allow_pauses ? 'Yes' : 'No'}</div>
              <div><strong>Drafting Hours:</strong> {leagueSettings.drafting_hours_enabled ? `${leagueSettings.drafting_hours_start} - ${leagueSettings.drafting_hours_end}` : 'Not restricted'}</div>
            </div>
            <h3>Roster Settings</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {ROSTER_SLOTS.map(({ key, label }) => (
                <div key={key}><strong>{label}:</strong> {leagueSettings[key]}</div>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ marginTop: '0' }}>League Behavior</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div><strong>Allow Trades:</strong> {leagueSettings.allow_trades ? 'Yes' : 'No'}</div>
              <div><strong>Allow Pick Trades:</strong> {leagueSettings.allow_pick_trades ? 'Yes' : 'No'}</div>
            </div>
          </div>
        </div>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
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
            <h3>Roster Settings</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              {ROSTER_SLOTS.map(({ key, label }) => (
                <div key={key}>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: '500' }}>{label}</label>
                  <input type="number" min="0" value={formData[key] as number} onChange={e => setField(key, parseInt(e.target.value) || 0)} style={inputStyle} />
                </div>
              ))}
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
          </div>
        </div>
        <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
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
