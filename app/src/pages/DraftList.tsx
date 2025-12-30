import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';

type Draft = Database['public']['Tables']['drafts']['Row'];
type League = Database['public']['Tables']['leagues']['Row'];

export default function DraftList() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [league, setLeague] = useState<League | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (leagueId) {
      loadData();
    }
  }, [leagueId]);

  async function loadData() {
    const [leagueRes, draftsRes] = await Promise.all([
      supabase.from('leagues').select('*').eq('id', leagueId!).single(),
      supabase.from('drafts').select('*').eq('league_id', leagueId!).order('created_at', { ascending: false })
    ]);

    if (leagueRes.data) setLeague(leagueRes.data);
    if (draftsRes.data) setDrafts(draftsRes.data);
    setLoading(false);
  }

  if (loading) return <div style={{ padding: '40px' }}>Loading...</div>;
  if (!league) return <div style={{ padding: '40px' }}>League not found</div>;

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
      </div>

      <h1>{league.name}</h1>
      <p style={{ color: '#6b7280', marginBottom: '30px' }}>
        {league.sport} - {league.season}
      </p>

      <Link
        to={`/leagues/${leagueId}/drafts/create`}
        style={{ display: 'inline-block', padding: '10px 20px', background: '#059669', color: 'white', textDecoration: 'none', borderRadius: '6px', marginBottom: '20px' }}
      >
        Create New Draft
      </Link>

      <h2>Drafts</h2>

      {drafts.length === 0 ? (
        <div style={{
          padding: '40px',
          background: '#f9fafb',
          border: '2px dashed #d1d5db',
          borderRadius: '8px',
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#374151' }}>No Drafts Yet</h3>
          <p style={{ margin: '0 0 20px 0', color: '#6b7280' }}>
            Create a draft to start selecting players for your fantasy team.
          </p>
          <Link
            to={`/leagues/${leagueId}/drafts/create`}
            style={{
              display: 'inline-block',
              padding: '12px 24px',
              background: '#059669',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '6px',
              fontWeight: '500'
            }}
          >
            Create Your First Draft
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {drafts.map(draft => (
            <div key={draft.id} style={{ padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 10px 0' }}>{draft.name}</h3>
              <p style={{ margin: '0 0 10px 0', color: '#6b7280' }}>
                Status: <span style={{ textTransform: 'capitalize' }}>{draft.status}</span> | Type: {draft.draft_type}
              </p>
              {draft.status === 'setup' ? (
                <Link to={`/leagues/${leagueId}/drafts/${draft.id}/participants`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                  Setup Participants →
                </Link>
              ) : (
                <Link to={`/leagues/${leagueId}/drafts/${draft.id}/board`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                  View Draft Board →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
