import type { Draft, DraftSettings, Participant } from '../../hooks/draft/draftTypes';
import { dt } from '../../hooks/draft/draftTypes';

interface Props {
  draft: Draft;
  draftSettings: DraftSettings | null;
  currentParticipant: Participant | null;
  currentRound: number;
  totalRounds: number | null;
  roundsRemaining: number | null;
}

export default function DraftStatusCard({ draft, draftSettings, currentParticipant, currentRound, totalRounds, roundsRemaining }: Props) {
  const s = {
    card: { background: dt.card, border: `1px solid ${dt.border}`, borderRadius: '10px', padding: '20px', marginBottom: '20px' },
  };

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <span style={{ color: dt.textSecondary, fontWeight: '600' }}>Status:</span>
        <span style={{
          padding: '2px 12px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
          background: draft.status === 'in_progress' ? '#14532d' : draft.status === 'paused' ? '#451a03' : '#1e293b',
          color: draft.status === 'in_progress' ? dt.green : draft.status === 'paused' ? dt.amber : dt.textSecondary,
          border: `1px solid ${draft.status === 'in_progress' ? dt.greenDark : draft.status === 'paused' ? dt.amber : dt.border}`,
        }}>
          {draft.status.replace('_', ' ')}
        </span>
      </div>
      <p style={{ margin: '0 0 6px', color: dt.textPrimary, fontWeight: '700', fontSize: '17px' }}>
        Round {currentRound}{totalRounds != null ? ` of ${totalRounds}` : ''}
        {roundsRemaining != null && (
          <span style={{ marginLeft: '10px', color: dt.textSecondary, fontWeight: '400', fontSize: '14px' }}>
            · {roundsRemaining} round{roundsRemaining !== 1 ? 's' : ''} remaining · Pick #{draft.current_pick_number}
          </span>
        )}
      </p>
      {draftSettings && (
        <p style={{ margin: '0 0 8px', fontSize: '13px', color: dt.textSecondary }}>
          {draftSettings.draft_format === 'snake' ? 'Snake' : 'Linear'} Draft ·
          {draftSettings.pick_timer_seconds === 0 ? ' Unlimited time' : ` ${draftSettings.pick_timer_seconds}s per pick`} ·
          Roster: {draftSettings.roster_qb}QB {draftSettings.roster_rb}RB {draftSettings.roster_wr}WR {draftSettings.roster_te}TE {draftSettings.roster_flex}FLEX {draftSettings.roster_k}K {draftSettings.roster_dst}DST {draftSettings.bench}Bench
        </p>
      )}
      {currentParticipant && (
        <p style={{ margin: '0', fontSize: '16px', color: dt.green, fontWeight: '700' }}>
          On the clock: {currentParticipant.team_name}
        </p>
      )}
    </div>
  );
}
