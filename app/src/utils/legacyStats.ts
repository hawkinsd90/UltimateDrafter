// Statistics calculation utilities for League Legacy.
// All functions operate on data fetched via Supabase client queries
// and are scoped to a single league by filtering on league_id.

// ── Types ──────────────────────────────────────────────────────────────────

export interface LegacyManager {
  id: string;
  display_name: string;
  linked_user_id: string | null;
  seasons: number;
  aliases: { provider: string; external_owner_id: string; display_name: string | null }[];
}

export interface LegacySeasonTeam {
  id: string;
  season_year: number;
  external_team_id: string;
  team_name: string;
  team_abbrev: string | null;
  wins: number;
  losses: number;
  ties: number;
  // null = unknown/unavailable (DB NULL). A real value of 0 is valid.
  points_for: number | null;
  points_against: number | null;
  playoff_seed: number | null;
  // Number of teams that qualified for the championship playoff bracket
  // in this season. Derived from ESPN scheduleSettings.playoffTeamCount.
  // null when the setting is unavailable (e.g. imported from a provider
  // that doesn't expose it). When null, playoff_appearances cannot be
  // calculated reliably and is reported as null (unavailable).
  playoff_team_count: number | null;
  final_standing: number | null;
  is_champion: boolean;
  is_runner_up: boolean;
  primary_manager_id: string | null;
  primary_manager_name: string | null;
  co_manager_ids: string[];
  co_manager_names: string[];
  // Whether the season this team belongs to has been imported AND finalized.
  // `import_status === 'complete'` means data ingestion succeeded — it does
  // NOT mean the fantasy season is over. The season is final only when
  // import succeeded AND final_standing is populated. The dashboard sets
  // this flag from import_status + import_completeness metadata; the
  // isSeasonComplete() helper additionally requires final_standing !== null.
  is_season_complete: boolean;
}

export interface LegacyMatchup {
  id: string;
  season_year: number;
  matchup_period: number;
  classification: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  winner: string | null;
  home_team_name: string;
  away_team_name: string | null;
  home_manager_id: string | null;
  away_manager_id: string | null;
  home_manager_name: string | null;
  away_manager_name: string | null;
}

export interface CareerStats {
  manager_id: string;
  display_name: string;
  // Total distinct seasons this manager appears in (complete + incomplete)
  seasons: number;
  // Number of complete seasons contributing to career aggregates
  complete_seasons: number;
  wins: number;
  losses: number;
  ties: number;
  win_pct: number;
  points_for: number;
  points_against: number;
  championships: number;
  championship_appearances: number;
  // null = unavailable (playoffTeamCount not known for one or more seasons)
  playoff_appearances: number | null;
  best_finish: number | null;
  worst_finish: number | null;
  season_records: {
    season_year: number;
    team_name: string;
    wins: number;
    losses: number;
    ties: number;
    // 0 when DB value was null (season finalized but points unavailable)
    points_for: number;
    points_against: number;
    final_standing: number | null;
    is_champion: boolean;
    is_runner_up: boolean;
    playoff_seed: number | null;
    made_playoffs: boolean | null;
    is_season_complete: boolean;
  }[];
}

export interface H2HMatchup {
  season_year: number;
  matchup_period: number;
  classification: string;
  manager_a_score: number;
  manager_b_score: number;
  manager_a_won: boolean;
  is_tie: boolean;
}

export interface H2HStats {
  manager_a_id: string;
  manager_b_id: string;
  total: { wins: number; losses: number; ties: number };
  regular: { wins: number; losses: number; ties: number };
  playoff: { wins: number; losses: number; ties: number };
  points_for: number;
  points_against: number;
  largest_margin: number | null;
  closest_margin: number | null;
  most_recent: H2HMatchup | null;
  matchups: H2HMatchup[];
}

export interface RecordEntry {
  manager_name: string;
  team_name: string;
  season_year: number;
  value: number;
  display_value: string;
}

