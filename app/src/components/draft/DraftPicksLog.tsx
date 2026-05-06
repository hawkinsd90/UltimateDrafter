import { useState } from 'react';
import type { Pick, Participant } from '../../hooks/draft/draftTypes';
import { dt } from '../../hooks/draft/draftTypes';

type FilterMode = 'all' | 'round' | 'owner';

interface Props {
  picks: Pick[];
  participants: Participant[];
  cardStyle: React.CSSProperties;
}

export default function DraftPicksLog({ picks, participants, cardStyle }: Props) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterRound, setFilterRound] = useState<number>(1);
  const [filterOwner, setFilterOwner] = useState<string>('');

  const pill = (active: boolean, col: string): React.CSSProperties => ({
    padding: '4px 14px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
    background: active ? col : 'transparent',
    color: active ? 'white' : dt.textSecondary,
    border: `1px solid ${active ? col : dt.border}`,
    cursor: 'pointer',
  });

  const roundNumbers = Array.from(new Set(picks.map(p => p.round))).sort((a, b) => a - b);

  const filteredPicks = picks.filter(pick => {
    if (filterMode === 'round') return pick.round === filterRound;
    if (filterMode === 'owner') return pick.participant_id === filterOwner;
    return true;
  });

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ color: dt.textPrimary, margin: 0, fontSize: '18px' }}>Picks Made ({picks.length})</h2>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={pill(filterMode === 'all', dt.blue)} onClick={() => setFilterMode('all')}>All</button>
          <button style={pill(filterMode === 'round', dt.blue)} onClick={() => setFilterMode('round')}>By Round</button>
          <button style={pill(filterMode === 'owner', dt.blue)} onClick={() => setFilterMode('owner')}>By Team</button>
        </div>
      </div>

      {filterMode === 'round' && roundNumbers.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {roundNumbers.map(r => (
            <button key={r} style={pill(filterRound === r, dt.greenDark)} onClick={() => setFilterRound(r)}>
              Rd {r}
            </button>
          ))}
        </div>
      )}

      {filterMode === 'owner' && participants.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {participants.map(p => (
            <button key={p.id} style={pill(filterOwner === p.id, dt.greenDark)} onClick={() => setFilterOwner(p.id)}>
              {p.team_name}
            </button>
          ))}
        </div>
      )}

      {filteredPicks.length === 0 ? (
        <p style={{ color: dt.textSecondary }}>No picks yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {filteredPicks.map(pick => {
            const participant = participants.find(p => p.id === pick.participant_id);
            return (
              <div key={pick.id} style={{ padding: '13px 16px', border: `1px solid ${dt.border}`, borderRadius: '7px', background: dt.cardInner }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: '700', color: dt.textPrimary }}>Pick {pick.pick_number}</span>
                    <span style={{ marginLeft: '8px', fontSize: '13px', color: dt.textSecondary }}>Rd {pick.round}, Pick {pick.pick_in_round}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: dt.textPrimary }}>{pick.player?.display_name ?? 'Unknown Player'}</div>
                    <div style={{ fontSize: '13px', color: dt.textSecondary }}>
                      {pick.player?.fantasy_position ?? pick.player?.position ?? '—'}
                      {pick.player?.team?.abbreviation ? ` · ${pick.player.team.abbreviation}` : ''}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '4px', fontSize: '13px', color: dt.textSecondary }}>
                  {participant?.team_name}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
