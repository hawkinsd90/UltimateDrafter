import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../types/supabase';
import UserMenu from '../components/UserMenu';

type League = Database['public']['Tables']['leagues']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

type DraftType = 'snake' | 'linear';
type PlayerPool = 'all' | 'rookies_only';

type ExtLeagueSettings = LeagueSettings & {
  roster_op?: number;
  roster_limits_enabled?: boolean;
  max_qb?: number | null;
  max_rb?: number | null;
  max_wr?: number | null;
  max_te?: number | null;
  max_k?: number | null;
  max_dst?: number | null;
};

type LeagueMemberRow = {
  id: string;
  user_id: string | null;
  display_name: string | null;
  phone_e164: string | null;
  role: string;
  draft_order: number | null;
};

export default function CreateDraft() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [league, setLeague] = useState<League | null>(null);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings | null>(null);
  const [leagueMembers, setLeagueMembers] = useState<LeagueMemberRow[]>([]);
  const [draftOrderIds, setDraftOrderIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [draftType, setDraftType] = useState<DraftType>('snake');
  const [playerPool, setPlayerPool] = useState<PlayerPool>('all');
  const [numRounds, setNumRounds] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (leagueId) loadLeagueData();
  }, [leagueId]);

  async function loadLeagueData() {
    const [leagueRes, settingsRes, membersRes, importedRes] = await Promise.all([
      supabase.from('leagues').select('*').eq('id', leagueId!).single(),
      supabase.from('league_settings').select('*').eq('league_id', leagueId!).maybeSingle(),
      supabase.from('league_members').select('id, user_id, display_name, phone_e164, role, draft_order').eq('league_id', leagueId!).order('joined_at', { ascending: true }),
      supabase.from('league_imported_members').select('id').eq('league_id', leagueId!).limit(1),
    ]);

    if (leagueRes.data) setLeague(leagueRes.data);
    if (settingsRes.data) setLeagueSettings(settingsRes.data);

    if (membersRes.data) {
      const members = membersRes.data as LeagueMemberRow[];
      setLeagueMembers(members);
      const sorted = [...members].sort((a, b) => {
        if (a.draft_order != null && b.draft_order != null) return a.draft_order - b.draft_order;
        if (a.draft_order != null) return -1;
        if (b.draft_order != null) return 1;
        return 0;
      });
      setDraftOrderIds(sorted.map(m => m.id));
    }

    if (importedRes.data && importedRes.data.length > 0) {
      setNumRounds(null);
    }
  }

  const suggestedRounds = leagueSettings
    ? (leagueSettings.roster_qb ?? 1) + (leagueSettings.roster_rb ?? 2) +
      (leagueSettings.roster_wr ?? 2) + (leagueSettings.roster_te ?? 1) +
      (leagueSettings.roster_flex ?? 1) + ((leagueSettings as Record<string, unknown>).roster_op as number ?? 0) +
      (leagueSettings.roster_k ?? 1) + (leagueSettings.roster_dst ?? 1) +
      (leagueSettings.bench ?? 6)
    : null;

  function moveDraftOrder(id: string, dir: -1 | 1) {
    setDraftOrderIds(prev => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  function memberName(m: LeagueMemberRow | undefined): string {
    if (!m) return 'Member';
    return m.display_name ?? m.phone_e164 ?? 'Member';
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
        player_pool: playerPool,
        num_rounds: numRounds,
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
        ...(() => {
          const ext = leagueSettings as ExtLeagueSettings;
          if (!ext.roster_limits_enabled) return {};
          return {
            max_qb:  ext.max_qb  ?? undefined,
            max_rb:  ext.max_rb  ?? undefined,
            max_wr:  ext.max_wr  ?? undefined,
            max_te:  ext.max_te  ?? undefined,
            max_k:   ext.max_k   ?? undefined,
            max_dst: ext.max_dst ?? undefined,
          };
        })(),
      });

    if (settingsError) {
      setLoading(false);
      setError('Draft created but error saving settings: ' + settingsError.message);
      return;
    }

    // Pre-populate draft participants from draft order
    if (draftOrderIds.length > 0) {
      const memberMap = Object.fromEntries(leagueMembers.map(m => [m.id, m]));
      const rows = draftOrderIds.map((memberId, i) => {
        const m = memberMap[memberId];
        return {
          draft_id: draftData.id,
          user_id: m?.user_id ?? null,
          team_name: memberName(m),
          draft_position: i + 1,
          notification_preferences: {},
        };
      });
      await supabase.from('draft_participants').insert(rows);
    }

    setLoading(false);
    navigate(`/drafts/${draftData.id}/participants`);
  }

  if (!league) return <div style={{ padding: '40px', color: '#f9fafb' }}>Loading...</div>;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px', border: '1px solid #d1d5db',
    borderRadius: '6px', color: '#111827', background: 'white', boxSizing: 'border-box',
  };
  const darkInputStyle: React.CSSProperties = {
    ...inputStyle, background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155',
  };
  const sectionStyle: React.CSSProperties = {
    padding: '20px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: '#e2e8f0',
  };

  const memberMap = Object.fromEntries(leagueMembers.map(m => [m.id, m]));

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
          <p style={{ margin: '0', color: '#92400e' }}>League settings not found. Please configure league settings first.</p>
        </div>
      )}

      {leagueSettings && (
        <div style={{ padding: '15px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 6px 0', fontWeight: '600', color: '#166534' }}>League settings:</p>
          <ul style={{ margin: '0', paddingLeft: '20px', color: '#166534', fontSize: '14px', lineHeight: '1.6' }}>
            <li>Pick Timer: {leagueSettings.pick_timer_seconds === 0 ? 'Unlimited' : `${leagueSettings.pick_timer_seconds}s`}</li>
            <li>
              Roster: {leagueSettings.roster_qb}QB, {leagueSettings.roster_rb}RB, {leagueSettings.roster_wr}WR,{' '}
              {leagueSettings.roster_te}TE, {leagueSettings.roster_flex}FLEX
              {((leagueSettings as Record<string, unknown>).roster_op as number) > 0
                ? `, ${(leagueSettings as Record<string, unknown>).roster_op as number}OP/SF` : ''},
              {' '}{leagueSettings.roster_k}K, {leagueSettings.roster_dst}DST, {leagueSettings.bench} Bench
            </li>
            {suggestedRounds !== null && (
              <li>Suggested rounds: <strong>{suggestedRounds}</strong> (full roster fill)</li>
            )}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '22px' }}>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#f9fafb' }}>Draft Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g., 2026 Fantasy Draft" style={inputStyle} />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '10px', fontWeight: '500', color: '#f9fafb' }}>Draft Type</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            {([
              { value: 'snake' as DraftType, label: 'Snake', desc: 'Order reverses each round' },
              { value: 'linear' as DraftType, label: 'Linear', desc: 'Same order every round' },
            ] as { value: DraftType; label: string; desc: string }[]).map(opt => (
              <button key={opt.value} type="button" onClick={() => setDraftType(opt.value)} style={{ flex: 1, padding: '12px 14px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', background: draftType === opt.value ? '#1d4ed8' : 'white', color: draftType === opt.value ? '#fff' : '#111827', border: `2px solid ${draftType === opt.value ? '#1d4ed8' : '#d1d5db'}`, transition: 'all 0.12s' }}>
                <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '2px' }}>{opt.label}</div>
                <div style={{ fontSize: '12px', opacity: draftType === opt.value ? 0.85 : 0.55 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <label style={labelStyle}>Number of Rounds</label>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
            {suggestedRounds !== null ? `Suggested: ${suggestedRounds} rounds to fill all roster spots. Adjust as needed.` : 'Set how many rounds this draft will run.'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input type="number" min={1} max={30} value={numRounds ?? suggestedRounds ?? ''} onChange={e => setNumRounds(parseInt(e.target.value, 10) || null)} placeholder={suggestedRounds ? String(suggestedRounds) : 'e.g. 15'} style={{ ...darkInputStyle, maxWidth: '100px' }} />
            {suggestedRounds && numRounds !== suggestedRounds && (
              <button type="button" onClick={() => setNumRounds(suggestedRounds)} style={{ fontSize: '12px', color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                Use suggested ({suggestedRounds})
              </button>
            )}
          </div>
        </div>

        <div style={sectionStyle}>
          <label style={labelStyle}>Player Pool</label>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>Choose which players are available to draft.</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            {([
              { value: 'all' as PlayerPool, label: 'All Players', desc: 'Standard draft — all eligible players' },
              { value: 'rookies_only' as PlayerPool, label: 'Rookie Draft', desc: 'First-year players only' },
            ] as { value: PlayerPool; label: string; desc: string }[]).map(opt => (
              <button key={opt.value} type="button" onClick={() => setPlayerPool(opt.value)} style={{ flex: 1, padding: '12px 14px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', background: playerPool === opt.value ? '#1e3a5f' : 'transparent', color: playerPool === opt.value ? '#e2e8f0' : '#94a3b8', border: `2px solid ${playerPool === opt.value ? '#3b82f6' : '#334155'}`, transition: 'all 0.12s' }}>
                <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '2px' }}>{opt.label}</div>
                <div style={{ fontSize: '12px', opacity: 0.75 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {draftOrderIds.length > 1 && (
          <div style={sectionStyle}>
            <label style={labelStyle}>Draft Order</label>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
              Pre-filled from your league's draft order. Adjust for this draft if needed.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {draftOrderIds.map((memberId, idx) => {
                const m = memberMap[memberId];
                if (!m) return null;
                return (
                  <div key={memberId} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid #334155' }}>
                    <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#1d4ed8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '12px', flexShrink: 0 }}>
                      {idx + 1}
                    </span>
                    <span style={{ flex: 1, fontSize: '14px', color: '#e2e8f0', fontWeight: '500' }}>{memberName(m)}</span>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <button type="button" onClick={() => moveDraftOrder(memberId, -1)} disabled={idx === 0} style={{ width: '24px', height: '24px', padding: 0, background: idx === 0 ? 'transparent' : 'rgba(59,130,246,0.15)', border: `1px solid ${idx === 0 ? '#334155' : '#3b82f6'}`, borderRadius: '4px', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#475569' : '#60a5fa', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▲</button>
                      <button type="button" onClick={() => moveDraftOrder(memberId, 1)} disabled={idx === draftOrderIds.length - 1} style={{ width: '24px', height: '24px', padding: 0, background: idx === draftOrderIds.length - 1 ? 'transparent' : 'rgba(59,130,246,0.15)', border: `1px solid ${idx === draftOrderIds.length - 1 ? '#334155' : '#3b82f6'}`, borderRadius: '4px', cursor: idx === draftOrderIds.length - 1 ? 'default' : 'pointer', color: idx === draftOrderIds.length - 1 ? '#475569' : '#60a5fa', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▼</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#475569', lineHeight: '1.4' }}>
              This order pre-populates the participant list. You can still adjust it on the next screen.
            </p>
          </div>
        )}

        {error && (
          <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626' }}>{error}</div>
        )}

        <button type="submit" disabled={loading || !leagueSettings} style={{ padding: '12px 24px', background: (loading || !leagueSettings) ? '#9ca3af' : '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: (loading || !leagueSettings) ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '16px' }}>
          {loading ? 'Creating Draft...' : 'Create Draft'}
        </button>
      </form>
    </div>
  );
}