export interface SingleSeasonRecord {
  manager_name: string;
  team_name: string;
  season_year: number;
  value: number;
  display_value: string;
  wins: number;
  losses: number;
  ties: number;
}

export interface MatchupRecord {
  manager_name: string;
  team_name: string;
  season_year: number;
  matchup_period: number;
  value: number;
  display_value: string;
}

// ── Attribution Rule ───────────────────────────────────────────────────────
// For career stats and H2H, we attribute team results to the PRIMARY manager
// only. Co-managers are listed in the team info but do not receive separate
// career win/loss credit. This prevents double-counting a single matchup
// outcome for both the primary and co-manager.
// Rationale: the primary owner is the team's designated owner in ESPN.
// Co-managers share the team but attributing the full W/L to both would
// inflate aggregate league records. The co-manager's contribution is
// visible in the season-by-season team list on their profile.

// ── Playoff Qualification Rule ─────────────────────────────────────────────
// A team qualified for the championship playoff bracket if and only if:
//   1. playoff_team_count is known (non-null, > 0) for that season, AND
//   2. playoff_seed is non-null AND playoff_seed <= playoff_team_count.
//
// ESPN assigns a playoffSeed to ALL teams (1 through N), not just
// championship-bracket teams. Seeds 1..playoffTeamCount are the
// championship bracket; seeds (playoffTeamCount+1)..N are the
// consolation bracket.
//
// If playoff_team_count is unavailable for any of a manager's seasons,
// playoff_appearances is reported as null (unavailable) rather than
// fabricating a count from seeds alone.

// ── Completed-Matchup Predicate ─────────────────────────────────────────────
// A matchup is "completed" for statistical purposes when:
//   - It is NOT a bye (byes have no away team).
//   - Both home_score and away_score are non-null numbers.
//     (A score of 0 is valid and must be counted.)
//   - winner is non-null and not 'UNDECIDED'.
//
// This predicate is used by calculateH2H, calculateRivals, and
// calculateMatchupRecords. It ensures:
//   - Zero-point games are counted.
//   - 0-0 ties are counted.
//   - Null/missing scores are excluded.
//   - Undecided matchups are excluded.
//   - Byes are excluded.

function isCompletedMatchup(m: LegacyMatchup): boolean {
  return (
    m.classification !== 'bye' &&
    m.away_team_id !== null &&
    m.home_score !== null &&
    m.away_score !== null &&
    m.winner !== null &&
    m.winner !== 'UNDECIDED'
  );
}

// ── Season Finality Rule ───────────────────────────────────────────────────
// A season is "finalized" (complete for career-aggregate purposes) when:
//   1. The season's import_status is 'complete' (data ingestion succeeded), AND
//   2. The team has a non-null final_standing (standings are finalized).
//
// Import completion alone is NOT sufficient: `import_status === 'complete'`
// means the data was fetched successfully, not that the fantasy season is
// over. An ongoing season can be imported mid-way with `import_status` set
// to 'complete' because the import job itself finished — but final_standing
// will be null until the season actually ends.
//
// Career aggregate leaderboards (wins, losses, ties, points, championships,
// championship appearances, playoff appearances, best/worst finish) use ONLY
// finalized seasons. An ongoing season with partial W/L would silently
// distort finalized career totals if included.
//
// Single-game matchup records (highest score, largest margin, etc.) include
// any completed matchup regardless of season finality — an individually
// finalized game is a valid record even if the season isn't over yet.
//
// Season-by-season lists on manager profiles show ALL seasons (finalized and
// ongoing) for visibility, with an "incomplete" indicator.
//
// H2H and Rivals use completed matchups from all seasons — these are
// per-game results, not season-level aggregates.
//
// A manager with multiple teams in the same season (rare but possible via
// historical overrides) is counted once per season for the seasons count,
// but career W/L/T aggregates each team's record independently since each
// team has its own win/loss record.

