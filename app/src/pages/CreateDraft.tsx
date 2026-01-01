import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../types/supabase';
import UserMenu from '../components/UserMenu';

type League = Database['public']['Tables']['leagues']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

export default function CreateDraft() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [league, setLeague] = useState<League | null>(null);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (leagueId) {
      loadLeagueData();
    }
  }, [leagueId]);

  async function loadLeagueData() {
    const [leagueRes, settingsRes] = await Promise.all([
      supabase.from('leagues').select('*').eq('id', leagueId!).single(),
      supabase.from('league_settings').select('*').eq('league_id', leagueId!).maybeSingle()
    ]);

    if (leagueRes.data) setLeague(leagueRes.data);
    if (settingsRes.data) setLeagueSettings(settingsRes.data);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!user?.id) {
      setError('You must be signed in to create a draft');
      setLoading(false);
      return;
    }

    if (!leagueSettings) {
      setError('League settings not found. Please configure league settings first.');
      setLoading(false);
      return;
    }

    const { data: draftData, error: draftError } = await supabase
      .from('drafts')
      .insert({
        league_id: leagueId!,
        name,
        draft_type: leagueSettings.draft_format,
        status: 'setup',
        current_pick_number: 1,
        pick_time_seconds: leagueSettings.pick_timer_seconds,
        settings: {}
      })
      .select()
      .single();

    if (draftError) {
      setLoading(false);
      setError('Error creating draft: ' + draftError.message);
      return;
    }

    if (!draftData) {
      setLoading(false);
      setError('Error: Draft was not created');
      return;
    }

    const { error: settingsError } = await supabase
      .from('draft_settings')
      .insert({
        draft_id: draftData.id,
        created_by: user.id,
        draft_format: leagueSettings.draft_format,
        pick_timer_seconds: leagueSettings.pick_timer_seconds,
        allow_pauses: leagueSettings.allow_pauses,
        drafting_hours_enabled: leagueSettings.drafting_hours_enabled,
        drafting_hours_start: leagueSettings.drafting_hours_start,
        drafting_hours_end: leagueSettings.drafting_hours_end,
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

    setLoading(false);

    if (settingsError) {
      setError('Draft created but error saving settings: ' + settingsError.message);
    } else {
      navigate(`/drafts/${draftData.id}/participants`);
    }
  }

  if (!league) return <div style={{ padding: '40px' }}>Loading...</div>;

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to={`/leagues/${leagueId}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Back to {league.name}
        </Link>
        <UserMenu />
      </div>

      <h1>Create Draft</h1>

      {!leagueSettings && (
        <div style={{
          padding: '15px',
          background: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: '6px',
          marginBottom: '20px'
        }}>
          <p style={{ margin: '0', color: '#92400e' }}>
            League settings not found. The draft will use default settings.
          </p>
        </div>
      )}

      {leagueSettings && (
        <div style={{
          padding: '15px',
          background: '#f0fdf4',
          border: '1px solid #86efac',
          borderRadius: '6px',
          marginBottom: '20px'
        }}>
          <p style={{ margin: '0 0 10px 0', fontWeight: '500', color: '#166534' }}>
            Draft will inherit current league settings:
          </p>
          <ul style={{ margin: '0', paddingLeft: '20px', color: '#166534' }}>
            <li>Draft Format: {leagueSettings.draft_format === 'snake' ? 'Snake' : 'Linear'}</li>
            <li>Pick Timer: {leagueSettings.pick_timer_seconds === 0 ? 'Unlimited' : `${leagueSettings.pick_timer_seconds} seconds`}</li>
            <li>Roster: {leagueSettings.roster_qb}QB, {leagueSettings.roster_rb}RB, {leagueSettings.roster_wr}WR, {leagueSettings.roster_te}TE, {leagueSettings.roster_flex}FLEX, {leagueSettings.roster_k}K, {leagueSettings.roster_dst}DST, {leagueSettings.bench} Bench</li>
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Draft Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g., 2026 Season Draft"
            style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
          />
          <p style={{ margin: '5px 0 0 0', fontSize: '14px', color: '#6b7280' }}>
            Choose a descriptive name for this draft
          </p>
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
          disabled={loading || !leagueSettings}
          style={{
            padding: '12px 24px',
            background: (loading || !leagueSettings) ? '#9ca3af' : '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: (loading || !leagueSettings) ? 'not-allowed' : 'pointer',
            fontWeight: '500',
            fontSize: '16px'
          }}
        >
          {loading ? 'Creating Draft...' : 'Create Draft'}
        </button>
      </form>
    </div>
  );
}
