import { useState } from 'react';
import type { BoardPlayer, RankingSource, SortByMode } from '../../hooks/draft/draftTypes';
import { dt, RANKING_SOURCE_LABELS } from '../../hooks/draft/draftTypes';
import type { PositionGroupTab, ApplySortMode } from '../../hooks/draft/useMyDraftBoard';
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
  applySortLoading: boolean;
  onReorder: (subFrom: number, subTo: number, group: PositionGroupTab) => void;
  onRemove: (rankingId: string) => void;
  onRemoveAll: () => void;
  onPick: (playerId: string) => void;
  onGoToAddPlayers: () => void;
  onApplySort: (mode: ApplySortMode) => Promise<void>;
  onOpenDetail: (id: string) => void;
}

export default function MyRankingsTab({
  boardPlayers, boardLoading, pickedPlayerIds, canPick,
  reorderError, sortByMode, rankingSource, applySortLoading,
  onReorder, onRemove, onRemoveAll, onPick, onGoToAddPlayers, onApplySort, onOpenDetail,
}: Props) {
  const [positionTab, setPositionTab] = useState<PositionGroupTab>('Overall');
  const [openMoveId, setOpenMoveId] = useState<string | null>(null);
  const [confirmSort, setConfirmSort] = useState<ApplySortMode | null>(null);

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

  async function handleConfirmSort() {
    if (!confirmSort) return;
    setConfirmSort(null);
    await onApplySort(confirmSort);
  }

  const srcLabel = RANKING_SOURCE_LABELS[rankingSource];

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
        marginBottom: '10px', paddingBottom: '10px',
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

      {/* Sort Board controls — only shown when board has players */}
      {boardPlayers.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
          marginBottom: '10px', paddingBottom: '10px',
          borderBottom: `1px solid ${dt.border}`,
        }}>
          <span style={{ fontSize: '11px', fontWeight: '600', color: dt.textSecondary, whiteSpace: 'nowrap' }}>
            Sort Board:
          </span>
          <button
            onClick={() => setConfirmSort('overall_rank')}
            disabled={applySortLoading}
            style={{
              padding: '4px 10px', fontSize: '11px', fontWeight: '600', cursor: applySortLoading ? 'not-allowed' : 'pointer',
              background: 'transparent', color: '#60a5fa', border: '1px solid #1d4ed8', borderRadius: '5px',
              opacity: applySortLoading ? 0.5 : 1,
            }}
          >
            {srcLabel} Overall
          </button>
          <button
            onClick={() => setConfirmSort('position_rank')}
            disabled={applySortLoading}
            style={{
              padding: '4px 10px', fontSize: '11px', fontWeight: '600', cursor: applySortLoading ? 'not-allowed' : 'pointer',
              background: 'transparent', color: '#60a5fa', border: '1px solid #1d4ed8', borderRadius: '5px',
              opacity: applySortLoading ? 0.5 : 1,
            }}
          >
            {srcLabel} Position
          </button>
          {applySortLoading && (
            <span style={{ fontSize: '11px', color: dt.textSecondary }}>Sorting…</span>
          )}
        </div>
      )}

      {/* Confirm sort dialog */}
      {confirmSort && (
        <div style={{
          marginBottom: '12px', padding: '12px 14px',
          borderRadius: '8px', background: '#1a2540', border: `1px solid ${dt.border}`,
        }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', color: dt.textPrimary }}>
            Sort My Rankings by <strong>{srcLabel} {confirmSort === 'overall_rank' ? 'Overall Rank' : 'Position Rank'}</strong>?
            {' '}This will overwrite your current manual order. Drafted players move to the bottom.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleConfirmSort}
              style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '700', background: dt.blue, color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
            >
              Sort Now
            </button>
            <button
              onClick={() => setConfirmSort(null)}
              style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '600', background: 'transparent', color: dt.textSecondary, border: `1px solid ${dt.border}`, borderRadius: '5px', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