function isSeasonComplete(team: LegacySeasonTeam): boolean {
  return team.is_season_complete && team.final_standing !== null;
}

// ── Career Statistics ───────────────────────────────────────────────────────

export function calculateCareerStats(
  teams: LegacySeasonTeam[],
  managers: LegacyManager[],
): CareerStats[] {
  const statsMap = new Map<string, CareerStats>();

  for (const mgr of managers) {
    statsMap.set(mgr.id, {
      manager_id: mgr.id,
      display_name: mgr.display_name,
      seasons: 0,
      complete_seasons: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      win_pct: 0,
      points_for: 0,
      points_against: 0,
      championships: 0,
      championship_appearances: 0,
      playoff_appearances: 0,
      best_finish: null,
      worst_finish: null,
      season_records: [],
    });
  }

  // Track distinct seasons per manager (complete + incomplete)
  const distinctSeasons = new Map<string, Set<number>>();

  for (const team of teams) {
    if (!team.primary_manager_id) continue;
    const stats = statsMap.get(team.primary_manager_id);
    if (!stats) continue;

    // Track distinct seasons (a manager could have multiple teams in one season)
    if (!distinctSeasons.has(team.primary_manager_id)) {
      distinctSeasons.set(team.primary_manager_id, new Set());
    }
    distinctSeasons.get(team.primary_manager_id)!.add(team.season_year);

    const complete = isSeasonComplete(team);

    if (complete) {
      stats.complete_seasons++;
      stats.wins += team.wins;
      stats.losses += team.losses;
      stats.ties += team.ties;
      // Preserve null as 0 in career aggregates — a null here means the DB
      // value was missing, but for career sum purposes we treat it as 0
      // since the season is finalized and the W/L are real. The null-vs-zero
      // distinction is preserved in season_records below.
      stats.points_for += team.points_for ?? 0;
      stats.points_against += team.points_against ?? 0;

      if (team.is_champion) stats.championships++;
      if (team.is_champion || team.is_runner_up) stats.championship_appearances++;

      if (team.final_standing !== null) {
        if (stats.best_finish === null || team.final_standing < stats.best_finish) {
          stats.best_finish = team.final_standing;
        }
        if (stats.worst_finish === null || team.final_standing > stats.worst_finish) {
          stats.worst_finish = team.final_standing;
        }
      }
    }

    // Playoff qualification: only meaningful for complete seasons.
    // null = unknown (incomplete season OR missing playoffTeamCount on a complete season)
    const madePlayoffs: boolean | null =
      !complete
        ? null
        : team.playoff_team_count !== null && team.playoff_team_count > 0
          ? team.playoff_seed !== null && team.playoff_seed <= team.playoff_team_count
          : null;

    // Only adjust career playoff_appearances for complete seasons.
    // Incomplete seasons don't count and don't null out the career total.
    if (complete) {
      if (madePlayoffs === true) {
        if (stats.playoff_appearances !== null) {
          stats.playoff_appearances++;
        }
      } else if (madePlayoffs === null) {
        stats.playoff_appearances = null;
      }
    }

    stats.season_records.push({
      season_year: team.season_year,
      team_name: team.team_name,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      points_for: team.points_for ?? 0,
      points_against: team.points_against ?? 0,
      final_standing: team.final_standing,
      is_champion: team.is_champion,
      is_runner_up: team.is_runner_up,
      playoff_seed: team.playoff_seed,
      made_playoffs: madePlayoffs,
      is_season_complete: complete,
    });
  }

  for (const stats of statsMap.values()) {
    stats.seasons = distinctSeasons.get(stats.manager_id)?.size ?? 0;
    const totalGames = stats.wins + stats.losses + stats.ties;
    stats.win_pct = totalGames > 0
      ? (stats.wins + stats.ties * 0.5) / totalGames
      : 0;
  }

  return Array.from(statsMap.values()).filter((s) => s.seasons > 0);
}

