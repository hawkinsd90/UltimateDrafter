import { Link } from 'react-router-dom';
import type { Database } from '../../types/supabase';

type Draft = Database['public']['Tables']['drafts']['Row'];

interface Props {
  drafts: Draft[];
  leagueId: string;
  isOwner: boolean;
  myDraftIds: Set<string>;
  onPause: (draftId: string) => void;
  onResume: (draftId: string) => void;
  onDelete: (draftId: string, name: string) => void;
}

export default function LeagueDraftsTab({ drafts, leagueId, isOwner, myDraftIds, onPause, onResume, onDelete }: Props) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: '0' }}>Drafts</h2>
        {isOwner && (
          <Link
            to={`/leagues/${leagueId}/drafts/create`}
            style={{ display: 'inline-block', padding: '10px 20px', background: '#059669', color: 'white', textDecoration: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '500' }}
          >
            Create New Draft
          </Link>
        )}
      </div>

      {drafts.length === 0 ? (
        <div style={{ padding: '40px', background: '#f9fafb', border: '2px dashed #d1d5db', borderRadius: '8px', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#374151' }}>No Drafts Yet</h3>
          <p style={{ margin: '0 0 20px 0', color: '#6b7280' }}>
            Create your first draft to start selecting players for your fantasy team.
          </p>
          {isOwner && (
            <Link
              to={`/leagues/${leagueId}/drafts/create`}
              style={{ display: 'inline-block', padding: '12px 24px', background: '#059669', color: 'white', textDecoration: 'none', borderRadius: '6px', fontWeight: '500' }}
            >
              Create Your First Draft
            </Link>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {drafts.map(draft => (
            <div key={draft.id} style={{ padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 5px 0' }}>{draft.name}</h3>
                <p style={{ margin: '0', color: '#6b7280', fontSize: '14px' }}>
                  Status: {draft.status.replace('_', ' ')} • Type: {draft.draft_type}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {isOwner && draft.status === 'in_progress' && (
                  <button onClick={() => onPause(draft.id)} style={{ padding: '8px 14px', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}>
                    Pause
                  </button>
                )}
                {isOwner && draft.status === 'paused' && (
                  <button onClick={() => onResume(draft.id)} style={{ padding: '8px 14px', background: '#f0fdf4', color: '#166534', border: '1px solid #86efac', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}>
                    Resume
                  </button>
                )}
                <Link to={`/drafts/${draft.id}/participants`} style={{ padding: '8px 14px', background: '#f3f4f6', color: '#374151', textDecoration: 'none', borderRadius: '6px', fontSize: '14px' }}>
                  Manage Participants
                </Link>
                <Link to={`/drafts/${draft.id}`} style={{ padding: '8px 14px', background: '#2563eb', color: 'white', textDecoration: 'none', borderRadius: '6px', fontSize: '14px' }}>
                  View Draft
                </Link>
                {myDraftIds.has(draft.id) && (
                  <Link to={`/drafts/${draft.id}/my-team`} style={{ padding: '8px 14px', background: '#0f766e', color: 'white', textDecoration: 'none', borderRadius: '6px', fontSize: '14px' }}>
                    My Team
                  </Link>
                )}
                {isOwner && (
                  <button onClick={() => onDelete(draft.id, draft.name)} style={{ padding: '8px 14px', background: 'none', color: '#dc2626', border: '1px solid #dc2626', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
