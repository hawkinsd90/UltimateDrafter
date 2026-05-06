import { Link } from 'react-router-dom';
import type { Draft, Participant } from '../../hooks/draft/draftTypes';
import { dt } from '../../hooks/draft/draftTypes';

interface Props {
  draft: Draft;
  draftId: string;
  isOwner: boolean;
  draftNotStarted: boolean;
  canMakePick: boolean;
  canForcePick: boolean;
  myParticipant: Participant | null;
  currentParticipant: Participant | null;
  onStartDraft: () => void;
  onMakePick: () => void;
  onPauseDraft: () => void;
  onResumeDraft: () => void;
}

export default function DraftActions({
  draft, draftId, isOwner, draftNotStarted, canMakePick, canForcePick,
  myParticipant, currentParticipant,
  onStartDraft, onMakePick, onPauseDraft, onResumeDraft,
}: Props) {
  const btn = (col: string): React.CSSProperties => ({
    padding: '10px 22px', background: col, color: 'white', border: 'none',
    borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '15px',
  });
  const btnOutline: React.CSSProperties = {
    padding: '10px 22px', background: 'transparent', color: dt.amber, border: `1px solid ${dt.amber}`,
    borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '15px',
  };
  const linkBtn: React.CSSProperties = {
    padding: '10px 22px', background: 'transparent', color: dt.textSecondary,
    border: `1px solid ${dt.border}`, borderRadius: '7px', fontWeight: '600',
    fontSize: '15px', textDecoration: 'none', lineHeight: '1',
    display: 'inline-flex', alignItems: 'center',
  };

  return (
    <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
      {isOwner && draftNotStarted && (
        <button onClick={onStartDraft} style={btn(dt.greenDark)}>Start Draft</button>
      )}
      {canMakePick && (
        <button onClick={onMakePick} style={btn(dt.blue)}>Make Pick</button>
      )}
      {canForcePick && (
        <button onClick={onMakePick} style={btn('#0f766e')}>
          Force Pick for {currentParticipant!.team_name}
        </button>
      )}
      {isOwner && draft.status === 'in_progress' && (
        <button onClick={onPauseDraft} style={btnOutline}>Pause Draft</button>
      )}
      {isOwner && draft.status === 'paused' && (
        <button onClick={onResumeDraft} style={btn(dt.greenDark)}>Resume Draft</button>
      )}
      {myParticipant && (
        <Link to={`/drafts/${draftId}/my-team`} style={linkBtn}>My Team</Link>
      )}
    </div>
  );
}
