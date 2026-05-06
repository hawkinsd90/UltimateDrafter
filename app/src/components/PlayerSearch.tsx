import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

type DraftPoolPlayer = {
  id: string;
  display_name: string;
  fantasy_position: string | null;
  position: string | null;
  status: string | null;
  injury_status: string | null;
  team_abbr: string | null;
  team_name: string | null;
  years_exp: number | null;
};

// Three distinct unavailability reasons — ordered by priority for display
type UnavailableReason = 'picked' | 'keeper' | 'excluded';

interface PlayerSearchProps {
  draftId: string;
  onSelectPlayer: (playerId: string) => void;
  onClose: () => void;
}

const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;
type PositionFilter = typeof POSITIONS[number];

const INJURY_COLORS: Record<string, string> = {
  'Questionable': '#d97706',
  'Doubtful':     '#dc2626',
  'Out':          '#dc2626',
  'IR':           '#7c3aed',
};

const UNAVAILABLE_LABEL: Record<UnavailableReason, string> = {
  picked:   'Picked',
  keeper:   'Keeper',
  excluded: 'Unavailable',
};

export default function PlayerSearch({ draftId, onSelectPlayer, onClose }: PlayerSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('All');
  const [players, setPlayers] = useState<DraftPoolPlayer[]>([]);

  // Three separate sets — loaded once on mount, refreshed whenever the modal opens
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [keeperIds, setKeeperIds] = useState<Set<string>>(new Set());
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadUnavailableSets();
  }, [draftId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchPlayers();
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchTerm, positionFilter]);

  async function loadUnavailableSets() {
    const [picksRes, keepersRes, exclusionsRes] = await Promise.all([
      supabase
        .from('draft_picks')
        .select('player_id')
        .eq('draft_id', draftId)
        .not('player_id', 'is', null),
      supabase
        .from('draft_keeper_assignments')
        .select('sports_player_id')
        .eq('draft_id', draftId),
      supabase
        .from('draft_player_exclusions')
        .select('sports_player_id')
        .eq('draft_id', draftId),
    ]);

    setPickedIds(new Set((picksRes.data ?? []).map(p => p.player_id as string)));
    setKeeperIds(new Set((keepersRes.data ?? []).map(k => k.sports_player_id as string)));
    setExcludedIds(new Set((exclusionsRes.data ?? []).map(e => e.sports_player_id as string)));
  }

  async function searchPlayers() {
    setLoading(true);

    let query = supabase
      .from('nfl_draft_player_pool')
      .select('id, display_name, fantasy_position, position, status, injury_status, team_abbr, team_name, years_exp')
      .order('display_name')
      .limit(50);

    if (positionFilter !== 'All') {
      query = query.eq('fantasy_position', positionFilter);
    }

    if (searchTerm.length >= 2) {
      query = query.ilike('display_name', `%${searchTerm}%`);
    } else if (searchTerm.length > 0) {
      setPlayers([]);
      setLoading(false);
      return;
    }

    const { data } = await query;
    setPlayers((data as DraftPoolPlayer[]) ?? []);
    setLoading(false);
  }

  // Returns the highest-priority unavailability reason for a player, or null if available.
  function getUnavailableReason(playerId: string): UnavailableReason | null {
    if (pickedIds.has(playerId)) return 'picked';
    if (keeperIds.has(playerId)) return 'keeper';
    if (excludedIds.has(playerId)) return 'excluded';
    return null;
  }

  const showResults = searchTerm.length >= 2 || positionFilter !== 'All';

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white', borderRadius: '10px', padding: '24px',
          maxWidth: '640px', width: '94%', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>Select Player</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#94a3b8', lineHeight: 1, padding: '4px' }}
          >
            ×
          </button>
        </div>

        {/* Search input */}
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by name…"
          autoFocus
          style={{
            width: '100%', padding: '10px 14px',
            border: '1px solid #cbd5e1', borderRadius: '7px',
            fontSize: '15px', color: '#0f172a', boxSizing: 'border-box',
            marginBottom: '12px', outline: 'none',
          }}
        />

        {/* Position filter tabs */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {POSITIONS.map(pos => (
            <button
              key={pos}
              onClick={() => setPositionFilter(pos)}
              style={{
                padding: '5px 13px',
                borderRadius: '20px',
                border: positionFilter === pos ? 'none' : '1px solid #e2e8f0',
                background: positionFilter === pos ? '#2563eb' : 'white',
                color: positionFilter === pos ? 'white' : '#475569',
                fontSize: '13px', fontWeight: '600', cursor: 'pointer',
              }}
            >
              {pos}
            </button>
          ))}
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && (
            <p style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Searching…</p>
          )}

          {!loading && !showResults && (
            <p style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
              Type at least 2 characters or select a position to browse.
            </p>
          )}

          {!loading && showResults && players.length === 0 && (
            <p style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>No players found.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {players.map(player => {
              const unavailableReason = getUnavailableReason(player.id);
              const isUnavailable = unavailableReason !== null;
              const injuryLabel = player.injury_status;
              const injuryColor = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;

              return (
                <button
                  key={player.id}
                  onClick={() => !isUnavailable && onSelectPlayer(player.id)}
                  disabled={isUnavailable}
                  style={{
                    padding: '11px 14px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '7px',
                    background: isUnavailable ? '#f8fafc' : 'white',
                    cursor: isUnavailable ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    opacity: isUnavailable ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', gap: '12px',
                  }}
                >
                  {/* Position avatar */}
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: positionBadgeBg(player.fantasy_position), flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: positionBadgeColor(player.fantasy_position) }}>
                    {player.fantasy_position ?? player.position ?? '?'}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '600', fontSize: '14px', color: '#0f172a' }}>
                        {player.display_name}
                      </span>
                      {unavailableReason && (
                        <span style={{
                          fontSize: '11px', fontWeight: '700', padding: '1px 7px', borderRadius: '4px',
                          ...unavailableBadgeStyle(unavailableReason),
                        }}>
                          {UNAVAILABLE_LABEL[unavailableReason]}
                        </span>
                      )}
                      {injuryLabel && injuryColor && !unavailableReason && (
                        <span style={{ fontSize: '11px', fontWeight: '600', color: injuryColor }}>
                          {injuryLabel}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      {player.team_abbr
                        ? `${player.team_abbr} · ${player.fantasy_position ?? player.position ?? '—'}`
                        : (player.fantasy_position ?? player.position ?? '—')
                      }
                    </div>
                  </div>

                  {/* Position badge */}
                  <span style={{
                    padding: '3px 9px', borderRadius: '5px', fontSize: '12px', fontWeight: '700',
                    background: positionBadgeBg(player.fantasy_position),
                    color: positionBadgeColor(player.fantasy_position),
                    flexShrink: 0,
                  }}>
                    {player.fantasy_position ?? player.position ?? '—'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function unavailableBadgeStyle(reason: UnavailableReason): React.CSSProperties {
  switch (reason) {
    case 'picked':   return { background: '#dbeafe', color: '#1e40af' };
    case 'keeper':   return { background: '#dcfce7', color: '#166534' };
    case 'excluded': return { background: '#fef2f2', color: '#991b1b' };
  }
}

function positionBadgeBg(pos: string | null): string {
  switch (pos) {
    case 'QB':  return '#dbeafe';
    case 'RB':  return '#dcfce7';
    case 'WR':  return '#fef9c3';
    case 'TE':  return '#ffedd5';
    case 'K':   return '#f3e8ff';
    case 'DST': return '#fee2e2';
    default:    return '#f1f5f9';
  }
}

function positionBadgeColor(pos: string | null): string {
  switch (pos) {
    case 'QB':  return '#1d4ed8';
    case 'RB':  return '#166534';
    case 'WR':  return '#854d0e';
    case 'TE':  return '#9a3412';
    case 'K':   return '#6b21a8';
    case 'DST': return '#991b1b';
    default:    return '#475569';
  }
}