// ── Head-to-Head ───────────────────────────────────────────────────────────

export function calculateH2H(
  matchups: LegacyMatchup[],
  managerAId: string,
  managerBId: string,
): H2HStats {
  const result: H2HStats = {
    manager_a_id: managerAId,
    manager_b_id: managerBId,
    total: { wins: 0, losses: 0, ties: 0 },
    regular: { wins: 0, losses: 0, ties: 0 },
    playoff: { wins: 0, losses: 0, ties: 0 },
    points_for: 0,
    points_against: 0,
    largest_margin: null,
    closest_margin: null,
    most_recent: null,
    matchups: [],
  };

  const h2hMatchups: H2HMatchup[] = [];

  for (const m of matchups) {
    if (!isCompletedMatchup(m)) continue;

    // Determine which side is A and which is B
    let aScore: number;
    let bScore: number;

    if (m.home_manager_id === managerAId && m.away_manager_id === managerBId) {
      aScore = Number(m.home_score);
      bScore = Number(m.away_score);
    } else if (m.home_manager_id === managerBId && m.away_manager_id === managerAId) {
      aScore = Number(m.away_score);
      bScore = Number(m.home_score);
    } else {
      continue;
    }

    const isTie = aScore === bScore;
    const aWon = !isTie && aScore > bScore;
    const margin = Math.abs(aScore - bScore);

    const h2h: H2HMatchup = {
      season_year: m.season_year,
      matchup_period: m.matchup_period,
      classification: m.classification,
      manager_a_score: aScore,
      manager_b_score: bScore,
      manager_a_won: aWon,
      is_tie: isTie,
    };
    h2hMatchups.push(h2h);

    result.points_for += aScore;
    result.points_against += bScore;

    if (isTie) {
      result.total.ties++;
      if (m.classification === 'regular') result.regular.ties++;
      else if (m.classification === 'playoff' || m.classification === 'championship') result.playoff.ties++;
    } else if (aWon) {
      result.total.wins++;
      if (m.classification === 'regular') result.regular.wins++;
      else if (m.classification === 'playoff' || m.classification === 'championship') result.playoff.wins++;
    } else {
      result.total.losses++;
      if (m.classification === 'regular') result.regular.losses++;
      else if (m.classification === 'playoff' || m.classification === 'championship') result.playoff.losses++;
    }

    if (result.largest_margin === null || margin > result.largest_margin) {
      result.largest_margin = margin;
    }
    if (result.closest_margin === null || margin < result.closest_margin) {
      result.closest_margin = margin;
    }
  }

  h2hMatchups.sort((a, b) => a.season_year - b.season_year || a.matchup_period - b.matchup_period);
  result.matchups = h2hMatchups;
  result.most_recent = h2hMatchups.length > 0 ? h2hMatchups[h2hMatchups.length - 1] : null;

  return result;
}

// ── Record Book ────────────────────────────────────────────────────────────

