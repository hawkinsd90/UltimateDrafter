import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';

type Player = Database['public']['Tables']['players']['Row'];

interface PlayerSearchProps {
  draftId: string;
  onSelectPlayer: (playerId: string) => void;
  onClose: () => void;
}

export default function PlayerSearch({ draftId, onSelectPlayer, onClose }: PlayerSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [pickedPlayerIds, setPickedPlayerIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPickedPlayers();
  }, [draftId]);

  useEffect(() => {
    if (searchTerm.length >= 2) {
      searchPlayers();
    } else {
      setPlayers([]);
    }
  }, [searchTerm]);

  async function loadPickedPlayers() {
    const { data } = await supabase
      .from('draft_picks')
      .select('player_id')
      .eq('draft_id', draftId)
      .not('player_id', 'is', null);

    if (data) {
      setPickedPlayerIds(new Set(data.map(p => p.player_id!)));
    }
  }

  async function searchPlayers() {
    setLoading(true);
    const { data } = await supabase
      .from('players')
      .select('*')
      .ilike('name', `%${searchTerm}%`)
      .order('name')
      .limit(20);

    if (data) {
      setPlayers(data);
    }
    setLoading(false);
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '30px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>Select Player</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6b7280'
            }}
          >
            ×
          </button>
        </div>

        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search players..."
          autoFocus
          style={{
            width: '100%',
            padding: '12px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '16px',
            marginBottom: '20px'
          }}
        />

        {loading && <p style={{ color: '#6b7280' }}>Searching...</p>}

        {searchTerm.length < 2 && (
          <p style={{ color: '#6b7280' }}>Type at least 2 characters to search</p>
        )}

        {players.length === 0 && searchTerm.length >= 2 && !loading && (
          <p style={{ color: '#6b7280' }}>No players found</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {players.map(player => {
            const isAlreadyPicked = pickedPlayerIds.has(player.id);
            return (
              <button
                key={player.id}
                onClick={() => !isAlreadyPicked && onSelectPlayer(player.id)}
                disabled={isAlreadyPicked}
                style={{
                  padding: '15px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  background: isAlreadyPicked ? '#f3f4f6' : 'white',
                  cursor: isAlreadyPicked ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  opacity: isAlreadyPicked ? 0.5 : 1
                }}
              >
                <div style={{ fontWeight: '600', marginBottom: '5px' }}>
                  {player.name} {isAlreadyPicked && '(Picked)'}
                </div>
                <div style={{ color: '#6b7280', fontSize: '14px' }}>
                  {player.position} - {player.team || 'Free Agent'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
