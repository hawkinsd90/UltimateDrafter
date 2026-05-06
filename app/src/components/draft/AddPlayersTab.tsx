import type {
  AvailablePlayer, PositionFilter,
  RankingSource, ScoringFormat, SortByMode,
} from '../../hooks/draft/draftTypes';
import {
  POSITIONS, RANKING_SOURCES, VALID_SCORING_FORMATS, VALID_SORT_MODES,
  RANKING_SOURCE_LABELS, SCORING_FORMAT_LABELS, SORT_BY_LABELS, dt,
} from '../../hooks/draft/draftTypes';
import AvailablePlayerRow from './AvailablePlayerRow';

interface Props {
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
  pickedPlayerIds: Set<string>;
  boardedPlayerIds: Set<string>;
  canPick: boolean;
  addAllLoading: boolean;
  addAllError: string | null;
  draftScoringRuleId: string | null;
  lastSeasonRankingsAvailable: boolean;
  onAddPlayer: (id: string) => void;
  onAddAll: () => void;
  onPickPlayer: (id: string) => void;
}

const pillBase: React.CSSProperties = {
  padding: '3px 10px', borderRadius: '20px', fontSize: '12px',
  fontWeight: '600', cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
};
const pillActive: React.CSSProperties = {
  ...pillBase, border: 'none', background: '#0f4c81', color: '#93c5fd',
};
const pillInactive: React.CSSProperties = {
  ...pillBase, border: `1px solid ${dt.border}`, background: 'transparent', color: dt.textSecondary,
};
const pillDisabled: React.CSSProperties = {
  ...pillBase, border: `1px solid ${dt.border}`, background: 'transparent',
  color: '#3a4a5c', cursor: 'default', opacity: 0.45,
};

const sectionLabel: React.CSSProperties = {
  fontSize: '11px', color: dt.textSecondary, fontWeight: '600',
  textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
};

// Source-specific descriptions shown below controls
const SOURCE_DESCRIPTIONS: Record<RankingSource, string> = {
  sleeper:     'Sleeper Relevance — general search ranking from Sleeper. Not a draft ADP.',
  espn:        'ESPN Draft Rankings — overall and position draft ranks.',
  fantasypros: 'FantasyPros ECR — expert consensus rankings across 100+ analysts.',
  last_season: 'Calculated from 2025 season stats using this draft\'s imported league scoring rules.',
};

