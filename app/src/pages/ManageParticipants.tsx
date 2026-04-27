import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

type Draft = {
  id: string;
  league_id: string;
  league_owner_id: string;
  name: string;
  status: string;
};

type LeagueMember = {
  id: string;
  user_id: string | null;
  display_name: string | null;
  phone_e164: string | null;
  role: string;
};

type Participant = {
  memberId: string;
  displayName: string;
  draftPosition: number;
};

export default function ManageParticipants() {
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [leagueMembers, setLeagueMembers] = useState<LeagueMember[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    if (draftId) loadData();
  }, [draftId]);

  async function loadData() {
    setLoading(true);
    const { data: draftData } = await supabase
      .from('drafts')
      .select('id, league_id, name, status')
      .eq('id', draftId!)
      .maybeSingle();

    if (!draftData) {
      setError('Draft not found.');
      setLoading(false);
      return;
    }

    setDraft({ ...draftData, league_owner_id: '' }); // filled after members load

    const [membersRes, existingRes] = await Promise.all([
      supabase
        .from('league_members')
        .select('id, user_id, display_name, phone_e164, role')
        .eq('league_id', draftData.league_id)
        .order('joined_at', { ascending: true }),
      supabase
        .from('draft_participants')
        .select('*')
        .eq('draft_id', draftId!)
        .order('draft_position', { ascending: true }),
    ]);

    const members: LeagueMember[] = membersRes.data ?? [];
    setLeagueMembers(members);

    // Derive owner from league_members — avoids a separate leagues query
    // and works regardless of leagues RLS policy variations.
    const ownerMember = members.find(m => m.role === 'owner');
    if (ownerMember?.user_id) {
      setDraft(prev => prev ? { ...prev, league_owner_id: ownerMember.user_id! } : prev);
    }

    if (existingRes.data && existingRes.data.length > 0) {
      const saved: Participant[] = existingRes.data.map((p: any) => {
        const match = members.find(m => m.user_id === p.user_id);
        return {
          memberId: match?.id ?? '',
          displayName: p.team_name,
          draftPosition: p.draft_position,
        };
      });
      setParticipants(saved);
    } else {
      setParticipants(
        members.map((m, i) => ({
          memberId: m.id,
          displayName: m.display_name ?? m.phone_e164 ?? 'Member',
          draftPosition: i + 1,
        }))
      );
    }

    setLoading(false);
  }

  function toggleMember(member: LeagueMember) {
    const already = participants.find(p => p.memberId === member.id);
    if (already) {
      const updated = participants
        .filter(p => p.memberId !== member.id)
        .map((p, i) => ({ ...p, draftPosition: i + 1 }));
      setParticipants(updated);
    } else {
      setParticipants([
        ...participants,
        {
          memberId: member.id,
          displayName: member.display_name ?? member.phone_e164 ?? 'Member',
          draftPosition: participants.length + 1,
        },
      ]);
    }
  }

  function updateName(memberId: string, name: string) {
    setParticipants(participants.map(p => p.memberId === memberId ? { ...p, displayName: name } : p));
  }

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...participants];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setParticipants(reordered.map((p, i) => ({ ...p, draftPosition: i + 1 })));
    setDragIdx(idx);
  }

  function handleDragEnd() {
    setDragIdx(null);
  }

  async function handleSaveAndStart() {
    if (!draft) return;
    if (participants.length < 2) {
      setError('Need at least 2 participants to start the draft.');
      return;
    }
    setSaving(true);
    setError('');

    await supabase.from('draft_participants').delete().eq('draft_id', draft.id);

    const memberMap = Object.fromEntries(leagueMembers.map(m => [m.id, m]));

    const rows = participants.map(p => {
      const member = memberMap[p.memberId];
      return {
        draft_id: draft.id,
        user_id: member?.user_id ?? null,
        team_name: p.displayName,
        draft_position: p.draftPosition,
        notification_preferences: {},
      };
    });

    const { error: insertErr } = await supabase.from('draft_participants').insert(rows);
    if (insertErr) {
      setError('Error saving participants: ' + insertErr.message);
      setSaving(false);
      return;
    }

    const { error: startErr } = await supabase
      .from('drafts')
      .update({ status: 'in_progress', start_time: new Date().toISOString() })
      .eq('id', draft.id);

    if (startErr) {
      setError('Participants saved but could not start draft: ' + startErr.message);
      setSaving(false);
      return;
    }

    navigate(`/drafts/${draft.id}`);
  }

  if (loading) return <div style={{ padding: '40px', color: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>Loading...</div>;
  if (!draft) return <div style={{ padding: '40px', color: '#ef4444', fontFamily: 'system-ui, sans-serif' }}>{error || 'Draft not found.'}</div>;

  const selectedIds = new Set(participants.map(p => p.memberId));

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '700px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to={`/leagues/${draft.league_id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Back to League
        </Link>
        <UserMenu />
      </div>

      <h1 style={{ margin: '0 0 4px 0', color: '#f9fafb' }}>Setup Participants</h1>
      <p style={{ margin: '0 0 30px 0', color: '#9ca3af', fontSize: '16px' }}>{draft.name}</p>

      {error && (
        <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', color: '#dc2626', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      <div style={{ background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', marginBottom: '24px', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#374151' }}>League Members</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>Check who is participating in this draft.</p>
        </div>
        {leagueMembers.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
            No members in this league yet. <Link to={`/leagues/${draft.league_id}`} style={{ color: '#2563eb' }}>Add members</Link> first.
          </div>
        ) : (
          <div>
            {leagueMembers.map(m => {
              const selected = selectedIds.has(m.id);
              return (
                <label
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 20px',
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    background: selected ? '#f0fdf4' : 'white',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleMember(m)}
                    style={{ width: '16px', height: '16px', accentColor: '#059669' }}
                  />
                  <span style={{ fontWeight: '500', color: '#111827' }}>{m.display_name ?? m.phone_e164 ?? 'Unknown'}</span>
                  <span style={{
                    fontSize: '12px',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    background: m.role === 'owner' ? '#dbeafe' : '#f3f4f6',
                    color: m.role === 'owner' ? '#1d4ed8' : '#6b7280',
                  }}>
                    {m.role}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {participants.length > 0 && (
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', marginBottom: '24px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
            <h2 style={{ margin: 0, fontSize: '16px', color: '#374151' }}>Draft Order</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>Drag rows to reorder. Edit team names if needed.</p>
          </div>
          <div>
            {participants.map((p, idx) => (
              <div
                key={p.memberId}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 20px',
                  borderBottom: '1px solid #f3f4f6',
                  background: dragIdx === idx ? '#eff6ff' : 'white',
                  cursor: 'grab',
                  userSelect: 'none',
                }}
              >
                <span style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: '#2563eb', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: '700', fontSize: '13px', flexShrink: 0,
                }}>
                  {p.draftPosition}
                </span>
                <span style={{ color: '#9ca3af', fontSize: '20px', flexShrink: 0, lineHeight: 1 }}>⠿</span>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={p.displayName}
                    onChange={(e) => updateName(p.memberId, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box' }}
                  />
                  {(() => {
                    const member = leagueMembers.find(m => m.id === p.memberId);
                    const label = member?.display_name ?? member?.phone_e164 ?? null;
                    return label ? (
                      <div style={{ marginTop: '3px', fontSize: '12px', color: '#6b7280', paddingLeft: '2px' }}>
                        {label}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {draft.status === 'pending' && user?.id === draft.league_owner_id && (
        <Link
          to={`/drafts/${draft.id}/import`}
          style={{
            display: 'block',
            width: '100%',
            padding: '14px',
            marginBottom: '12px',
            background: 'white',
            color: '#1d4ed8',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            fontWeight: '600',
            fontSize: '16px',
            textAlign: 'center',
            textDecoration: 'none',
            boxSizing: 'border-box',
          }}
        >
          Import ESPN / Sleeper League
        </Link>
      )}

      <button
        onClick={handleSaveAndStart}
        disabled={saving || participants.length < 2}
        title={participants.length < 2 ? 'Select at least 2 participants' : undefined}
        style={{
          width: '100%',
          padding: '14px',
          background: saving || participants.length < 2 ? '#9ca3af' : '#059669',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontWeight: '600',
          fontSize: '16px',
          cursor: saving || participants.length < 2 ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? 'Starting Draft...' : `Start Draft with ${participants.length} Participant${participants.length !== 1 ? 's' : ''}`}
      </button>
      {participants.length < 2 && (
        <p style={{ textAlign: 'center', marginTop: '10px', color: '#9ca3af', fontSize: '14px' }}>
          Select at least 2 participants to start.
        </p>
      )}
    </div>
  );
}
