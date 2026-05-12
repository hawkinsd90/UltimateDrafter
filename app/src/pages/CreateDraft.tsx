import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../types/supabase';
import UserMenu from '../components/UserMenu';

type League = Database['public']['Tables']['leagues']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

type DraftType = 'snake' | 'linear' | 'rookie';

export default function CreateDraft() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [league, setLeague] = useState<League | null>(null);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings | null>(null);
  const [name, setName] = useState('');
  const [draftType, setDraftType] = useState<DraftType>('snake');
  const [numRounds, setNumRounds] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (leagueId) loadLeagueData();
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
        draft_type: draftType,
        status: 'pending',
        current_pick_number: 1,
        pick_time_seconds: leagueSettings.pick_timer_seconds,
        settings: {}
      })
      .select()
      .single();

    if (draftError || !draftData) {
      setLoading(false);
      setError('Error creating draft: ' + (draftError?.message ?? 'Unknown error'));
      return;
    }

    const { error: settingsError } = await supabase
      .from('draft_settings')
      .insert({
        draft_id: draftData.id,
        created_by: user.id,
        draft_format: leagueSettings.draft_format,
        draft_type: draftType,
        num_rounds: draftType === 'rookie' ? numRounds : null,
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
        roster_op: (leagueSettings as Record<string, unknown>).roster_op as number ?? 0,
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

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px', border: '1px solid #d1d5db',
    borderRadius: '6px', color: '#111827', background: 'white', boxSizing: 'border-box',
  };

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '12px', flexWrap: 'nowrap', minWidth: 0 }}>
        <Link to={`/leagues/${leagueId}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Back to {league.name}
        </Link>
        <UserMenu />
      </div>

      <h1 style={{ color: '#f9fafb' }}>Create Draft</h1>

      {!leagueSettings && (
        <div style={{ padding: '15px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: '6px', marginBottom: '20px' }}>
          <p style={{ margin: '0', color: '#92400e' }}>
            League settings not found. Please configure league settings first.
          </p>
        </div>
      )}

      {leagueSettings && (
        <div style={{ padding: '15px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 10px 0', fontWeight: '500', color: '#166534' }}>League settings:</p>
          <ul style={{ margin: '0', paddingLeft: '20px', color: '#166534' }}>
            <li>Pick Timer: {leagueSettings.pick_timer_seconds === 0 ? 'Unlimited' : `${leagueSettings.pick_timer_seconds} seconds`}</li>
            <li>Roster: {leagueSettings.roster_qb}QB, {leagueSettings.roster_rb}RB, {leagueSettings.roster_wr}WR, {leagueSettings.roster_te}TE, {leagueSettings.roster_flex}FLEX{((leagueSettings as Record<string, unknown>).roster_op as number) > 0 ? `, ${(leagueSettings as Record<string, unknown>).roster_op as number}OP/SF` : ''}, {leagueSettings.roster_k}K, {leagueSettings.roster_dst}DST, {leagueSettings.bench} Bench</li>
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Draft name */}
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#f9fafb' }}>
            Draft Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g., 2026 Rookie Draft"
            style={inputStyle}
          />
        </div>

        {/* Draft type */}
        <div>
          <label style={{ display: 'block', marginBottom: '10px', fontWeight: '500', color: '#f9fafb' }}>
            Draft Type
          </label>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {([
              { value: 'snake' as DraftType, label: 'Snake', desc: 'Order reverses each round' },
              { value: 'linear' as DraftType, label: 'Linear', desc: 'Same order every round' },
              { value: 'rookie' as DraftType, label: 'Rookie', desc: 'Rookies only, 1–4 rounds' },
            ]).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDraftType(opt.value)}
                style={{
                  flex: 1, minWidth: '120px', padding: '12px 14px',
                  borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                  background: draftType === opt.value ? '#1d4ed8' : 'white',
                  color: draftType === opt.value ? '#fff' : '#111827',
                  border: `2px solid ${draftType === opt.value ? '#1d4ed8' : '#d1d5db'}`,
                  transition: 'all 0.12s',
                }}
              >
                <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '2px' }}>{opt.label}</div>
                <div style={{ fontSize: '12px', opacity: draftType === opt.value ? 0.85 : 0.55 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Rookie rounds selector */}
        {draftType === 'rookie' && (
          <div style={{ padding: '16px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: '#e2e8f0' }}>
              Number of Rounds (max 4)
            </label>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#64748b' }}>
              Rookie drafts use a separate pool of first-year players only. Each team picks once per round.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[1, 2, 3, 4].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNumRounds(n)}
                  style={{
                    width: '48px', height: '48px', borderRadius: '8px',
                    fontWeight: '700', fontSize: '18px', cursor: 'pointer',
                    background: numRounds === n ? '#2563eb' : 'transparent',
                    color: numRounds === n ? '#fff' : '#94a3b8',
                    border: `2px solid ${numRounds === n ? '#2563eb' : '#334155'}`,
                    transition: 'all 0.12s',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#475569' }}>
              {numRounds} round{numRounds !== 1 ? 's' : ''} — player pool filtered to rookies (0 years experience).
            </p>
          </div>
        )}

        {error && (
          <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !leagueSettings}
          style={{
            padding: '12px 24px',
            background: (loading || !leagueSettings) ? '#9ca3af' : '#059669',
            color: 'white', border: 'none', borderRadius: '6px',
            cursor: (loading || !leagueSettings) ? 'not-allowed' : 'pointer',
            fontWeight: '500', fontSize: '16px',
          }}
        >
          {loading ? 'Creating Draft...' : 'Create Draft'}
        </button>
      </form>
    </div>
  );
}
