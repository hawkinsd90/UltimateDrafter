import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../types/supabase';

type League = Database['public']['Tables']['leagues']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];
type Draft = Database['public']['Tables']['drafts']['Row'];

type Tab = 'drafts' | 'members' | 'settings';

export default function LeagueDetail() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { user } = useAuth();

  const [league, setLeague] = useState<League | null>(null);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('drafts');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [formData, setFormData] = useState({
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

  useEffect(() => {
    if (leagueId) {
      loadLeagueData();
    }
  }, [leagueId]);

  useEffect(() => {
    if (leagueSettings) {
      setFormData({
        draft_format: leagueSettings.draft_format,
        pick_timer_seconds: leagueSettings.pick_timer_seconds,
        allow_pauses: leagueSettings.allow_pauses,
        drafting_hours_enabled: leagueSettings.drafting_hours_enabled,
        drafting_hours_start: leagueSettings.drafting_hours_start || '',
        drafting_hours_end: leagueSettings.drafting_hours_end || '',
        roster_qb: leagueSettings.roster_qb,
        roster_rb: leagueSettings.roster_rb,
        roster_wr: leagueSettings.roster_wr,
        roster_te: leagueSettings.roster_te,
        roster_flex: leagueSettings.roster_flex,
        roster_k: leagueSettings.roster_k,
        roster_dst: leagueSettings.roster_dst,
        bench: leagueSettings.bench,
        allow_trades: leagueSettings.allow_trades,
        allow_pick_trades: leagueSettings.allow_pick_trades,
      });
    }
  }, [leagueSettings]);

  async function loadLeagueData() {
    try {
      const [leagueResult, settingsResult, draftsResult] = await Promise.all([
        supabase.from('leagues').select('*').eq('id', leagueId).maybeSingle(),
        supabase.from('league_settings').select('*').eq('league_id', leagueId).maybeSingle(),
        supabase.from('drafts').select('*').eq('league_id', leagueId).order('created_at', { ascending: false })
      ]);

      if (leagueResult.error) {
        console.error('Error loading league:', leagueResult.error);
        setMessage('Error loading league');
      } else if (!leagueResult.data) {
        setMessage('League not found');
      } else {
        setLeague(leagueResult.data);
      }

      if (!settingsResult.error && settingsResult.data) {
        setLeagueSettings(settingsResult.data);
      }

      if (!draftsResult.error && draftsResult.data) {
        setDrafts(draftsResult.data);
      }
    } catch (error) {
      console.error('Error loading league data:', error);
      setMessage('Error loading league data');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();

    if (!user || !league || league.owner_id !== user.id) {
      setMessage('Only the league owner can update settings');
      return;
    }

    if (formData.drafting_hours_enabled && (!formData.drafting_hours_start || !formData.drafting_hours_end)) {
      setMessage('Please provide both start and end times for drafting hours');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const { error } = await supabase
        .from('league_settings')
        .update({
          draft_format: formData.draft_format,
          pick_timer_seconds: formData.pick_timer_seconds,
          allow_pauses: formData.allow_pauses,
          drafting_hours_enabled: formData.drafting_hours_enabled,
          drafting_hours_start: formData.drafting_hours_enabled ? formData.drafting_hours_start : null,
          drafting_hours_end: formData.drafting_hours_enabled ? formData.drafting_hours_end : null,
          roster_qb: formData.roster_qb,
          roster_rb: formData.roster_rb,
          roster_wr: formData.roster_wr,
          roster_te: formData.roster_te,
          roster_flex: formData.roster_flex,
          roster_k: formData.roster_k,
          roster_dst: formData.roster_dst,
          bench: formData.bench,
          allow_trades: formData.allow_trades,
          allow_pick_trades: formData.allow_pick_trades,
        })
        .eq('league_id', leagueId);

      if (error) {
        console.error('Error updating settings:', error);
        setMessage('Error updating settings: ' + error.message);
      } else {
        setMessage('Settings updated successfully');
        await loadLeagueData();
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  }

  const isOwner = user && league && league.owner_id === user.id;

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  if (!league) {
    return (
      <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <p style={{ marginTop: '20px', color: '#ef4444' }}>{message || 'League not found'}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <UserMenu />
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 10px 0' }}>{league.name}</h1>
        <p style={{ margin: '0', color: '#6b7280', fontSize: '16px' }}>
          {league.sport} - {league.season}
        </p>
        <p style={{ margin: '5px 0 0 0', color: '#9ca3af', fontSize: '14px' }}>
          Created {new Date(league.created_at).toLocaleDateString()}
        </p>
      </div>

      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '30px' }}>
        <div style={{ display: 'flex', gap: '30px' }}>
          <button
            onClick={() => setActiveTab('drafts')}
            style={{
              background: 'none',
              border: 'none',
              padding: '10px 0',
              fontSize: '16px',
              fontWeight: activeTab === 'drafts' ? '600' : '400',
              color: activeTab === 'drafts' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'drafts' ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Drafts
          </button>
          <button
            onClick={() => setActiveTab('members')}
            style={{
              background: 'none',
              border: 'none',
              padding: '10px 0',
              fontSize: '16px',
              fontWeight: activeTab === 'members' ? '600' : '400',
              color: activeTab === 'members' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'members' ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Members
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              background: 'none',
              border: 'none',
              padding: '10px 0',
              fontSize: '16px',
              fontWeight: activeTab === 'settings' ? '600' : '400',
              color: activeTab === 'settings' ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === 'settings' ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Settings
          </button>
        </div>
      </div>

      {activeTab === 'drafts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: '0' }}>Drafts</h2>
            {isOwner && (
              <Link
                to={`/leagues/${league.id}/drafts/create`}
                style={{
                  display: 'inline-block',
                  padding: '10px 20px',
                  background: '#059669',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Create New Draft
              </Link>
            )}
          </div>

          {drafts.length === 0 ? (
            <div style={{
              padding: '40px',
              background: '#f9fafb',
              border: '2px dashed #d1d5db',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#374151' }}>No Drafts Yet</h3>
              <p style={{ margin: '0 0 20px 0', color: '#6b7280' }}>
                Create your first draft to start selecting players for your fantasy team.
              </p>
              {isOwner && (
                <Link
                  to={`/leagues/${league.id}/drafts/create`}
                  style={{
                    display: 'inline-block',
                    padding: '12px 24px',
                    background: '#059669',
                    color: 'white',
                    textDecoration: 'none',
                    borderRadius: '6px',
                    fontWeight: '500'
                  }}
                >
                  Create Your First Draft
                </Link>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {drafts.map(draft => (
                <div key={draft.id} style={{
                  padding: '20px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <h3 style={{ margin: '0 0 5px 0' }}>{draft.name}</h3>
                    <p style={{ margin: '0', color: '#6b7280', fontSize: '14px' }}>
                      Status: {draft.status} • Type: {draft.draft_type}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <Link
                      to={`/drafts/${draft.id}/participants`}
                      style={{
                        padding: '8px 16px',
                        background: '#f3f4f6',
                        color: '#374151',
                        textDecoration: 'none',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    >
                      Manage Participants
                    </Link>
                    <Link
                      to={`/drafts/${draft.id}`}
                      style={{
                        padding: '8px 16px',
                        background: '#2563eb',
                        color: 'white',
                        textDecoration: 'none',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    >
                      View Draft
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div>
          <h2 style={{ margin: '0 0 20px 0' }}>Members</h2>
          <div style={{
            padding: '40px',
            background: '#f9fafb',
            border: '2px dashed #d1d5db',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <p style={{ margin: '0', color: '#6b7280' }}>
              Member management will be available in a future update. For now, members are managed at the draft level.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div>
          <h2 style={{ margin: '0 0 20px 0' }}>League Settings</h2>

          {!leagueSettings ? (
            <div style={{
              padding: '40px',
              background: '#fef3c7',
              border: '1px solid #fbbf24',
              borderRadius: '8px'
            }}>
              <p style={{ margin: '0', color: '#92400e' }}>
                No settings configured for this league. Settings are created when the league is created.
              </p>
            </div>
          ) : !isOwner ? (
            <div>
              <div style={{
                padding: '20px',
                background: '#f3f4f6',
                borderRadius: '8px',
                marginBottom: '20px'
              }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#6b7280' }}>
                  You are viewing settings in read-only mode. Only the league owner can edit settings.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                <div>
                  <h3 style={{ marginTop: '0' }}>Draft Settings</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div>
                      <strong>Draft Format:</strong> {leagueSettings.draft_format}
                    </div>
                    <div>
                      <strong>Pick Timer:</strong> {leagueSettings.pick_timer_seconds === 0 ? 'Unlimited' : `${leagueSettings.pick_timer_seconds} seconds`}
                    </div>
                    <div>
                      <strong>Allow Pauses:</strong> {leagueSettings.allow_pauses ? 'Yes' : 'No'}
                    </div>
                    <div>
                      <strong>Drafting Hours:</strong> {leagueSettings.drafting_hours_enabled ? `${leagueSettings.drafting_hours_start} - ${leagueSettings.drafting_hours_end}` : 'Not restricted'}
                    </div>
                  </div>

                  <h3>Roster Settings</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div><strong>QB:</strong> {leagueSettings.roster_qb}</div>
                    <div><strong>RB:</strong> {leagueSettings.roster_rb}</div>
                    <div><strong>WR:</strong> {leagueSettings.roster_wr}</div>
                    <div><strong>TE:</strong> {leagueSettings.roster_te}</div>
                    <div><strong>FLEX:</strong> {leagueSettings.roster_flex}</div>
                    <div><strong>K:</strong> {leagueSettings.roster_k}</div>
                    <div><strong>DST:</strong> {leagueSettings.roster_dst}</div>
                    <div><strong>Bench:</strong> {leagueSettings.bench}</div>
                  </div>
                </div>

                <div>
                  <h3 style={{ marginTop: '0' }}>League Behavior</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div>
                      <strong>Allow Trades:</strong> {leagueSettings.allow_trades ? 'Yes' : 'No'}
                    </div>
                    <div>
                      <strong>Allow Pick Trades:</strong> {leagueSettings.allow_pick_trades ? 'Yes' : 'No'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveSettings}>
              {message && (
                <div style={{
                  padding: '12px 20px',
                  background: message.includes('Error') ? '#fef2f2' : '#f0fdf4',
                  color: message.includes('Error') ? '#991b1b' : '#166534',
                  borderRadius: '6px',
                  marginBottom: '20px'
                }}>
                  {message}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                <div>
                  <h3 style={{ marginTop: '0' }}>Draft Settings</h3>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                      Draft Format
                    </label>
                    <select
                      value={formData.draft_format}
                      onChange={(e) => setFormData({ ...formData, draft_format: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    >
                      <option value="snake">Snake</option>
                      <option value="linear">Linear</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
                      Pick Timer (seconds, 0 = unlimited)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.pick_timer_seconds}
                      onChange={(e) => setFormData({ ...formData, pick_timer_seconds: parseInt(e.target.value) || 0 })}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData.allow_pauses}
                        onChange={(e) => setFormData({ ...formData, allow_pauses: e.target.checked })}
                      />
                      <span>Allow draft pauses</span>
                    </label>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '10px' }}>
                      <input
                        type="checkbox"
                        checked={formData.drafting_hours_enabled}
                        onChange={(e) => setFormData({ ...formData, drafting_hours_enabled: e.target.checked })}
                      />
                      <span>Restrict drafting hours</span>
                    </label>
                    {formData.drafting_hours_enabled && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginLeft: '30px' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>Start Time</label>
                          <input
                            type="time"
                            value={formData.drafting_hours_start}
                            onChange={(e) => setFormData({ ...formData, drafting_hours_start: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '14px'
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>End Time</label>
                          <input
                            type="time"
                            value={formData.drafting_hours_end}
                            onChange={(e) => setFormData({ ...formData, drafting_hours_end: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '14px'
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <h3>Roster Settings</h3>
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
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: '500' }}>
                          {label}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={formData[key as keyof typeof formData] as number}
                          onChange={(e) => setFormData({ ...formData, [key]: parseInt(e.target.value) || 0 })}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '14px'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 style={{ marginTop: '0' }}>League Behavior</h3>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData.allow_trades}
                        onChange={(e) => setFormData({ ...formData, allow_trades: e.target.checked })}
                      />
                      <span>Allow player trades</span>
                    </label>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData.allow_pick_trades}
                        onChange={(e) => setFormData({ ...formData, allow_pick_trades: e.target.checked })}
                      />
                      <span>Allow draft pick trades</span>
                    </label>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '12px 24px',
                    background: saving ? '#9ca3af' : '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '16px',
                    fontWeight: '500',
                    cursor: saving ? 'not-allowed' : 'pointer'
                  }}
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
