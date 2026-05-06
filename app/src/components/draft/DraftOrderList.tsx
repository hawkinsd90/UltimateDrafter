import type { Participant } from '../../hooks/draft/draftTypes';
import { dt } from '../../hooks/draft/draftTypes';

interface Props {
  participants: Participant[];
  currentParticipant: Participant | null;
  cardStyle: React.CSSProperties;
}

export default function DraftOrderList({ participants, currentParticipant, cardStyle }: Props) {
  return (
    <div style={cardStyle}>
      <h2 style={{ color: dt.textPrimary, margin: '0 0 14px', fontSize: '18px' }}>Draft Order</h2>
      {participants.length === 0 ? (
        <p style={{ color: dt.textSecondary }}>No participants yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {participants.map(p => (
            <div key={p.id} style={{
              padding: '11px 14px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '10px',
              border: `2px solid ${p.id === currentParticipant?.id ? dt.green : dt.border}`,
              background: p.id === currentParticipant?.id ? '#052e16' : dt.cardInner,
            }}>
              <span style={{ fontWeight: '700', color: p.id === currentParticipant?.id ? dt.green : dt.textSecondary, minWidth: '24px' }}>
                {p.draft_position}.
              </span>
              <span style={{ color: dt.textPrimary, fontWeight: p.id === currentParticipant?.id ? '600' : '400' }}>
                {p.team_name}
              </span>
              {p.id === currentParticipant?.id && (
                <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: '700', color: dt.green }}>On the clock</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
