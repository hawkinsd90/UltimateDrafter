import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

// ── Types ─────────────────────────────────────────────────────────────────────

type PlayerPoolPolicy = 'available' | 'unavailable';
type MappingAction = 'map' | 'ignore_available' | 'ignore_unavailable';

interface ImportedTeam {
  id: string;
  externalTeamId: string;
  externalTeamName: string;
  externalOwnerName: string | null;
  rosterCount: number;
  currentMappingStatus: string;
  currentParticipantId: string | null;
  currentPolicy: PlayerPoolPolicy;
}

interface Participant {
  id: string;
  teamName: string;
  userId: string | null;
}

interface TeamDecision {
  action: MappingAction;
  participantId: string; // only used when action === 'map'
}

interface SaveSummary {
  mappedCount: number;
  ignoredAvailableCount: number;
  ignoredUnavailableCount: number;
  excludedPlayerCount: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TeamMapping() {
  const { draftId } = useParams<{ draftId: string }>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [draftName, setDraftName] = useState('');
  const [linkId, setLinkId] = useState('');
  const [isOwner, setIsOwner] = useState(false);

  const [importedTeams, setImportedTeams] = useState<ImportedTeam[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [decisions, setDecisions] = useState<Record<string, TeamDecision>>({});

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSummary, setSaveSummary] = useState<SaveSummary | null>(null);

  useEffect(() => {
    if (draftId) loadData();
  }, [draftId]);

  async function loadData() {
    setLoading(true);
    setLoadError('');

    // Load draft + league owner check
    const { data: draft } = await supabase
      .from('drafts')
      .select('id, name, status, league_id')
      .eq('id', draftId!)
      .maybeSingle();

    if (!draft) { setLoadError('Draft not found.'); setLoading(false); return; }
    setDraftName(draft.name);

    const { data: league } = await supabase
      .from('leagues')
      .select('owner_id')
      .eq('id', draft.league_id)
      .maybeSingle();

    setIsOwner(league?.owner_id === user?.id);

    // Load import link
    const { data: link } = await supabase
      .from('external_league_links')
      .select('id, import_status, display_name')
      .eq('draft_id', draftId!)
      .maybeSingle();

    if (!link) { setLoadError('No import found for this draft. Go back and run the import first.'); setLoading(false); return; }
    setLinkId(link.id);

    // Load imported teams
    const { data: teams } = await supabase
      .from('external_league_teams')
      .select('id, external_team_id, external_team_name, external_owner_name, mapping_status, draft_participant_id, player_pool_policy')
      .eq('link_id', link.id)
      .order('external_team_name', { ascending: true });

    // Load roster counts per team
    const { data: rosterRows } = await supabase
      .from('external_roster_players')
      .select('external_team_id')
      .eq('link_id', link.id);

    const rosterCountMap: Record<string, number> = {};
    for (const r of rosterRows ?? []) {
      rosterCountMap[r.external_team_id] = (rosterCountMap[r.external_team_id] ?? 0) + 1;
    }

    const teamsNorm: ImportedTeam[] = (teams ?? []).map(t => ({
      id: t.id,
      externalTeamId: t.external_team_id,
      externalTeamName: t.external_team_name,
      externalOwnerName: t.external_owner_name,
      rosterCount: rosterCountMap[t.external_team_id] ?? 0,
      currentMappingStatus: t.mapping_status,
      currentParticipantId: t.draft_participant_id,
      currentPolicy: (t.player_pool_policy ?? 'available') as PlayerPoolPolicy,
    }));
    setImportedTeams(teamsNorm);

    // Load draft participants
    const { data: parts } = await supabase
      .from('draft_participants')
      .select('id, team_name, user_id')
      .eq('draft_id', draftId!)
      .order('draft_position', { ascending: true });

    setParticipants((parts ?? []).map(p => ({
      id: p.id,
      teamName: p.team_name,
      userId: p.user_id,
    })));

    // Initialise decisions from existing saved state
    const initial: Record<string, TeamDecision> = {};
    for (const t of teamsNorm) {
      if (t.currentMappingStatus === 'mapped' && t.currentParticipantId) {
        initial[t.id] = { action: 'map', participantId: t.currentParticipantId };
      } else if (t.currentMappingStatus === 'ignored') {
        initial[t.id] = {
          action: t.currentPolicy === 'unavailable' ? 'ignore_unavailable' : 'ignore_available',
          participantId: '',
        };
      } else {
        initial[t.id] = { action: 'ignore_available', participantId: '' };
      }
    }
    setDecisions(initial);

    setLoading(false);
  }

  function setDecision(teamId: string, action: MappingAction) {
    setDecisions(prev => ({
      ...prev,
      [teamId]: { action, participantId: action === 'map' ? prev[teamId]?.participantId ?? '' : '' },
    }));
  }

  function setParticipantForTeam(teamId: string, participantId: string) {
    setDecisions(prev => ({
      ...prev,
      [teamId]: { ...prev[teamId], participantId },
    }));
  }

  function validate(): string | null {
    for (const team of importedTeams) {
      const d = decisions[team.id];
      if (!d) return `No decision set for team "${team.externalTeamName}".`;
      if (d.action === 'map' && !d.participantId) {
        return `Select a participant for "${team.externalTeamName}" or choose an ignore option.`;
      }
    }
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) { setSaveError(err); return; }
    if (!isOwner) { setSaveError('Only the league owner can save team mappings.'); return; }

    setSaving(true);
    setSaveError('');

    let mappedCount = 0;
    let ignoredAvailableCount = 0;
    let ignoredUnavailableCount = 0;

    // Process each team
    for (const team of importedTeams) {
      const d = decisions[team.id];

      if (d.action === 'map') {
        const { error } = await supabase
          .from('external_league_teams')
          .update({
            mapping_status: 'mapped',
            draft_participant_id: d.participantId,
            player_pool_policy: 'available',
            mapped_at: new Date().toISOString(),
          })
          .eq('id', team.id);

        if (error) { setSaveError('Failed to save mapping for ' + team.externalTeamName + ': ' + error.message); setSaving(false); return; }

        // Remove any existing exclusions for this team (in case it was previously ignored/unavailable)
        await supabase
          .from('draft_player_exclusions')
          .delete()
          .eq('draft_id', draftId!)
          .eq('external_league_team_id', team.id);

        mappedCount++;

      } else {
        const policy: PlayerPoolPolicy = d.action === 'ignore_unavailable' ? 'unavailable' : 'available';

        const { error } = await supabase
          .from('external_league_teams')
          .update({
            mapping_status: 'ignored',
            draft_participant_id: null,
            player_pool_policy: policy,
            mapped_at: new Date().toISOString(),
          })
          .eq('id', team.id);

        if (error) { setSaveError('Failed to save ignore decision for ' + team.externalTeamName + ': ' + error.message); setSaving(false); return; }

        // Always clear old exclusions for this team first
        await supabase
          .from('draft_player_exclusions')
          .delete()
          .eq('draft_id', draftId!)
          .eq('external_league_team_id', team.id);

        if (policy === 'unavailable') {
          // Fetch resolved roster players for this team and insert exclusions
          const { data: rosterPlayers } = await supabase
            .from('external_roster_players')
            .select('id, sports_player_id')
            .eq('link_id', linkId)
            .eq('external_team_id', team.externalTeamId)
            .not('sports_player_id', 'is', null);

          const exclusionRows = (rosterPlayers ?? []).map(rp => ({
            draft_id: draftId!,
            sports_player_id: rp.sports_player_id as string,
            source: 'external_ignored_team' as const,
            external_league_team_id: team.id,
            external_roster_player_id: rp.id,
            reason: `Ignored team: ${team.externalTeamName}`,
            created_by: user?.id ?? null,
          }));

          if (exclusionRows.length > 0) {
            const { error: exErr } = await supabase
              .from('draft_player_exclusions')
              .upsert(exclusionRows, { onConflict: 'draft_id,sports_player_id', ignoreDuplicates: false });

            if (exErr) {
              setSaveError('Failed to create player exclusions for ' + team.externalTeamName + ': ' + exErr.message);
              setSaving(false);
              return;
            }
          }
          ignoredUnavailableCount++;
        } else {
          ignoredAvailableCount++;
        }
      }
    }

    // Count total exclusions saved
    const { count: excludedCount } = await supabase
      .from('draft_player_exclusions')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId!);

