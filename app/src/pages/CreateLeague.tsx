import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getSeasonLabel } from '../utils/season';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

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
    roster_k: 1,
    roster_dst: 1,
    bench: 6,
    allow_trades: true,
    allow_pick_trades: true,
  });

  const season = getSeasonLabel(sport);

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
      .insert({
        name,
        sport,
        season,
        owner_id: user.id,
        settings: {}
      })
      .select()
      .single();

    if (leagueError) {
      setLoading(false);
      setError('Error creating league: ' + leagueError.message);
      return;
    }

    if (!leagueData) {
      setLoading(false);
      setError('Error: League was not created');
      return;
    }

    const { error: settingsError } = await supabase
      .from('league_settings')
      .insert({
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
        roster_k: settings.roster_k,
        roster_dst: settings.roster_dst,
        bench: settings.bench,
        allow_trades: settings.allow_trades,
        allow_pick_trades: settings.allow_pick_trades,
      });

    setLoading(false);

    if (settingsError) {
      setError('League created but error saving settings: ' + settingsError.message);
    } else {
      navigate(`/leagues/${leagueData.id}`);
    }
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <UserMenu />
      </div>

      <h1>Create League</h1>

      <form onSubmit={handleSubmit} style={{ maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '30px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', background: '#f9fafb', borderRadius: '8px' }}>
          <h2 style={{ margin: '0', fontSize: '20px' }}>Basic Information</h2>

          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
              League Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
              Sport
            </label>
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            >
              <option value="football">Football</option>
              <option value="basketball">Basketball</option>
              <option value="baseball">Baseball</option>
              <option value="hockey">Hockey</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#6b7280' }}>
              Season
            </label>
            <div style={{ padding: '10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', color: '#374151' }}>
              {season}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', background: '#f9fafb', borderRadius: '8px' }}>
            <h2 style={{ margin: '0', fontSize: '20px' }}>Draft Settings</h2>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                Draft Format
              </label>
              <select
                value={settings.draft_format}
                onChange={(e) => setSettings({ ...settings, draft_format: e.target.value })}
                style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
              >
                <option value="snake">Snake Draft</option>
                <option value="linear">Linear Draft</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                Pick Timer
              </label>
              <select
                value={settings.pick_timer_seconds}
                onChange={(e) => setSettings({ ...settings, pick_timer_seconds: parseInt(e.target.value) })}
                style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
              >
                <option value="30">30 seconds</option>
                <option value="60">60 seconds</option>
                <option value="90">90 seconds</option>
                <option value="120">2 minutes</option>
                <option value="0">Unlimited</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.allow_pauses}
                  onChange={(e) => setSettings({ ...settings, allow_pauses: e.target.checked })}
                />
                <span>Allow draft pauses</span>
              </label>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '10px' }}>
                <input
                  type="checkbox"
                  checked={settings.drafting_hours_enabled}
                  onChange={(e) => setSettings({ ...settings, drafting_hours_enabled: e.target.checked })}
                />
                <span>Restrict drafting hours</span>
              </label>
              {settings.drafting_hours_enabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginLeft: '30px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>Start Time</label>
                    <input
                      type="time"
                      value={settings.drafting_hours_start}
                      onChange={(e) => setSettings({ ...settings, drafting_hours_start: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>End Time</label>
                    <input
                      type="time"
                      value={settings.drafting_hours_end}
                      onChange={(e) => setSettings({ ...settings, drafting_hours_end: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                    />
                  </div>
                </div>
              )}
            </div>

            <h3 style={{ margin: '10px 0 0 0', fontSize: '18px' }}>League Behavior</h3>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.allow_trades}
                  onChange={(e) => setSettings({ ...settings, allow_trades: e.target.checked })}
                />
                <span>Allow player trades</span>
              </label>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.allow_pick_trades}
                  onChange={(e) => setSettings({ ...settings, allow_pick_trades: e.target.checked })}
                />
                <span>Allow draft pick trades</span>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', background: '#f9fafb', borderRadius: '8px' }}>
            <h2 style={{ margin: '0', fontSize: '20px' }}>Roster Settings</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              {[
                { key: 'roster_qb', label: 'QB' },
                { key: 'roster_rb', label: 'RB' },
                { key: 'roster_wr', label: 'WR' },
                { key: 'roster_te', label: 'TE' },
                { key: 'roster_flex', label: 'FLEX' },
                { key: 'roster_k', label: 'K' },
                { key: 'roster_dst', label: 'DST' },
                { key: 'bench', label: 'Bench' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>
                    {label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings[key as keyof typeof settings] as number}
                    onChange={(e) => setSettings({ ...settings, [key]: parseInt(e.target.value) || 0 })}
                    style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            padding: '12px',
            background: '#fee2e2',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            color: '#dc2626'
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 24px',
            background: loading ? '#9ca3af' : '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: '500',
            fontSize: '16px'
          }}
        >
          {loading ? 'Creating League...' : 'Create League'}
        </button>
      </form>
    </div>
  );
}