export function calculateCareerRecords(
  careers: CareerStats[],
): {
  most_wins: RecordEntry[];
  most_losses: RecordEntry[];
  highest_win_pct: RecordEntry[];
  most_points: RecordEntry[];
  most_championships: RecordEntry[];
  most_champ_appearances: RecordEntry[];
  most_playoff_appearances: RecordEntry[];
} {
  const sorted = [...careers];

  return {
    most_wins: sorted.filter((c) => c.wins > 0).sort((a, b) => b.wins - a.wins).slice(0, 5).map((c) => ({
      manager_name: c.display_name, team_name: '', season_year: 0,
      value: c.wins, display_value: `${c.wins}`,
    })),
    most_losses: sorted.filter((c) => c.losses > 0).sort((a, b) => b.losses - a.losses).slice(0, 5).map((c) => ({
      manager_name: c.display_name, team_name: '', season_year: 0,
      value: c.losses, display_value: `${c.losses}`,
    })),
    highest_win_pct: sorted.filter((c) => (c.wins + c.losses + c.ties) >= 10).sort((a, b) => b.win_pct - a.win_pct).slice(0, 5).map((c) => ({
      manager_name: c.display_name, team_name: '', season_year: 0,
      value: c.win_pct, display_value: `${(c.win_pct * 100).toFixed(1)}%`,
    })),
    most_points: sorted.filter((c) => c.points_for > 0).sort((a, b) => b.points_for - a.points_for).slice(0, 5).map((c) => ({
      manager_name: c.display_name, team_name: '', season_year: 0,
      value: c.points_for, display_value: c.points_for.toFixed(2),
    })),
    most_championships: sorted.filter((c) => c.championships > 0).sort((a, b) => b.championships - a.championships).slice(0, 5).map((c) => ({
      manager_name: c.display_name, team_name: '', season_year: 0,
      value: c.championships, display_value: `${c.championships}`,
    })),
    most_champ_appearances: sorted.filter((c) => c.championship_appearances > 0).sort((a, b) => b.championship_appearances - a.championship_appearances).slice(0, 5).map((c) => ({
      manager_name: c.display_name, team_name: '', season_year: 0,
      value: c.championship_appearances, display_value: `${c.championship_appearances}`,
    })),
    most_playoff_appearances: sorted
      .filter((c) => c.playoff_appearances !== null && c.playoff_appearances > 0)
      .sort((a, b) => (b.playoff_appearances ?? 0) - (a.playoff_appearances ?? 0))
      .slice(0, 5)
      .map((c) => ({
        manager_name: c.display_name, team_name: '', season_year: 0,
        value: c.playoff_appearances!, display_value: `${c.playoff_appearances}`,
      })),
  };
}

export function calculateSingleSeasonRecords(
  teams: LegacySeasonTeam[],
): {
  most_wins: SingleSeasonRecord[];
  fewest_losses: SingleSeasonRecord[];
  most_points: SingleSeasonRecord[];
  best_win_pct: SingleSeasonRecord[];
} {
  // Exclude incomplete seasons (no final_standing) from record-book entries
  const eligible = teams.filter((t) => t.final_standing !== null);
  const totalGames = (t: LegacySeasonTeam) => t.wins + t.losses + t.ties;

  return {
    most_wins: [...eligible].sort((a, b) => b.wins - a.wins).slice(0, 5).map((t) => ({
      manager_name: t.primary_manager_name ?? 'Unknown', team_name: t.team_name,
      season_year: t.season_year, value: t.wins, display_value: `${t.wins}`,
      wins: t.wins, losses: t.losses, ties: t.ties,
    })),
    fewest_losses: [...eligible].filter((t) => totalGames(t) >= 10).sort((a, b) => a.losses - b.losses).slice(0, 5).map((t) => ({
      manager_name: t.primary_manager_name ?? 'Unknown', team_name: t.team_name,
      season_year: t.season_year, value: t.losses, display_value: `${t.losses}`,
      wins: t.wins, losses: t.losses, ties: t.ties,
    })),
    most_points: [...eligible].filter((t) => t.points_for !== null).sort((a, b) => (b.points_for ?? 0) - (a.points_for ?? 0)).slice(0, 5).map((t) => ({
      manager_name: t.primary_manager_name ?? 'Unknown', team_name: t.team_name,
      season_year: t.season_year, value: t.points_for ?? 0, display_value: (t.points_for ?? 0).toFixed(2),
      wins: t.wins, losses: t.losses, ties: t.ties,
    })),
    best_win_pct: [...eligible].filter((t) => totalGames(t) >= 10).map((t) => ({
      t, pct: (t.wins + t.ties * 0.5) / totalGames(t),
    })).sort((a, b) => b.pct - a.pct).slice(0, 5).map(({ t, pct }) => ({
      manager_name: t.primary_manager_name ?? 'Unknown', team_name: t.team_name,
      season_year: t.season_year, value: pct, display_value: `${(pct * 100).toFixed(1)}%`,
      wins: t.wins, losses: t.losses, ties: t.ties,
    })),
  };
}

