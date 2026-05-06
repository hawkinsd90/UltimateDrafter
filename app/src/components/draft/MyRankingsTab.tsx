import type { BoardPlayer } from '../../hooks/draft/draftTypes';
import { dt } from '../../hooks/draft/draftTypes';
import BoardPlayerRow from './BoardPlayerRow';

interface Props {
  boardPlayers: BoardPlayer[];
  boardLoading: boolean;
  pickedPlayerIds: Set<string>;
  canPick: boolean;
  onReorder: (from: number, to: number) => void;
  onRemove: (rankingId: string) => void;
  onRemoveAll: () => void;
  onPick: (playerId: string) => void;
  onGoToAddPlayers: () => void;
}

export default function MyRankingsTab({
  boardPlayers, boardLoading, pickedPlayerIds, canPick,
  onReorder, onRemove, onRemoveAll, onPick, onGoToAddPlayers,
}: Props) {
  return (
    <>
      {boardPlayers.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
          <button
            onClick={onRemoveAll}
            style={{ padding: '5px 12px', fontSize: '12px', fontWeight: '600', background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', cursor: 'pointer' }}
          >
            Remove All
          </button>
        </div>
      )}

      {boardLoading ? (
        <p style={{ color: dt.textSecondary, fontSize: '14px', textAlign: 'center', padding: '30px 0' }}>Loading...</p>
      ) : boardPlayers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <p style={{ color: dt.textSecondary, fontSize: '14px', margin: '0 0 12px' }}>Your board is empty.</p>
          <button
            onClick={onGoToAddPlayers}
            style={{ padding: '8px 18px', background: dt.blue, color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
          >
            Add Players
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {boardPlayers.map((player, index) => (
            <BoardPlayerRow
              key={player.id}
              player={player}
              index={index}
              totalCount={boardPlayers.length}
              isPicked={pickedPlayerIds.has(player.id)}
              canPick={canPick}
              onReorder={onReorder}
              onRemove={onRemove}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </>
  );
}
