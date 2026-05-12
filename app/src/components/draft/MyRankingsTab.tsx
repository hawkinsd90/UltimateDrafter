import { useState } from 'react';
import type { BoardPlayer, RankingSource, SortByMode } from '../../hooks/draft/draftTypes';
import { dt } from '../../hooks/draft/draftTypes';
import type { PositionGroupTab } from '../../hooks/draft/useMyDraftBoard';
import { POSITION_GROUP_TABS } from '../../hooks/draft/useMyDraftBoard';
import BoardPlayerRow from './BoardPlayerRow';

interface Props {
  boardPlayers: BoardPlayer[];
  boardLoading: boolean;
  pickedPlayerIds: Set<string>;
  canPick: boolean;
  reorderError: string | null;
  sortByMode: SortByMode;
  rankingSource: RankingSource;
  onReorder: (subFrom: number, subTo: number, group: PositionGroupTab) => void;
  onRemove: (rankingId: string) => void;
  onRemoveAll: () => void;
  onPick: (playerId: string) => void;
  onGoToAddPlayers: () => void;
  onOpenDetail: (id: string) => void;
}

export default function MyRankingsTab({
  boardPlayers, boardLoading, pickedPlayerIds, canPick,
  reorderError, sortByMode, rankingSource,
  onReorder, onRemove, onRemoveAll, onPick, onGoToAddPlayers, onOpenDetail,
}: Props) {
  const [positionTab, setPositionTab] = useState<PositionGroupTab>('Overall');
  const [openMoveId, setOpenMoveId] = useState<string | null>(null);

  // Filter players for the current position tab
  const filteredPlayers: BoardPlayer[] = positionTab === 'Overall'
    ? [...boardPlayers].sort((a, b) => a.rank - b.rank)
    : boardPlayers
        .filter(p => p.fantasy_position === positionTab || (positionTab === 'DST' && p.fantasy_position === 'DEF'))
        .sort((a, b) => a.rank - b.rank);

  // Count per position for badge display
  function countForGroup(group: PositionGroupTab): number {
    if (group === 'Overall') return boardPlayers.filter(p => !pickedPlayerIds.has(p.id)).length;
    return boardPlayers.filter(p =>
      !pickedPlayerIds.has(p.id) &&
      (p.fantasy_position === group || (group === 'DST' && p.fantasy_position === 'DEF'))
    ).length;
  }

  function handleToggleMove(id: string | null) {
    setOpenMoveId(prev => (prev === id ? null : id));
  }

  function handleReorder(subFrom: number, subTo: number) {
    setOpenMoveId(null);
    onReorder(subFrom, subTo, positionTab);
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px',
    fontSize: '12px',
    fontWeight: '600',
    background: active ? dt.blue : 'transparent',
    color: active ? '#fff' : dt.textSecondary,
    border: `1px solid ${active ? dt.blue : dt.border}`,
    borderRadius: '5px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  return (
    <>
      {/* Position sub-tabs */}
      <div style={{
        display: 'flex', gap: '6px', flexWrap: 'wrap',
        marginBottom: '12px', paddingBottom: '12px',
        borderBottom: `1px solid ${dt.border}`,
      }}>
        {POSITION_GROUP_TABS.map(tab => {
          const count = countForGroup(tab);
          return (
            <button
              key={tab}
              onClick={() => { setPositionTab(tab); setOpenMoveId(null); }}
              style={tabStyle(positionTab === tab)}
            >
              {tab}{count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}

        {/* Remove All — pushed to the right */}
        {boardPlayers.length > 0 && (
          <button
            onClick={onRemoveAll}
            style={{
              marginLeft: 'auto',
              padding: '5px 12px', fontSize: '12px', fontWeight: '600',
              background: 'transparent', color: '#ef4444',
              border: '1px solid #ef4444', borderRadius: '5px', cursor: 'pointer',
            }}
          >
            Remove All
          </button>
        )}
      </div>

      {reorderError && (
        <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', background: '#450a0a', border: '1px solid #ef4444', color: '#fca5a5', fontSize: '12px' }}>
          {reorderError}
        </div>
      )}

      {boardLoading ? (
        <p style={{ color: dt.textSecondary, fontSize: '14px', textAlign: 'center', padding: '30px 0' }}>Loading…</p>
      ) : filteredPlayers.length === 0 && boardPlayers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <p style={{ color: dt.textSecondary, fontSize: '14px', margin: '0 0 12px' }}>Your board is empty.</p>
          <button
            onClick={onGoToAddPlayers}
            style={{ padding: '8px 18px', background: dt.blue, color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
          >
            Add Players
          </button>
        </div>
      ) : filteredPlayers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <p style={{ color: dt.textSecondary, fontSize: '14px', margin: '0 0 12px' }}>No {positionTab} players on your board.</p>
          <button
            onClick={onGoToAddPlayers}
            style={{ padding: '8px 18px', background: dt.blue, color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
          >
            Add {positionTab} Players
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {filteredPlayers.map((player, subIndex) => (
            <BoardPlayerRow
              key={player.id}
              player={player}
              index={subIndex}
              totalCount={filteredPlayers.length}
              isPicked={pickedPlayerIds.has(player.id)}
              canPick={canPick}
              isMoveOpen={openMoveId === player.id}
              sortByMode={sortByMode}
              rankingSource={rankingSource}
              onToggleMove={handleToggleMove}
              onReorder={handleReorder}
              onRemove={onRemove}
              onPick={onPick}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </>
  );
}
