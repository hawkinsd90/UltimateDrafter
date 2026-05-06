import { useState } from 'react';
import type {
  BoardPlayer, AvailablePlayer, PositionFilter,
  RankingSource, ScoringFormat, SortByMode, Participant,
} from '../../hooks/draft/draftTypes';
import { dt } from '../../hooks/draft/draftTypes';
import MyRankingsTab from './MyRankingsTab';
import AddPlayersTab from './AddPlayersTab';

interface Props {
  isMyTurn: boolean;
  canForcePick: boolean;
  currentParticipant: Participant | null;
  draftStatus: string;

  boardPlayers: BoardPlayer[];
  boardLoading: boolean;
  pickedPlayerIds: Set<string>;
  onReorder: (from: number, to: number) => void;
  onRemovePlayer: (rankingId: string) => void;
  onRemoveAll: () => void;
  onPickFromBoard: (playerId: string) => void;

  boardSearch: string;
  setBoardSearch: (v: string) => void;
  boardPositionFilter: PositionFilter;
  setBoardPositionFilter: (v: PositionFilter) => void;
  rankingSource: RankingSource;
  setRankingSource: (v: RankingSource) => void;
  scoringFormat: ScoringFormat;
  setScoringFormat: (v: ScoringFormat) => void;
  sortByMode: SortByMode;
  setSortByMode: (v: SortByMode) => void;
  boardAvailablePlayers: AvailablePlayer[];
  boardAvailableLoading: boolean;
  rankingDataAvailable: boolean;
  showBoardSearch: boolean;
  addAllLoading: boolean;
  addAllError: string | null;
  reorderError: string | null;
  onAddPlayer: (id: string) => void;
  onAddAll: () => void;
}

export default function MyBoardPanel({
  isMyTurn, canForcePick, currentParticipant, draftStatus,
  boardPlayers, boardLoading, pickedPlayerIds,
  onReorder, onRemovePlayer, onRemoveAll, onPickFromBoard,
  boardSearch, setBoardSearch, boardPositionFilter, setBoardPositionFilter,
  rankingSource, setRankingSource, scoringFormat, setScoringFormat,
  sortByMode, setSortByMode,
  boardAvailablePlayers, boardAvailableLoading, rankingDataAvailable,
  showBoardSearch, addAllLoading, addAllError, reorderError,
  onAddPlayer, onAddAll,
}: Props) {
  const [subTab, setSubTab] = useState<'rankings' | 'available'>('rankings');

  const canPick = (isMyTurn || canForcePick) && draftStatus === 'in_progress';
  const availableCount = boardPlayers.filter(p => !pickedPlayerIds.has(p.id)).length;
  const boardedPlayerIds = new Set(boardPlayers.map(p => p.id));

  const subTabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
    border: 'none', background: 'transparent',
    color: active ? dt.textPrimary : dt.textSecondary,
    borderBottom: active ? `2px solid ${dt.blue}` : '2px solid transparent',
  });

  return (
    <div style={{ background: dt.card, border: `1px solid ${dt.border}`, borderRadius: '10px', padding: '20px' }}>
      {canPick && boardPlayers.some(p => !pickedPlayerIds.has(p.id)) && (
        <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '7px', background: '#14532d', border: `1px solid ${dt.greenDark}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: dt.green, boxShadow: `0 0 6px ${dt.green}` }} />
          <span style={{ color: dt.green, fontWeight: '700', fontSize: '13px' }}>
            {isMyTurn ? "Your turn to pick!" : `Force pick for ${currentParticipant?.team_name}`}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', borderBottom: `1px solid ${dt.border}`, marginBottom: '14px' }}>
        <button style={subTabStyle(subTab === 'rankings')} onClick={() => setSubTab('rankings')}>
          My Rankings {availableCount > 0 ? `(${availableCount})` : ''}
        </button>
        <button style={subTabStyle(subTab === 'available')} onClick={() => setSubTab('available')}>
          Add Players
        </button>
      </div>

      {subTab === 'rankings' && (
        <MyRankingsTab
          boardPlayers={boardPlayers}
          boardLoading={boardLoading}
          pickedPlayerIds={pickedPlayerIds}
          canPick={canPick}
          reorderError={reorderError}
          onReorder={onReorder}
          onRemove={onRemovePlayer}
          onRemoveAll={onRemoveAll}
          onPick={onPickFromBoard}
          onGoToAddPlayers={() => setSubTab('available')}
        />
      )}

      {subTab === 'available' && (
        <AddPlayersTab
          boardSearch={boardSearch}
          setBoardSearch={setBoardSearch}
          boardPositionFilter={boardPositionFilter}
          setBoardPositionFilter={setBoardPositionFilter}
          rankingSource={rankingSource}
          setRankingSource={setRankingSource}
          scoringFormat={scoringFormat}
          setScoringFormat={setScoringFormat}
          sortByMode={sortByMode}
          setSortByMode={setSortByMode}
          boardAvailablePlayers={boardAvailablePlayers}
          boardAvailableLoading={boardAvailableLoading}
          rankingDataAvailable={rankingDataAvailable}
          showBoardSearch={showBoardSearch}
          pickedPlayerIds={pickedPlayerIds}
          boardedPlayerIds={boardedPlayerIds}
          canPick={canPick}
          addAllLoading={addAllLoading}
          addAllError={addAllError}
          onAddPlayer={onAddPlayer}
          onAddAll={onAddAll}
          onPickPlayer={onPickFromBoard}
        />
      )}
    </div>
  );
}
