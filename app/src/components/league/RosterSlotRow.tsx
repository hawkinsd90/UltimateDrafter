import { posColor } from '../../utils/positionColors';
import type { RosterSlot } from '../../utils/rosterSlots';
import type { RosterPlayer } from '../../hooks/league/useRosterData';

const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';

export function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ padding: '8px 16px 2px', borderBottom: `1px solid ${border}`, background: 'rgba(255,255,255,0.02)' }}>
      <span style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
    </div>
  );
}

interface PlayerSlotRowProps {
  slot:              RosterSlot;
  player:            RosterPlayer | null;
  isLast:            boolean;
  canMoveUp:         boolean;
  canMoveDown:       boolean;
  onMoveUp:          () => void;
  onMoveDown:        () => void;
  onPlayerClick?:    () => void;
  canDropUnresolved?: boolean;
  onDropUnresolved?:  () => void;
}

export function PlayerSlotRow({
  slot, player, isLast,
  canMoveUp, canMoveDown, onMoveUp, onMoveDown, onPlayerClick,
  canDropUnresolved, onDropUnresolved,
}: PlayerSlotRowProps) {
  const col      = posColor(slot.label);
  const clickable = !!player && !player.unresolved && !!onPlayerClick;
  return (
    <div
      onClick={() => clickable && onPlayerClick!()}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '9px 16px',
        borderBottom: isLast ? 'none' : `1px solid ${border}`,
        cursor: clickable ? 'pointer' : 'default',
        transition: clickable ? 'background 0.1s' : 'none',
      }}
      onMouseEnter={e => { if (clickable) (e.currentTarget as HTMLDivElement).style.background = 'rgba(59,130,246,0.06)'; }}
      onMouseLeave={e => { if (clickable) (e.currentTarget as HTMLDivElement).style.background = ''; }}
    >
      <span style={{
        minWidth: '38px', padding: '2px 5px', borderRadius: '4px',
        fontSize: '10px', fontWeight: '700', textAlign: 'center',
        background: col.bg, color: col.text, flexShrink: 0,
      }}>
        {slot.label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {player ? (
          <>
            <div style={{
              fontWeight: '600', fontSize: '14px',
              color: player.unresolved ? textSecondary : textPrimary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {player.displayName}
              {player.unresolved && (
                <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: '#292524', color: '#a8a29e' }}>
                  Unresolved
                </span>
              )}
            </div>
            {(player.teamAbbr || player.fantasyPosition) && (
              <div style={{ fontSize: '11px', color: textSecondary, marginTop: '1px' }}>
                {[player.fantasyPosition, player.teamAbbr].filter(Boolean).join(' · ')}
              </div>
            )}
          </>
        ) : (
          <span style={{ fontSize: '13px', color: textSecondary, fontStyle: 'italic' }}>— Empty —</span>
        )}
      </div>
      {player && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {player.unresolved && canDropUnresolved && onDropUnresolved && (
            <button
              onClick={e => { e.stopPropagation(); onDropUnresolved(); }}
              title="Drop player"
              style={{
                padding: '2px 8px', fontSize: '11px', fontWeight: '700',
                background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.4)', borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Drop
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <ArrowBtn enabled={canMoveUp}   dir="up"   onClick={e => { e.stopPropagation(); onMoveUp(); }} />
            <ArrowBtn enabled={canMoveDown} dir="down" onClick={e => { e.stopPropagation(); onMoveDown(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function ArrowBtn({ enabled, dir, onClick }: { enabled: boolean; dir: 'up' | 'down'; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={dir === 'up' ? 'Move up' : 'Move down'}
      style={{
        width: '22px', height: '20px', padding: 0,
        background: enabled ? 'rgba(59,130,246,0.15)' : 'transparent',
        border: `1px solid ${enabled ? '#3b82f6' : '#334155'}`,
        borderRadius: '3px', cursor: enabled ? 'pointer' : 'default',
        color: enabled ? '#60a5fa' : '#475569',
        fontSize: '10px', lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {dir === 'up' ? '▲' : '▼'}
    </button>
  );
}

interface EmptyRosterShellProps {
  starterSlots: RosterSlot[];
  benchSlots:   RosterSlot[];
}

export function EmptyRosterShell({ starterSlots, benchSlots }: EmptyRosterShellProps) {
  return (
    <>
      <div style={{ padding: '10px 16px', background: '#172033', borderBottom: `1px solid ${border}`, fontSize: '12px', color: '#93c5fd' }}>
        No roster players have been imported for this team yet. The league commissioner can import rosters from the Settings tab &rarr; Import External League Roster.
      </div>
      <div style={{ padding: '8px 16px 2px', borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Starters</span>
      </div>
      {starterSlots.map((slot, i) => {
        const col = posColor(slot.label);
        return (
          <div key={`es-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 16px', borderBottom: `1px solid ${border}`, opacity: 0.55 }}>
            <span style={{ minWidth: '38px', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', textAlign: 'center', background: col.bg, color: col.text, flexShrink: 0 }}>{slot.label}</span>
            <span style={{ fontSize: '13px', color: textSecondary, fontStyle: 'italic' }}>— Empty —</span>
          </div>
        );
      })}
      {benchSlots.length > 0 && (
        <>
          <div style={{ padding: '8px 16px 2px', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bench</span>
          </div>
          {benchSlots.map((slot, i) => {
            const col = posColor(slot.label);
            return (
              <div key={`eb-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 16px', borderBottom: i < benchSlots.length - 1 ? `1px solid ${border}` : 'none', opacity: 0.45 }}>
                <span style={{ minWidth: '38px', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', textAlign: 'center', background: col.bg, color: col.text, flexShrink: 0 }}>{slot.label}</span>
                <span style={{ fontSize: '13px', color: textSecondary, fontStyle: 'italic' }}>— Empty —</span>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
