import { useState } from 'react';
import type { BoardPlayer, RankingSource, SortByMode } from '../../hooks/draft/draftTypes';
import { dt } from '../../hooks/draft/draftTypes';
import type { ApplySortMode } from '../../hooks/draft/useMyDraftBoard';
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
  onReorder: (from: number, to: number) => void;
  onRemove: (rankingId: string) => void;
  onRemoveAll: () => void;
  onPick: (playerId: string) => void;
  onGoToAddPlayers: () => void;
  onApplySort: (mode: ApplySortMode) => void;
}

// Sort options shown in Apply Sort panel, filtered by available data
const SORT_OPTIONS: { mode: ApplySortMode; label: string; sources?: RankingSource[] }[] = [
  { mode: 'overall_rank',   label: 'Overall Rank' },
  { mode: 'position_rank',  label: 'Position Rank' },
  { mode: 'fantasy_points', label: 'Points (Last Season)', sources: ['last_season'] },
  { mode: 'adp',            label: 'ADP', sources: ['espn', 'fantasypros'] },
  { mode: 'name',           label: 'Name (A–Z)' },
];

export default function MyRankingsTab({
  boardPlayers, boardLoading, pickedPlayerIds, canPick,
  reorderError, sortByMode, rankingSource, applySortLoading,
  onReorder, onRemove, onRemoveAll, onPick, onGoToAddPlayers, onApplySort,
}: Props) {
  const [openMoveId, setOpenMoveId]   = useState<string | null>(null);
  const [showSortPanel, setShowSortPanel] = useState(false);

  const hasRankData = boardPlayers.some(p =>
    p.overall_rank != null || p.position_rank != null || p.fantasy_points != null || p.adp != null
  );

  const visibleSortOptions = SORT_OPTIONS.filter(opt =>
    !opt.sources || opt.sources.includes(rankingSource)
  );

  function handleToggleMove(id: string | null) {
    setOpenMoveId(prev => (prev === id ? null : id));
  }

  function handleReorder(from: number, to: number) {
    setOpenMoveId(null);
    onReorder(from, to);
  }

  function handleApplySort(mode: ApplySortMode) {
    setShowSortPanel(false);
    onApplySort(mode);
  }

  return (
    <>
      {/* Toolbar row */}
      {boardPlayers.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px', flexWrap: 'wrap' }}>
          {/* Apply Sort */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSortPanel(p => !p)}
              disabled={applySortLoading}
              style={{
                padding: '5px 12px', fontSize: '12px', fontWeight: '600',
                background: showSortPanel ? dt.blue : 'transparent',
                color: showSortPanel ? '#fff' : dt.blue,
                border: `1px solid ${dt.blue}`, borderRadius: '6px',
                cursor: applySortLoading ? 'not-allowed' : 'pointer',
                opacity: applySortLoading ? 0.6 : 1,
              }}
            >
              {applySortLoading ? 'Sorting…' : '⇅ Apply Sort'}
            </button>

            {showSortPanel && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 20,
                marginTop: '4px', background: '#1e293b', border: `1px solid ${dt.border}`,
                borderRadius: '8px', padding: '6px 0', minWidth: '180px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                {!hasRankData && (
                  <p style={{ padding: '6px 14px', fontSize: '11px', color: dt.textSecondary, margin: 0 }}>
                    No ranking data loaded. Switch source on Add Players first.
                  </p>
                )}
                {visibleSortOptions.map(opt => (
                  <button
                    key={opt.mode}
                    onClick={() => handleApplySort(opt.mode)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 14px', fontSize: '13px', fontWeight: '500',
                      background: 'transparent', color: dt.textPrimary,
                      border: 'none', cursor: 'pointer',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#334155'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Remove All */}
          <button
            onClick={onRemoveAll}
            style={{
              padding: '5px 12px', fontSize: '12px', fontWeight: '600',
              background: 'transparent', color: '#ef4444',
              border: '1px solid #ef4444', borderRadius: '6px', cursor: 'pointer',
            }}
          >
            Remove All
          </button>
        </div>
      )}

      {reorderError && (
        <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', background: '#450a0a', border: '1px solid #ef4444', color: '#fca5a5', fontSize: '12px' }}>
          {reorderError}
        </div>
      )}

      {boardLoading ? (
        <p style={{ color: dt.textSecondary, fontSize: '14px', textAlign: 'center', padding: '30px 0' }}>Loading…</p>
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
              isMoveOpen={openMoveId === player.id}
              sortByMode={sortByMode}
              rankingSource={rankingSource}
              onToggleMove={handleToggleMove}
              onReorder={handleReorder}
              onRemove={onRemove}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </>
  );
}