export function calculateMatchupRecords(
  matchups: LegacyMatchup[],
): {
  highest_score: MatchupRecord[];
  lowest_score: MatchupRecord[];
  largest_margin: MatchupRecord[];
  closest_margin: MatchupRecord[];
  highest_combined: MatchupRecord[];
} {
  const completed = matchups.filter(isCompletedMatchup);

  const allScores: { m: LegacyMatchup; score: number; isHome: boolean; mgr: string; team: string }[] = [];
  for (const m of completed) {
    if (m.home_score !== null) {
      allScores.push({ m, score: Number(m.home_score), isHome: true, mgr: m.home_manager_name ?? 'Unknown', team: m.home_team_name });
    }
    if (m.away_score !== null) {
      allScores.push({ m, score: Number(m.away_score), isHome: false, mgr: m.away_manager_name ?? 'Unknown', team: m.away_team_name ?? '' });
    }
  }

  const margins = completed.map((m) => ({
    m,
    margin: Math.abs(Number(m.home_score) - Number(m.away_score)),
    winnerName: m.winner === 'HOME' ? m.home_manager_name : m.away_manager_name,
    winnerTeam: m.winner === 'HOME' ? m.home_team_name : m.away_team_name,
  }));

  const combined = completed.map((m) => ({
    m,
    total: Number(m.home_score) + Number(m.away_score),
    mgr: m.winner === 'HOME' ? m.home_manager_name : m.away_manager_name,
    team: m.winner === 'HOME' ? m.home_team_name : m.away_team_name,
  }));

  return {
    highest_score: allScores.sort((a, b) => b.score - a.score).slice(0, 5).map((s) => ({
      manager_name: s.mgr, team_name: s.team, season_year: s.m.season_year,
      matchup_period: s.m.matchup_period, value: s.score, display_value: s.score.toFixed(2),
    })),
    lowest_score: allScores.sort((a, b) => a.score - b.score).slice(0, 5).map((s) => ({
      manager_name: s.mgr, team_name: s.team, season_year: s.m.season_year,
      matchup_period: s.m.matchup_period, value: s.score, display_value: s.score.toFixed(2),
    })),
    largest_margin: margins.sort((a, b) => b.margin - a.margin).slice(0, 5).map((r) => ({
      manager_name: r.winnerName ?? 'Unknown', team_name: r.winnerTeam ?? '', season_year: r.m.season_year,
      matchup_period: r.m.matchup_period, value: r.margin, display_value: r.margin.toFixed(2),
    })),
    closest_margin: margins.filter((r) => r.margin > 0).sort((a, b) => a.margin - b.margin).slice(0, 5).map((r) => ({
      manager_name: r.winnerName ?? 'Unknown', team_name: r.winnerTeam ?? '', season_year: r.m.season_year,
      matchup_period: r.m.matchup_period, value: r.margin, display_value: r.margin.toFixed(2),
    })),
    highest_combined: combined.sort((a, b) => b.total - a.total).slice(0, 5).map((c) => ({
      manager_name: c.mgr ?? 'Unknown', team_name: c.team ?? '', season_year: c.m.season_year,
      matchup_period: c.m.matchup_period, value: c.total, display_value: c.total.toFixed(2),
    })),
  };
}

// ── Championship History ───────────────────────────────────────────────────

export interface ChampionshipEntry {
  season_year: number;
  champion_team_name: string;
  champion_manager_name: string;
  champion_manager_id: string | null;
  champion_score: number | null;
  runner_up_team_name: string | null;
  runner_up_manager_name: string | null;
  runner_up_score: number | null;
  has_championship_game: boolean;
}

