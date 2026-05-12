import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';
import PlayerSearch from '../components/PlayerSearch';
import { useDraftBoard } from '../hooks/draft/useDraftBoard';
import { useMyDraftBoard } from '../hooks/draft/useMyDraftBoard';
import { usePlayerDetail } from '../hooks/draft/usePlayerDetail';
import { dt } from '../hooks/draft/draftTypes';
import type { TabId } from '../hooks/draft/draftTypes';
import DraftStatusCard from '../components/draft/DraftStatusCard';
import DraftActions from '../components/draft/DraftActions';
import DraftOrderList from '../components/draft/DraftOrderList';
import DraftPicksLog from '../components/draft/DraftPicksLog';
import MyBoardPanel from '../components/draft/MyBoardPanel';
import PlayerDetailModal from '../components/draft/PlayerDetailModal';

export default function DraftBoard() {
  const { draftId } = useParams<{ draftId: string }>();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showPlayerSearch, setShowPlayerSearch] = useState(false);

  const board = useDraftBoard(draftId!, user?.id);

  const myBoard = useMyDraftBoard(
    draftId!,
    user?.id,
    activeTab === 'myboard',
    board.picks.length,
  );

  const detail = usePlayerDetail(draftId!, user?.id, myBoard.draftScoringRuleId);

  if (board.loading) {
    return <div style={{ padding: '40px', background: dt.bg, minHeight: '100vh', color: dt.textPrimary }}>Loading...</div>;
  }
  if (!board.draft) {
    return <div style={{ padding: '40px', background: dt.bg, minHeight: '100vh', color: dt.textPrimary }}>Draft not found</div>;
  }

  const cardStyle: React.CSSProperties = {
    background: dt.card, border: `1px solid ${dt.border}`, borderRadius: '10px', padding: '20px', marginBottom: '20px',
  };
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', border: 'none',
    background: 'transparent',
    color: active ? dt.textPrimary : dt.textSecondary,
    borderBottom: active ? `2px solid ${dt.blue}` : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
  });

  async function handleMakePick(playerId: string) {
    setShowPlayerSearch(false);
    await board.makePick(playerId);
  }

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'system-ui, sans-serif', color: dt.textPrimary, background: dt.bg, minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to={`/leagues/${board.draft.league_id}`} style={{ color: dt.blue, textDecoration: 'none', fontSize: '14px' }}>
          ← Back to League
        </Link>
        <UserMenu />
      </div>

      <h1 style={{ color: dt.textPrimary, marginBottom: '20px', fontSize: '26px' }}>{board.draft.name}</h1>

      <DraftStatusCard
        draft={board.draft}
        draftSettings={board.draftSettings}
        currentParticipant={board.currentParticipant}
        currentRound={board.currentRound}
        totalRounds={board.totalRounds}
        roundsRemaining={board.roundsRemaining}
      />

      {board.error && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5' }}>
          {board.error}
        </div>
      )}

      <DraftActions
        draft={board.draft}
        draftId={draftId!}
        isOwner={board.isOwner}
        draftNotStarted={board.draftNotStarted}
        canMakePick={board.canMakePick}
        canForcePick={board.canForcePick}
        myParticipant={board.myParticipant}
        currentParticipant={board.currentParticipant}
        onStartDraft={board.startDraft}
        onMakePick={() => setShowPlayerSearch(true)}
        onPauseDraft={board.pauseDraft}
        onResumeDraft={board.resumeDraft}
      />

      {board.draft.status === 'paused' && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#451a03', border: `1px solid ${dt.amber}`, borderRadius: '6px', color: dt.amber, fontSize: '14px' }}>
          Draft is paused.{board.isOwner ? ' Use Resume Draft to continue.' : ' Waiting for the commissioner to resume.'}
        </div>
      )}

      {showPlayerSearch && (
        <PlayerSearch
          draftId={draftId!}
          onSelectPlayer={handleMakePick}
          onClose={() => setShowPlayerSearch(false)}
        />
      )}

      {/* Main tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${dt.border}`, marginBottom: '20px' }}>
        <button style={tabStyle(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>Overview</button>
        <button style={tabStyle(activeTab === 'myboard')} onClick={() => setActiveTab('myboard')}>My Board</button>
      </div>

      {activeTab === 'overview' && (
        <>
          <DraftOrderList
            participants={board.participants}
            currentParticipant={board.currentParticipant}
            cardStyle={cardStyle}
          />
          <DraftPicksLog
            picks={board.picks}
            participants={board.participants}
            cardStyle={cardStyle}
          />
        </>
      )}

      {activeTab === 'myboard' && (
        <MyBoardPanel
          isMyTurn={board.isMyTurn}
          canForcePick={board.canForcePick}
          currentParticipant={board.currentParticipant}
          draftStatus={board.draft.status}
          boardPlayers={myBoard.boardPlayers}
          boardLoading={myBoard.boardLoading}
          pickedPlayerIds={board.pickedPlayerIds}
          onRemovePlayer={myBoard.removePlayerFromBoard}
          onRemoveAll={myBoard.removeAllFromBoard}
          onPickFromBoard={board.makePick}
          boardSearch={myBoard.boardSearch}
          setBoardSearch={myBoard.setBoardSearch}
          boardPositionFilter={myBoard.boardPositionFilter}
          setBoardPositionFilter={myBoard.setBoardPositionFilter}
          rankingSource={myBoard.rankingSource}
          setRankingSource={myBoard.setRankingSource}
          scoringFormat={myBoard.scoringFormat}
          setScoringFormat={myBoard.setScoringFormat}
          sortByMode={myBoard.sortByMode}
          setSortByMode={myBoard.setSortByMode}
          boardAvailablePlayers={myBoard.boardAvailablePlayers}
          boardAvailableLoading={myBoard.boardAvailableLoading}
          rankingDataAvailable={myBoard.rankingDataAvailable}
          showBoardSearch={myBoard.showBoardSearch}
          addAllLoading={myBoard.addAllLoading}
          addAllError={myBoard.addAllError}
          reorderError={myBoard.reorderError}
          draftScoringRuleId={myBoard.draftScoringRuleId}
          lastSeasonRankingsAvailable={myBoard.lastSeasonRankingsAvailable}
          onAddPlayer={myBoard.addPlayerToBoard}
          onAddAll={myBoard.addAllAvailableToBoard}
          onReorderInPositionGroup={myBoard.reorderInPositionGroup}
          onOpenDetail={detail.openPlayerDetail}
        />
      )}

      <PlayerDetailModal
        detail={detail.playerDetail}
        loading={detail.detailLoading}
        isOnBoard={detail.playerDetail != null && myBoard.boardPlayers.some(p => p.id === detail.playerDetail!.id)}
        isPicked={detail.playerDetail != null && board.pickedPlayerIds.has(detail.playerDetail.id)}
        canPick={(board.isMyTurn || board.canForcePick) && board.draft.status === 'in_progress'}
        onAdd={id => { myBoard.addPlayerToBoard(id); detail.closePlayerDetail(); }}
        onRemove={rankingId => { myBoard.removePlayerFromBoard(rankingId); detail.closePlayerDetail(); }}
        onPick={id => { board.makePick(id); detail.closePlayerDetail(); }}
        onClose={detail.closePlayerDetail}
      />
    </div>
  );
}