export default function AddPlayersTab({
  boardSearch, setBoardSearch,
  boardPositionFilter, setBoardPositionFilter,
  rankingSource, setRankingSource,
  scoringFormat, setScoringFormat,
  sortByMode, setSortByMode,
  boardAvailablePlayers, boardAvailableLoading,
  rankingDataAvailable, showBoardSearch, pickedPlayerIds, boardedPlayerIds,
  canPick, addAllLoading, addAllError,
  draftScoringRuleId, lastSeasonRankingsAvailable,
  onAddPlayer, onAddAll, onPickPlayer,
}: Props) {
  const positionLabel = boardPositionFilter === 'All' ? 'every eligible player' : `every eligible ${boardPositionFilter}`;
  const validFormats = VALID_SCORING_FORMATS[rankingSource];
  const validSorts   = VALID_SORT_MODES[rankingSource];

  const showNoDataBanner = showBoardSearch && !boardAvailableLoading && !rankingDataAvailable
    && sortByMode !== 'name';

  const lastSeasonUnavailable = rankingSource === 'last_season'
    && (!draftScoringRuleId || !lastSeasonRankingsAvailable);
  const addAllDisabled = addAllLoading || lastSeasonUnavailable;

  return (
    <>
      {/* Search + Add All row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <input
          type="text"
          value={boardSearch}
          onChange={e => setBoardSearch(e.target.value)}
          placeholder="Search by name..."
          style={{
            flex: 1, padding: '9px 12px', border: `1px solid ${dt.border}`,
            borderRadius: '7px', fontSize: '14px', color: dt.textPrimary,
            background: dt.cardInner, outline: 'none',
          }}
        />
        <button
          onClick={onAddAll}
          disabled={addAllDisabled}
          title={lastSeasonUnavailable ? 'Last Season rankings not available for this draft' : undefined}
          style={{
            padding: '9px 12px', fontSize: '12px', fontWeight: '600',
            background: 'transparent',
            color: addAllDisabled ? dt.textSecondary : dt.blue,
            border: `1px solid ${addAllDisabled ? dt.border : dt.blue}`,
            borderRadius: '7px', cursor: addAllDisabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', opacity: addAllDisabled ? 0.6 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {addAllLoading ? 'Adding...' : '+ Add All'}
        </button>
      </div>

      {/* Add All error banner */}
      {addAllError && (
        <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', background: '#450a0a', border: '1px solid #ef4444', color: '#fca5a5', fontSize: '12px' }}>
          {addAllError}
        </div>
      )}

      {/* Position filter */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' }}>
        {POSITIONS.map(pos => (
          <button
            key={pos}
            onClick={() => setBoardPositionFilter(pos)}
            style={boardPositionFilter === pos
              ? { ...pillBase, border: 'none', background: dt.blue, color: 'white', padding: '4px 11px' }
              : { ...pillBase, border: `1px solid ${dt.border}`, background: 'transparent', color: dt.textSecondary, padding: '4px 11px' }
            }
          >
            {pos}
          </button>
        ))}
      </div>

      {/* Ranking Source selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span style={sectionLabel}>Source:</span>
        {RANKING_SOURCES.map(src => (
          <button
            key={src}
            onClick={() => setRankingSource(src)}
            style={rankingSource === src ? pillActive : pillInactive}
          >
            {RANKING_SOURCE_LABELS[src]}
          </button>
        ))}
      </div>

      {/* Scoring Format selector — hide for 'any' and 'custom' (single-value sources) */}
      {validFormats.length > 1 && rankingSource !== 'last_season' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span style={sectionLabel}>Format:</span>
          {(['standard', 'half_ppr', 'ppr'] as ScoringFormat[]).map(fmt => {
            const valid = validFormats.includes(fmt);
            const active = scoringFormat === fmt && valid;
            return (
              <button
                key={fmt}
                onClick={() => valid && setScoringFormat(fmt)}
                style={active ? pillActive : valid ? pillInactive : pillDisabled}
              >
                {SCORING_FORMAT_LABELS[fmt]}
              </button>
            );
          })}
        </div>
      )}

      {/* Last Season: show format as static "League Rules" badge */}
      {rankingSource === 'last_season' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span style={sectionLabel}>Format:</span>
          <span style={{ ...pillActive, cursor: 'default' }}>
            {SCORING_FORMAT_LABELS['custom']}
          </span>
        </div>
      )}

      {/* Sort By selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <span style={sectionLabel}>Sort:</span>
        {(['name', 'overall_rank', 'position_rank', 'fantasy_points', 'adp', 'relevance'] as SortByMode[]).map(mode => {
          const valid = validSorts.includes(mode);
          const active = sortByMode === mode && valid;
          return (
            <button
              key={mode}
              onClick={() => valid && setSortByMode(mode)}
              style={active ? pillActive : valid ? pillInactive : pillDisabled}
            >
              {SORT_BY_LABELS[mode]}
            </button>
          );
        })}
      </div>

      {/* Source description */}
      <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 10px', lineHeight: 1.4 }}>
        {SOURCE_DESCRIPTIONS[rankingSource]}
      </p>

      {/* Last Season: no scoring rule banner */}
      {rankingSource === 'last_season' && !draftScoringRuleId && (
        <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', background: '#1c1a10', border: '1px solid #78350f', color: '#fcd34d', fontSize: '12px' }}>
          No imported scoring rules found for this draft. Import ESPN scoring rules first to use Last Season rankings.
        </div>
      )}

      {/* Last Season: rankings not yet calculated banner */}
      {rankingSource === 'last_season' && draftScoringRuleId && !lastSeasonRankingsAvailable && (
        <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', background: '#1c1a10', border: '1px solid #78350f', color: '#fcd34d', fontSize: '12px' }}>
          Last Season rankings have not been calculated for this draft yet.
          Go to Admin → Last Season Rankings to calculate them.
        </div>
      )}

      {/* No ranking data banner */}
      {showNoDataBanner && rankingSource !== 'last_season' && (
        <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', background: '#1c2a3a', border: `1px solid ${dt.border}`, color: dt.textSecondary, fontSize: '12px' }}>
          No ranking data synced for {RANKING_SOURCE_LABELS[rankingSource]}
          {validFormats.length > 1 ? ` / ${SCORING_FORMAT_LABELS[scoringFormat]}` : ''} yet.
          Showing players by name.
        </div>
      )}

      {/* Player list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {boardAvailableLoading && (
          <p style={{ color: dt.textSecondary, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Searching...</p>
        )}
        {!boardAvailableLoading && !showBoardSearch && (
          <p style={{ color: dt.textSecondary, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
            Use search or position filters to browse. "+ Add All" will add {positionLabel} to your rankings.
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
            sortByMode={sortByMode}
            rankingSource={rankingSource}
            onAdd={onAddPlayer}
            onPick={onPickPlayer}
          />
        ))}
      </div>
    </>
  );
}