export function buildChampionshipHistory(
  teams: LegacySeasonTeam[],
  matchups: LegacyMatchup[],
): ChampionshipEntry[] {
  const champions = teams.filter((t) => t.is_champion);
  const runnerUps = teams.filter((t) => t.is_runner_up);

  return champions.map((champ) => {
    const runnerUp = runnerUps.find((ru) => ru.season_year === champ.season_year);

    // Find the championship game: a matchup that contains BOTH the
    // champion and runner-up team IDs. Do not rely on classification
    // alone — verify the participants match the verified champion/runner-up.
    const champGame = matchups.find((m) => {
      if (m.season_year !== champ.season_year) return false;
      if (m.away_team_id === null) return false;
      const participantIds = new Set([m.home_team_id, m.away_team_id]);
      return participantIds.has(champ.id) && participantIds.has(runnerUp?.id ?? '__no_ru__');
    });

    let championScore: number | null = null;
    let runnerUpScore: number | null = null;

    if (champGame && champGame.home_score !== null && champGame.away_score !== null) {
      const champIsHome = champGame.home_team_id === champ.id;
      championScore = champIsHome
        ? Number(champGame.home_score)
        : Number(champGame.away_score);
      runnerUpScore = champIsHome
        ? Number(champGame.away_score)
        : Number(champGame.home_score);

      // Guard against NaN from non-numeric stored values
      if (isNaN(championScore)) championScore = null;
      if (isNaN(runnerUpScore)) runnerUpScore = null;
    }

    return {
      season_year: champ.season_year,
      champion_team_name: champ.team_name,
      champion_manager_name: champ.primary_manager_name ?? 'Unknown',
      champion_manager_id: champ.primary_manager_id,
      champion_score: championScore,
      runner_up_team_name: runnerUp?.team_name ?? null,
      runner_up_manager_name: runnerUp?.primary_manager_name ?? null,
      runner_up_score: runnerUpScore,
      has_championship_game: champGame !== undefined,
    };
  }).sort((a, b) => b.season_year - a.season_year);
}

// ── Rivals (most frequent opponents) ────────────────────────────────────────

export interface RivalInfo {
  manager_id: string;
  manager_name: string;
  matchup_count: number;
  wins: number;
  losses: number;
  ties: number;
}

export function calculateRivals(
  matchups: LegacyMatchup[],
  targetManagerId: string,
  maxRivals: number = 5,
): RivalInfo[] {
  const rivalMap = new Map<string, RivalInfo>();

  for (const m of matchups) {
    if (!isCompletedMatchup(m)) continue;

    let opponentId: string | null = null;
    let targetWon = false;
    let isTie = false;

    const homeScore = Number(m.home_score);
    const awayScore = Number(m.away_score);

    if (m.home_manager_id === targetManagerId && m.away_manager_id) {
      opponentId = m.away_manager_id;
      isTie = homeScore === awayScore;
      targetWon = !isTie && homeScore > awayScore;
    } else if (m.away_manager_id === targetManagerId && m.home_manager_id) {
      opponentId = m.home_manager_id;
      isTie = homeScore === awayScore;
      targetWon = !isTie && awayScore > homeScore;
    } else {
      continue;
    }

    if (!opponentId) continue;

    let rival = rivalMap.get(opponentId);
    if (!rival) {
      const oppName = m.home_manager_id === opponentId ? m.home_manager_name : m.away_manager_name;
      rival = {
        manager_id: opponentId,
        manager_name: oppName ?? 'Unknown',
        matchup_count: 0, wins: 0, losses: 0, ties: 0,
      };
      rivalMap.set(opponentId, rival);
    }

    rival.matchup_count++;
    if (isTie) rival.ties++;
    else if (targetWon) rival.wins++;
    else rival.losses++;
  }

  return Array.from(rivalMap.values())
    .sort((a, b) => b.matchup_count - a.matchup_count || b.wins - a.wins)
    .slice(0, maxRivals);
}
