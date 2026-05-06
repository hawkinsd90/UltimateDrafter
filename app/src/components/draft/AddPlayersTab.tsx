import type { AvailablePlayer, PositionFilter, SortMode } from '../../hooks/draft/draftTypes';
import { POSITIONS, dt } from '../../hooks/draft/draftTypes';
import AvailablePlayerRow from './AvailablePlayerRow';

interface Props {
  boardSearch: string;
  setBoardSearch: (v: string) => void;
  boardPositionFilter: PositionFilter;
  setBoardPositionFilter: (v: PositionFilter) => void;
  boardSortMode: SortMode;
  setBoardSortMode: (v: SortMode) => void;
  boardAvailablePlayers: AvailablePlayer[];
  boardAvailableLoading: boolean;
  showBoardSearch: boolean;
  pickedPlayerIds: Set<string>;
  boardedPlayerIds: Set<string>;
  canPick: boolean;
  addAllLoading: boolean;
  onAddPlayer: (id: string) => void;
  onAddAll: () => void;
  onPickPlayer: (id: string) => void;
}

export default function AddPlayersTab({
  boardSearch, setBoardSearch,
  boardPositionFilter, setBoardPositionFilter,
  boardSortMode, setBoardSortMode,
  boardAvailablePlayers, boardAvailableLoading,
  showBoardSearch, pickedPlayerIds, boardedPlayerIds,
  canPick, addAllLoading,
  onAddPlayer, onAddAll, onPickPlayer,
}: Props) {
  return (
    <>
      {/* Search + Add All row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <input
          type="text"
          value={boardSearch}
          onChange={e => setBoardSearch(e.target.value)}
          placeholder="Search by name..."
          style={{ flex: 1, padding: '9px 12px', border: `1px solid ${dt.border}`, borderRadius: '7px', fontSize: '14px', color: dt.textPrimary, background: dt.cardInner, outline: 'none' }}
        />
        <button
          onClick={onAddAll}
          disabled={addAllLoading}
          style={{
            padding: '9px 12px', fontSize: '12px', fontWeight: '600',
            background: 'transparent', color: addAllLoading ? dt.textSecondary : dt.blue,
            border: `1px solid ${addAllLoading ? dt.border : dt.blue}`,
            borderRadius: '7px', cursor: addAllLoading ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', opacity: addAllLoading ? 0.6 : 1,
          }}
        >
          {addAllLoading ? 'Adding...' : '+ Add All'}
        </button>
      </div>

      {/* Position filter */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' }}>
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setBoardPositionFilter(pos)} style={{
            padding: '4px 11px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
            border: boardPositionFilter === pos ? 'none' : `1px solid ${dt.border}`,
            background: boardPositionFilter === pos ? dt.blue : 'transparent',
            color: boardPositionFilter === pos ? 'white' : dt.textSecondary,
          }}>
            {pos}
          </button>
        ))}
      </div>

      {/* Sort controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
        <span style={{ fontSize: '11px', color: dt.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort:</span>
        {(['name', 'espn', 'sleeper'] as SortMode[]).map(mode => {
          const labels: Record<SortMode, string> = { name: 'A–Z', espn: 'ESPN', sleeper: 'Sleeper' };
          const active = boardSortMode === mode;
          return (
            <button key={mode} onClick={() => setBoardSortMode(mode)} style={{
              padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
              border: active ? 'none' : `1px solid ${dt.border}`,
              background: active ? '#0f4c81' : 'transparent',
              color: active ? '#93c5fd' : dt.textSecondary,
            }}>
              {labels[mode]}
            </button>
          );
        })}
      </div>

      {/* Player list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {boardAvailableLoading && (
          <p style={{ color: dt.textSecondary, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Searching...</p>
        )}
        {!boardAvailableLoading && !showBoardSearch && (
          <p style={{ color: dt.textSecondary, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
            Type at least 2 characters or select a position to browse.
          </p>
        )}
        {!boardAvailableLoading && showBoardSearch && boardAvailablePlayers.length === 0 && (
          <p style={{ color: dt.textSecondary, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>No players found.</p>
        )}
        {boardAvailablePlayers.map(player => (
          <AvailablePlayerRow
            key={player.id}
            player={player}
            isPicked={pickedPlayerIds.has(player.id)}
            isOnBoard={boardedPlayerIds.has(player.id)}
            canPick={canPick}
            sortMode={boardSortMode}
            onAdd={onAddPlayer}
            onPick={onPickPlayer}
          />
        ))}
      </div>
    </>
  );
}