    // Mark import link as mapped
    await supabase
      .from('external_league_links')
      .update({ import_status: 'mapped' })
      .eq('id', linkId);

    setSaveSummary({
      mappedCount,
      ignoredAvailableCount,
      ignoredUnavailableCount,
      excludedPlayerCount: excludedCount ?? 0,
    });
    setSaving(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div style={s.page}><p style={{ color: '#9ca3af' }}>Loading...</p></div>;

  if (loadError) {
    return (
      <div style={s.page}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <Link to={`/drafts/${draftId}/import`} style={s.linkBlue}>← Back to Import</Link>
          <UserMenu />
        </div>
        <div style={s.errorBox}>{loadError}</div>
      </div>
    );
  }

  if (saveSummary) {
    return (
      <div style={s.page}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <Link to={`/drafts/${draftId}/participants`} style={s.linkBlue}>← Back to Participants</Link>
          <UserMenu />
        </div>
        <h1 style={s.heading}>Team Mapping Saved</h1>
        <p style={{ color: '#6b7280', fontSize: '15px', margin: '0 0 24px 0' }}>{draftName}</p>

        <div style={s.card}>
          <SummaryRow label="Teams mapped to participants" value={String(saveSummary.mappedCount)} />
          <SummaryRow label="Teams ignored (players available)" value={String(saveSummary.ignoredAvailableCount)} />
          <SummaryRow label="Teams ignored (players unavailable)" value={String(saveSummary.ignoredUnavailableCount)} />
          <SummaryRow label="Players excluded from draft pool" value={String(saveSummary.excludedPlayerCount)} highlight={saveSummary.excludedPlayerCount > 0} />
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <Link to={`/drafts/${draftId}/participants`} style={s.btnSecondary}>
            Back to Participants
          </Link>
          <span style={s.btnDisabled} title="Keeper selection coming soon">
            Next: Select Keepers (coming soon)
          </span>
        </div>
      </div>
    );
  }

  // Compute which participants are already mapped (to disable in other dropdowns)
  const mappedParticipantIds = new Set(
    importedTeams
      .filter(t => decisions[t.id]?.action === 'map' && decisions[t.id]?.participantId)
      .map(t => decisions[t.id].participantId)
  );

  const allDecided = importedTeams.every(t => {
    const d = decisions[t.id];
    if (!d) return false;
    if (d.action === 'map') return !!d.participantId;
    return true;
  });

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Link to={`/drafts/${draftId}/import`} style={s.linkBlue}>← Back to Import</Link>
        <UserMenu />
      </div>

      <h1 style={s.heading}>Map Imported Teams</h1>
      <p style={{ color: '#6b7280', fontSize: '15px', margin: '0 0 6px 0' }}>{draftName}</p>
      <p style={{ color: '#9ca3af', fontSize: '13px', margin: '0 0 28px 0' }}>
        For each imported team, choose a draft participant to map it to, or decide how to handle its players.
      </p>

      {!isOwner && (
        <div style={{ ...s.errorBox, marginBottom: '20px' }}>
          Only the league owner can edit team mappings.
        </div>
      )}

      {saveError && (
        <div style={{ ...s.errorBox, marginBottom: '20px' }}>{saveError}</div>
      )}

      {participants.length === 0 && (
        <div style={{ padding: '16px 18px', background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: '8px', color: '#92400e', fontSize: '14px', marginBottom: '24px' }}>
          <div style={{ fontWeight: '700', marginBottom: '6px', fontSize: '15px' }}>No draft participants found</div>
          <div style={{ marginBottom: '12px' }}>
            You need to add participants to this draft before you can map imported teams to them.
            You can still set ignore options below and come back to map teams after adding participants.
          </div>
          <Link
            to={`/drafts/${draftId}/participants`}
            style={{ display: 'inline-block', padding: '8px 16px', background: '#d97706', color: '#fff', borderRadius: '6px', fontWeight: '700', fontSize: '14px', textDecoration: 'none' }}
          >
            Add Participants Now
          </Link>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
        {importedTeams.map(team => {
          const d = decisions[team.id] ?? { action: 'ignore_available' as MappingAction, participantId: '' };
          return (
            <div key={team.id} style={s.teamCard}>
              {/* Team info */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: '700', fontSize: '15px', color: '#111827' }}>
                  {team.externalTeamName}
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                  {team.externalOwnerName ? `Owner: ${team.externalOwnerName} · ` : ''}
                  {team.rosterCount} rostered player{team.rosterCount !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Action selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <ActionOption
                  teamId={team.id}
                  value="map"
                  current={d.action}
                  label="Map to participant"
                  description={participants.length === 0 ? 'No participants added yet — add participants first.' : undefined}
                  onChange={setDecision}
                  disabled={!isOwner || participants.length === 0}
                />
                {d.action === 'map' && participants.length === 0 && (
                  <div style={{ marginLeft: '28px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '13px', color: '#92400e' }}>
                    No draft participants exist for this draft yet.{' '}
                    <Link to={`/drafts/${draftId}/participants`} style={{ color: '#92400e', fontWeight: '700', textDecoration: 'underline' }}>
                      Add participants
                    </Link>
                    {' '}then come back to map teams.
                  </div>
                )}
                {d.action === 'map' && participants.length > 0 && (
                  <select
                    value={d.participantId}
                    onChange={e => setParticipantForTeam(team.id, e.target.value)}
                    disabled={!isOwner}
                    style={{ ...s.select, marginLeft: '28px', maxWidth: '280px' }}
                  >
                    <option value="">— Select participant —</option>
                    {participants.map(p => (
                      <option
                        key={p.id}
                        value={p.id}
                        disabled={mappedParticipantIds.has(p.id) && d.participantId !== p.id}
                      >
                        {p.teamName}{mappedParticipantIds.has(p.id) && d.participantId !== p.id ? ' (taken)' : ''}
                      </option>
                    ))}
                  </select>
                )}

                <ActionOption
                  teamId={team.id}
                  value="ignore_available"
                  current={d.action}
                  label="Ignore — return players to draft pool"
                  description="Players from this team can be drafted by anyone."
                  onChange={setDecision}
                  disabled={!isOwner}
                />

                <ActionOption
                  teamId={team.id}
                  value="ignore_unavailable"
                  current={d.action}
                  label="Ignore — keep players unavailable"
                  description={`${team.rosterCount} player${team.rosterCount !== 1 ? 's' : ''} will be blocked from the draft pool.`}
                  onChange={setDecision}
                  disabled={!isOwner}
                />
              </div>
            </div>
          );
        })}
      </div>

      {isOwner && (
        <button
          onClick={handleSave}
          disabled={saving || !allDecided}
          title={!allDecided ? 'Resolve all teams before saving' : undefined}
          style={saving || !allDecided ? s.btnDisabled : s.btnPrimary}
        >
          {saving ? 'Saving...' : 'Save Team Mapping'}
        </button>
      )}
      {!allDecided && isOwner && (
        <p style={{ textAlign: 'center', marginTop: '10px', color: '#9ca3af', fontSize: '13px' }}>
          All teams must have a decision before saving.
        </p>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActionOption({
  teamId, value, current, label, description, onChange, disabled,
}: {
  teamId: string;
  value: MappingAction;
  current: MappingAction;
  label: string;
  description?: string;
  onChange: (teamId: string, action: MappingAction) => void;
  disabled: boolean;
}) {
  const selected = current === value;
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="radio"
        name={`action-${teamId}`}
        value={value}
        checked={selected}
        onChange={() => onChange(teamId, value)}
        disabled={disabled}
        style={{ marginTop: '3px', accentColor: '#2563eb', flexShrink: 0 }}
      />
      <span>
        <span style={{ fontSize: '14px', color: '#111827', fontWeight: selected ? '600' : '400' }}>{label}</span>
        {description && <span style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginTop: '1px' }}>{description}</span>}
      </span>
    </label>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span style={{ fontSize: '14px', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '14px', fontWeight: '600', color: highlight ? '#dc2626' : '#111827' }}>{value}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page: { padding: '32px 24px', fontFamily: 'system-ui, sans-serif', maxWidth: '640px', margin: '0 auto' } as React.CSSProperties,
  heading: { margin: '0 0 8px 0', fontSize: '24px', fontWeight: '700', color: '#111827' } as React.CSSProperties,
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' } as React.CSSProperties,
  teamCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' } as React.CSSProperties,
  select: { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', background: '#fff', boxSizing: 'border-box' as const } as React.CSSProperties,
  errorBox: { padding: '14px 16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#dc2626', fontSize: '14px' } as React.CSSProperties,
  btnPrimary: { width: '100%', padding: '13px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', fontSize: '16px', cursor: 'pointer' } as React.CSSProperties,
  btnSecondary: { display: 'inline-block', padding: '11px 20px', background: '#fff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '8px', fontWeight: '600', fontSize: '15px', textDecoration: 'none' } as React.CSSProperties,
  btnDisabled: { display: 'inline-block', padding: '11px 20px', background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', borderRadius: '8px', fontWeight: '600', fontSize: '15px', cursor: 'not-allowed', textDecoration: 'none' } as React.CSSProperties,
  linkBlue: { color: '#2563eb', textDecoration: 'none', fontSize: '14px' } as React.CSSProperties,
} as const;
