// Focused tests for legacy statistics utilities.
// Run with: npx tsx app/src/utils/legacyStats.test.ts
//
// These tests use isolated in-memory fixtures — no database access.
// They cover: zero scores, 0-0 ties, null scores, undecided matchups,
// byes, missing championship scores, champion/runner-up matchup
// attribution, non-playoff teams with playoff seeds, multiple seasons,
// co-managed teams, incomplete seasons, and tie handling.

import {
  type LegacySeasonTeam,
  type LegacyMatchup,
  type LegacyManager,
  calculateCareerStats,
  calculateH2H,
  calculateRivals,
  calculateMatchupRecords,
  calculateSingleSeasonRecords,
  calculateCareerRecords,
  buildChampionshipHistory,
  resolveManagerDisplayName,
  isGuidName,
} from './legacyStats';

// ── Test helpers ────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function makeManager(
  id: string,
  name: string,
  opts?: { aliases?: LegacyManager['aliases'] },
): LegacyManager {
  return { id, display_name: name, linked_user_id: null, seasons: 0, aliases: opts?.aliases ?? [] };
}

function makeTeam(
  id: string,
  seasonYear: number,
  opts: Partial<LegacySeasonTeam> = {},
): LegacySeasonTeam {
  return {
    id,
    season_year: seasonYear,
    external_team_id: id,
    team_name: opts.team_name ?? `Team ${id}`,
    team_abbrev: opts.team_abbrev ?? null,
    wins: opts.wins ?? 0,
    losses: opts.losses ?? 0,
    ties: opts.ties ?? 0,
    points_for: opts.points_for !== undefined ? opts.points_for : 0,
    points_against: opts.points_against !== undefined ? opts.points_against : 0,
    playoff_seed: opts.playoff_seed ?? null,
    playoff_team_count: opts.playoff_team_count ?? null,
    final_standing: opts.final_standing ?? null,
    is_champion: opts.is_champion ?? false,
    is_runner_up: opts.is_runner_up ?? false,
    primary_manager_id: opts.primary_manager_id ?? null,
    primary_manager_name: opts.primary_manager_name ?? null,
    co_manager_ids: opts.co_manager_ids ?? [],
    co_manager_names: opts.co_manager_names ?? [],
    is_season_complete: opts.is_season_complete ?? true,
  };
}

function makeMatchup(
  id: string,
  seasonYear: number,
  opts: Partial<LegacyMatchup> = {},
): LegacyMatchup {
  return {
    id,
    season_year: seasonYear,
    matchup_period: opts.matchup_period ?? 1,
    classification: opts.classification ?? 'regular',
    home_team_id: opts.home_team_id ?? 't1',
    away_team_id: opts.away_team_id ?? 't2',
    home_score: opts.home_score ?? null,
    away_score: opts.away_score ?? null,
    winner: opts.winner ?? null,
    home_team_name: opts.home_team_name ?? 'Team 1',
    away_team_name: opts.away_team_name ?? 'Team 2',
    home_manager_id: opts.home_manager_id ?? 'm1',
    away_manager_id: opts.away_manager_id ?? 'm2',
    home_manager_name: opts.home_manager_name ?? 'Manager 1',
    away_manager_name: opts.away_manager_name ?? 'Manager 2',
  };
}

// ── Test 1: Zero-score completed game counts in H2H ─────────────────────────

function testZeroScoreH2H() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_score: 100, away_score: 0, winner: 'HOME' }),
  ];

  const h2h = calculateH2H(matchups, 'm1', 'm2');
  assertEq(h2h.total.wins, 1, 'Zero-score H2H: A wins 100-0');
  assertEq(h2h.total.losses, 0, 'Zero-score H2H: B loses 0-100');
  assertEq(h2h.matchups.length, 1, 'Zero-score H2H: matchup counted');
  assertEq(h2h.points_against, 0, 'Zero-score H2H: B score is 0 not excluded');
}

// ── Test 2: 0-0 completed tie ────────────────────────────────────────────────

function testZeroZeroTie() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_score: 0, away_score: 0, winner: 'TIE' }),
  ];

  const h2h = calculateH2H(matchups, 'm1', 'm2');
  assertEq(h2h.total.ties, 1, '0-0 tie: counted as tie');
  assertEq(h2h.matchups.length, 1, '0-0 tie: matchup included');
}

// ── Test 3: Null scores excluded from H2H ──────────────────────────────────────

function testNullScoresH2H() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_score: null, away_score: null, winner: 'HOME' }),
  ];

  const h2h = calculateH2H(matchups, 'm1', 'm2');
  assertEq(h2h.matchups.length, 0, 'Null scores: excluded from H2H');
}

// ── Test 4: Undecided matchup excluded ─────────────────────────────────────────

function testUndecidedExcluded() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_score: 100, away_score: 50, winner: 'UNDECIDED' }),
  ];

  const h2h = calculateH2H(matchups, 'm1', 'm2');
  assertEq(h2h.matchups.length, 0, 'Undecided: excluded from H2H');
}

// ── Test 5: Bye excluded from H2H ───────────────────────────────────────────────

function testByeExcluded() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { classification: 'bye', away_team_id: null, home_score: null, away_score: null, winner: null }),
  ];

  const h2h = calculateH2H(matchups, 'm1', 'm2');
  assertEq(h2h.matchups.length, 0, 'Bye: excluded from H2H');
}

// ── Test 6: Rivals with zero scores ─────────────────────────────────────────────

function testRivalsZeroScore() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_manager_id: 'm1', away_manager_id: 'm2', home_score: 100, away_score: 0, winner: 'HOME' }),
  ];

  const rivals = calculateRivals(matchups, 'm1');
  assertEq(rivals.length, 1, 'Rivals: zero-score opponent counted');
  assertEq(rivals[0].wins, 1, 'Rivals: win counted against zero-score opponent');
  assertEq(rivals[0].losses, 0, 'Rivals: no losses');
}

// ── Test 7: Rivals excludes null scores and byes ──────────────────────────────────

function testRivalsExclusions() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_manager_id: 'm1', away_manager_id: 'm2', home_score: null, away_score: null, winner: 'HOME' }),
    makeMatchup('m2', 2024, { classification: 'bye', away_team_id: null, home_manager_id: 'm1', home_score: null, away_score: null, winner: null }),
    makeMatchup('m3', 2024, { home_manager_id: 'm1', away_manager_id: 'm2', home_score: 100, away_score: 50, winner: 'HOME' }),
  ];

  const rivals = calculateRivals(matchups, 'm1');
  assertEq(rivals.length, 1, 'Rivals: only completed matchup counted');
  assertEq(rivals[0].matchup_count, 1, 'Rivals: null-score and bye excluded');
}

// ── Test 8: Matchup records with zero scores ──────────────────────────────────────

function testMatchupRecordsZeroScore() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_score: 0, away_score: 100, winner: 'AWAY' }),
  ];

  const records = calculateMatchupRecords(matchups);
  assert(records.lowest_score.length > 0, 'Lowest score: has entries');
  assertEq(records.lowest_score[0].value, 0, 'Lowest score: 0 is recorded');
  assertEq(records.lowest_score[0].manager_name, 'Manager 1', 'Lowest score: home manager with 0');
}

// ── Test 9: Matchup records exclude null scores and undecided ──────────────────────

function testMatchupRecordsExclusions() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_score: null, away_score: 100, winner: 'AWAY' }),
    makeMatchup('m2', 2024, { home_score: 100, away_score: 50, winner: 'UNDECIDED' }),
    makeMatchup('m3', 2024, { classification: 'bye', away_team_id: null, home_score: 100, away_score: null, winner: null }),
    makeMatchup('m4', 2024, { home_score: 100, away_score: 50, winner: 'HOME' }),
  ];

  const records = calculateMatchupRecords(matchups);
  // Only m4 should be completed
  assertEq(records.highest_score.length, 2, 'Matchup records: only completed matchup scores counted (home+away = 2 entries)');
  assertEq(records.highest_score[0].value, 100, 'Matchup records: highest is 100');
}

// ── Test 10: Playoff qualification with playoffTeamCount ──────────────────────────

function testPlayoffQualification() {
  const managers = [makeManager('m1', 'A'), makeManager('m2', 'B'), makeManager('m3', 'C')];
  const teams: LegacySeasonTeam[] = [
    // Seed 1, playoffTeamCount=6 → qualifies
    makeTeam('t1', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', playoff_seed: 1, playoff_team_count: 6, final_standing: 1, wins: 10, losses: 3 }),
    // Seed 7, playoffTeamCount=6 → does NOT qualify (consolation)
    makeTeam('t2', 2024, { primary_manager_id: 'm2', primary_manager_name: 'B', playoff_seed: 7, playoff_team_count: 6, final_standing: 7, wins: 5, losses: 8 }),
    // Seed 3, playoffTeamCount=null → unknown
    makeTeam('t3', 2024, { primary_manager_id: 'm3', primary_manager_name: 'C', playoff_seed: 3, playoff_team_count: null, final_standing: 3, wins: 8, losses: 5 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  const a = careers.find((c) => c.manager_id === 'm1')!;
  const b = careers.find((c) => c.manager_id === 'm2')!;
  const c = careers.find((c) => c.manager_id === 'm3')!;

  assertEq(a.playoff_appearances, 1, 'Playoff: seed 1 <= 6 qualifies');
  assertEq(b.playoff_appearances, 0, 'Playoff: seed 7 > 6 does not qualify');
  assertEq(c.playoff_appearances, null, 'Playoff: unknown playoffTeamCount → null');

  // Season record made_playoffs
  assertEq(a.season_records[0].made_playoffs, true, 'Playoff: season record shows true for seed 1');
  assertEq(b.season_records[0].made_playoffs, false, 'Playoff: season record shows false for seed 7');
  assertEq(c.season_records[0].made_playoffs, null, 'Playoff: season record shows null when playoffTeamCount unknown');
}

// ── Test 11: All teams have playoff seeds but not all qualify ──────────────────────

function testAllSeededButNotAllQualify() {
  const managers = [
    makeManager('m1', 'A'), makeManager('m2', 'B'), makeManager('m3', 'C'),
    makeManager('m4', 'D'),
  ];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2024, { primary_manager_id: 'm1', playoff_seed: 1, playoff_team_count: 2, final_standing: 1, wins: 10, losses: 3 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm2', playoff_seed: 2, playoff_team_count: 2, final_standing: 2, wins: 9, losses: 4 }),
    makeTeam('t3', 2024, { primary_manager_id: 'm3', playoff_seed: 3, playoff_team_count: 2, final_standing: 3, wins: 6, losses: 7 }),
    makeTeam('t4', 2024, { primary_manager_id: 'm4', playoff_seed: 4, playoff_team_count: 2, final_standing: 4, wins: 3, losses: 10 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  const totalPlayoffs = careers
    .filter((c) => c.playoff_appearances !== null)
    .reduce((sum, c) => sum + (c.playoff_appearances ?? 0), 0);
  assertEq(totalPlayoffs, 2, 'Playoff: only 2 of 4 seeded teams qualify when playoffTeamCount=2');
}

// ── Test 12: Championship history with verified champion/runner-up ──────────────────

function testChampionshipHistoryVerified() {
  const teams: LegacySeasonTeam[] = [
    makeTeam('champ', 2024, { team_name: 'Champions', is_champion: true, primary_manager_id: 'm1', primary_manager_name: 'A', final_standing: 1 }),
    makeTeam('ru', 2024, { team_name: 'Runner Up', is_runner_up: true, primary_manager_id: 'm2', primary_manager_name: 'B', final_standing: 2 }),
  ];
  const matchups: LegacyMatchup[] = [
    // Correct championship game: both champ and ru are participants
    makeMatchup('m1', 2024, {
      matchup_period: 16, classification: 'championship',
      home_team_id: 'champ', away_team_id: 'ru',
      home_score: 224, away_score: 159, winner: 'HOME',
    }),
  ];

  const history = buildChampionshipHistory(teams, matchups);
  assertEq(history.length, 1, 'Championship: one entry');
  assertEq(history[0].champion_team_name, 'Champions', 'Championship: champion name');
  assertEq(history[0].runner_up_team_name, 'Runner Up', 'Championship: runner-up name');
  assertEq(history[0].champion_score, 224, 'Championship: champion score 224');
  assertEq(history[0].runner_up_score, 159, 'Championship: runner-up score 159');
  assertEq(history[0].has_championship_game, true, 'Championship: game verified');
}

// ── Test 13: Championship game with wrong participants is not used ──────────────────

function testChampionshipWrongParticipants() {
  const teams: LegacySeasonTeam[] = [
    makeTeam('champ', 2024, { team_name: 'Champions', is_champion: true, primary_manager_id: 'm1', primary_manager_name: 'A', final_standing: 1 }),
    makeTeam('ru', 2024, { team_name: 'Runner Up', is_runner_up: true, primary_manager_id: 'm2', primary_manager_name: 'B', final_standing: 2 }),
    makeTeam('other', 2024, { team_name: 'Other', primary_manager_id: 'm3', primary_manager_name: 'C', final_standing: 3 }),
  ];
  const matchups: LegacyMatchup[] = [
    // A "championship" classified game but with wrong participants
    makeMatchup('m1', 2024, {
      matchup_period: 16, classification: 'championship',
      home_team_id: 'champ', away_team_id: 'other',
      home_score: 200, away_score: 100, winner: 'HOME',
    }),
  ];

  const history = buildChampionshipHistory(teams, matchups);
  assertEq(history.length, 1, 'Championship wrong participants: still has entry');
  assertEq(history[0].has_championship_game, false, 'Championship wrong participants: no verified game');
  assertEq(history[0].champion_score, null, 'Championship wrong participants: no score');
  assertEq(history[0].runner_up_score, null, 'Championship wrong participants: no ru score');
  // Champion and runner-up names still shown
  assertEq(history[0].champion_team_name, 'Champions', 'Championship wrong: champion name still shown');
  assertEq(history[0].runner_up_team_name, 'Runner Up', 'Championship wrong: ru name still shown');
}

// ── Test 14: Championship with missing scores ───────────────────────────────────────

function testChampionshipMissingScores() {
  const teams: LegacySeasonTeam[] = [
    makeTeam('champ', 2024, { team_name: 'Champions', is_champion: true, primary_manager_id: 'm1', primary_manager_name: 'A', final_standing: 1 }),
    makeTeam('ru', 2024, { team_name: 'Runner Up', is_runner_up: true, primary_manager_id: 'm2', primary_manager_name: 'B', final_standing: 2 }),
  ];
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, {
      matchup_period: 16, classification: 'championship',
      home_team_id: 'champ', away_team_id: 'ru',
      home_score: null, away_score: null, winner: 'HOME',
    }),
  ];

  const history = buildChampionshipHistory(teams, matchups);
  assertEq(history[0].has_championship_game, true, 'Championship missing scores: game found by team IDs');
  assertEq(history[0].champion_score, null, 'Championship missing scores: null not zero');
  assertEq(history[0].runner_up_score, null, 'Championship missing scores: ru null not zero');
}

// ── Test 15: Multiple seasons career stats ────────────────────────────────────────────

function testMultipleSeasonsCareer() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, points_for: 1500, points_against: 1200, final_standing: 1, is_champion: true, playoff_seed: 1, playoff_team_count: 6 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 8, losses: 5, points_for: 1400, points_against: 1300, final_standing: 5, is_champion: false, playoff_seed: 3, playoff_team_count: 6 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].seasons, 2, 'Multi-season: 2 seasons');
  assertEq(careers[0].wins, 18, 'Multi-season: 18 total wins');
  assertEq(careers[0].losses, 8, 'Multi-season: 8 total losses');
  assertEq(careers[0].championships, 1, 'Multi-season: 1 championship');
  assertEq(careers[0].playoff_appearances, 2, 'Multi-season: 2 playoff appearances (both seeds <= 6)');
  assertEq(careers[0].best_finish, 1, 'Multi-season: best finish 1');
  assertEq(careers[0].worst_finish, 5, 'Multi-season: worst finish 5');
}

// ── Test 16: Co-managed team attribution ───────────────────────────────────────────────

function testCoManagerAttribution() {
  const managers = [makeManager('m1', 'Primary'), makeManager('m2', 'CoManager')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2024, {
      primary_manager_id: 'm1', primary_manager_name: 'Primary',
      wins: 10, losses: 3, final_standing: 1,
      co_manager_ids: ['m2'], co_manager_names: ['CoManager'],
    }),
  ];

  const careers = calculateCareerStats(teams, managers);
  const primary = careers.find((c) => c.manager_id === 'm1')!;
  const coMgr = careers.find((c) => c.manager_id === 'm2');

  assertEq(primary.wins, 10, 'Co-manager: primary gets 10 wins');
  assert(coMgr === undefined, 'Co-manager: co-manager gets no career stats (0 seasons)');
}

// ── Test 17: Incomplete season excluded from records ────────────────────────────────────

function testIncompleteSeason() {
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2024, { primary_manager_name: 'A', wins: 10, losses: 0, final_standing: null, points_for: 2000 }),
    makeTeam('t2', 2024, { primary_manager_name: 'B', wins: 8, losses: 2, final_standing: 2, points_for: 1800 }),
  ];

  const records = calculateSingleSeasonRecords(teams);
  // t1 has no final_standing → excluded from single-season records
  const mostWins = records.most_wins.find((r) => r.team_name === 'Team t1');
  assert(mostWins === undefined, 'Incomplete season: excluded from single-season records');
}

// ── Test 18: Tie handling in career win% ────────────────────────────────────────────────

function testTieWinPct() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2024, { primary_manager_id: 'm1', wins: 5, losses: 5, ties: 2, final_standing: 5 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  // win_pct = (5 + 2*0.5) / 12 = 6/12 = 0.5
  assert(Math.abs(careers[0].win_pct - 0.5) < 0.001, 'Tie win%: (5 + 1) / 12 = 0.5');
}

// ── Test 19: Career records filter playoff_appearances null ───────────────────────────────

function testCareerRecordsPlayoffNull() {
  const managers = [makeManager('m1', 'A'), makeManager('m2', 'B')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2024, { primary_manager_id: 'm1', wins: 10, losses: 3, final_standing: 1, playoff_seed: 1, playoff_team_count: null }),
    makeTeam('t2', 2024, { primary_manager_id: 'm2', wins: 8, losses: 5, final_standing: 2, playoff_seed: 2, playoff_team_count: 6 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  const records = calculateCareerRecords(careers);
  // m1 has null playoff_appearances → should NOT appear in most_playoff_appearances
  assertEq(records.most_playoff_appearances.length, 1, 'Career records: null playoff excluded');
  assertEq(records.most_playoff_appearances[0].manager_name, 'B', 'Career records: only B has playoff count');
}

// ── Test 20: Largest and closest margin with zero-score game ────────────────────────────────

function testMarginWithZeroScore() {
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_score: 100, away_score: 0, winner: 'HOME' }),
    makeMatchup('m2', 2024, { home_score: 50, away_score: 48, winner: 'HOME' }),
  ];

  const records = calculateMatchupRecords(matchups);
  assertEq(records.largest_margin[0].value, 100, 'Margin: largest is 100 (100-0)');
  assertEq(records.closest_margin[0].value, 2, 'Margin: closest is 2 (50-48)');
}

// ── Test 21: Incomplete season excluded from career aggregates ──────────────────────────

function testIncompleteSeasonCareerExclusion() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, points_for: 1500, points_against: 1200, final_standing: 1, is_champion: true, playoff_seed: 1, playoff_team_count: 6 }),
    // Incomplete 2024 season — should NOT count in career W/L
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 8, losses: 5, points_for: 1400, points_against: 1300, final_standing: null, is_season_complete: false }),
  ];

  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].seasons, 2, 'Incomplete career: 2 total seasons shown');
  assertEq(careers[0].complete_seasons, 1, 'Incomplete career: only 1 complete season');
  assertEq(careers[0].wins, 10, 'Incomplete career: only 10 wins from complete season');
  assertEq(careers[0].losses, 3, 'Incomplete career: only 3 losses from complete season');
  assertEq(careers[0].points_for, 1500, 'Incomplete career: only 1500 PF from complete season');
  assertEq(careers[0].championships, 1, 'Incomplete career: 1 championship from complete season');
  assertEq(careers[0].best_finish, 1, 'Incomplete career: best finish 1 from complete season');
  // Incomplete season still in season_records for visibility
  assertEq(careers[0].season_records.length, 2, 'Incomplete career: 2 season records shown');
  const incompleteRecord = careers[0].season_records.find((r) => r.season_year === 2024)!;
  assertEq(incompleteRecord.is_season_complete, false, 'Incomplete career: 2024 marked incomplete');
  assertEq(incompleteRecord.made_playoffs, null, 'Incomplete career: made_playoffs null for incomplete');
}

// ── Test 22: Partially imported season (import_status not complete) ──────────────────────

function testPartiallyImportedSeason() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    // import_status was 'partial' → is_season_complete=false
    makeTeam('t1', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 5, losses: 2, final_standing: 1, is_season_complete: false }),
  ];

  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].wins, 0, 'Partial import: 0 career wins (excluded)');
  assertEq(careers[0].complete_seasons, 0, 'Partial import: 0 complete seasons');
  assertEq(careers[0].seasons, 1, 'Partial import: 1 season shown');
}

// ── Test 23: Missing season points not converted to zero ────────────────────────────────

function testMissingPointsNotZero() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    // points_for is 0 (default) but season is complete — valid zero-point season
    makeTeam('t1', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 0, losses: 13, points_for: 0, points_against: 2000, final_standing: 12 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].wins, 0, 'Missing points: 0 wins is valid');
  assertEq(careers[0].losses, 13, 'Missing points: 13 losses is valid');
  assertEq(careers[0].points_for, 0, 'Missing points: 0 PF is valid (not excluded)');
  assertEq(careers[0].complete_seasons, 1, 'Missing points: season is complete');
}

// ── Test 24: Missing playoff settings on complete season → null playoffs ────────────────

function testMissingPlayoffSettingsComplete() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, final_standing: 1, playoff_seed: 1, playoff_team_count: null }),
  ];

  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].playoff_appearances, null, 'Missing playoff settings: null on complete season');
  assertEq(careers[0].season_records[0].made_playoffs, null, 'Missing playoff settings: null in season record');
}

// ── Test 25: Multiple teams same manager same season ────────────────────────────────────

function testMultipleTeamsSameSeason() {
  const managers = [makeManager('m1', 'A')];
  // Manager took over a team mid-season and also has another team (historical override scenario)
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 5, losses: 3, final_standing: 5, playoff_seed: 5, playoff_team_count: 6 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 3, losses: 5, final_standing: 8, playoff_seed: 8, playoff_team_count: 6 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  // seasons count is distinct seasons (1), not teams (2)
  assertEq(careers[0].seasons, 1, 'Multi-team: 1 distinct season');
  // Career W/L aggregates both teams
  assertEq(careers[0].wins, 8, 'Multi-team: 8 total wins (5+3)');
  assertEq(careers[0].losses, 8, 'Multi-team: 8 total losses (3+5)');
  // complete_seasons counts both teams as complete
  assertEq(careers[0].complete_seasons, 2, 'Multi-team: 2 complete team-seasons');
  // Playoff: t1 seed 5 <= 6 qualifies, t2 seed 8 > 6 does not
  assertEq(careers[0].playoff_appearances, 1, 'Multi-team: 1 playoff appearance (t1 qualifies, t2 does not)');
  // Season records show both teams
  assertEq(careers[0].season_records.length, 2, 'Multi-team: 2 season records');
}

// ── Test 26: Career leaderboard eligibility uses complete seasons only ────────────────────

function testCareerLeaderboardCompleteOnly() {
  const managers = [makeManager('m1', 'A'), makeManager('m2', 'B')];
  const teams: LegacySeasonTeam[] = [
    // A: 1 complete season with 10 wins, 1 incomplete with 50 wins
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, final_standing: 1 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 50, losses: 0, final_standing: null, is_season_complete: false }),
    // B: 1 complete season with 8 wins
    makeTeam('t3', 2023, { primary_manager_id: 'm2', primary_manager_name: 'B', wins: 8, losses: 5, final_standing: 3 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  const records = calculateCareerRecords(careers);
  // A should have 10 wins (not 60) in career leaderboard
  const aRecord = records.most_wins.find((r) => r.manager_name === 'A');
  assert(aRecord !== undefined, 'Leaderboard: A appears in most wins');
  assertEq(aRecord!.value, 10, 'Leaderboard: A has 10 wins (incomplete season excluded)');
  // B should have 8 wins
  const bRecord = records.most_wins.find((r) => r.manager_name === 'B');
  assert(bRecord !== undefined, 'Leaderboard: B appears in most wins');
  assertEq(bRecord!.value, 8, 'Leaderboard: B has 8 wins');
  // A should be ranked above B (10 > 8)
  assertEq(records.most_wins[0].manager_name, 'A', 'Leaderboard: A ranked #1 with 10 wins');
}

// ── Test 27: Completed matchup counts even from incomplete season ────────────────────────

function testMatchupRecordsFromIncompleteSeason() {
  // Single-game records should count completed matchups even if season isn't complete
  const matchups: LegacyMatchup[] = [
    makeMatchup('m1', 2024, { home_score: 250, away_score: 100, winner: 'HOME' }),
  ];

  const records = calculateMatchupRecords(matchups);
  assertEq(records.highest_score[0].value, 250, 'Incomplete season matchup: 250 counts as highest');
}

// ── Test 28: Imported but ongoing season excluded from career aggregates ────────────────
// import_status === 'complete' means data was fetched, not that the season is over.
// An ongoing season with import_status=complete but no final_standing must be
// excluded from career totals.

function testImportedButOngoingSeason() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    // 2023: fully finalized
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, points_for: 1500, points_against: 1200, final_standing: 1, is_champion: true, playoff_seed: 1, playoff_team_count: 6 }),
    // 2024: import_status=complete (is_season_complete=true) but season is
    // still ongoing — no final_standing yet. Must NOT count in career W/L.
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 5, losses: 2, points_for: 800, points_against: 600, final_standing: null, is_season_complete: true }),
  ];

  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].seasons, 2, 'Ongoing: 2 seasons shown (both visible)');
  assertEq(careers[0].complete_seasons, 1, 'Ongoing: only 1 complete season (final_standing gate)');
  assertEq(careers[0].wins, 10, 'Ongoing: 10 wins from finalized season only');
  assertEq(careers[0].losses, 3, 'Ongoing: 3 losses from finalized season only');
  assertEq(careers[0].points_for, 1500, 'Ongoing: 1500 PF from finalized season only');
  assertEq(careers[0].championships, 1, 'Ongoing: 1 championship from finalized season');
  // 2024 season record should be visible but marked incomplete
  const ongoingRecord = careers[0].season_records.find((r) => r.season_year === 2024)!;
  assertEq(ongoingRecord.is_season_complete, false, 'Ongoing: 2024 marked incomplete (no final_standing)');
  assertEq(ongoingRecord.made_playoffs, null, 'Ongoing: made_playoffs null for ongoing season');
}

// ── Test 29: Mixed complete and incomplete career stats ─────────────────────────────────
// A manager with 3 seasons: 2 complete, 1 ongoing. Career totals should only
// reflect the 2 complete seasons, but all 3 appear in season_records.

function testMixedCompleteIncompleteCareerStats() {
  const managers = [makeManager('m1', 'A'), makeManager('m2', 'B')];
  const teams: LegacySeasonTeam[] = [
    // A: 2 complete seasons + 1 ongoing
    makeTeam('t1', 2022, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 8, losses: 5, points_for: 1400, points_against: 1300, final_standing: 3, playoff_seed: 3, playoff_team_count: 6 }),
    makeTeam('t2', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 11, losses: 2, points_for: 1600, points_against: 1100, final_standing: 1, is_champion: true, playoff_seed: 1, playoff_team_count: 6 }),
    makeTeam('t3', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 6, losses: 1, points_for: 700, points_against: 500, final_standing: null, is_season_complete: true }),
    // B: 1 complete season
    makeTeam('t4', 2023, { primary_manager_id: 'm2', primary_manager_name: 'B', wins: 7, losses: 6, points_for: 1200, points_against: 1250, final_standing: 5, playoff_seed: 5, playoff_team_count: 6 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  const a = careers.find((c) => c.manager_id === 'm1')!;
  const b = careers.find((c) => c.manager_id === 'm2')!;

  // A: only 2022 + 2023 count in career aggregates
  assertEq(a.seasons, 3, 'Mixed: A has 3 seasons shown');
  assertEq(a.complete_seasons, 2, 'Mixed: A has 2 complete seasons');
  assertEq(a.wins, 19, 'Mixed: A has 19 wins (8+11, not 25)');
  assertEq(a.losses, 7, 'Mixed: A has 7 losses (5+2, not 8)');
  assertEq(a.points_for, 3000, 'Mixed: A has 3000 PF (1400+1600, not 3700)');
  assertEq(a.championships, 1, 'Mixed: A has 1 championship');
  assertEq(a.playoff_appearances, 2, 'Mixed: A has 2 playoff appearances');
  assertEq(a.best_finish, 1, 'Mixed: A best finish 1');
  assertEq(a.worst_finish, 3, 'Mixed: A worst finish 3');
  assertEq(a.season_records.length, 3, 'Mixed: A has 3 season records');

  // B: only 1 complete season
  assertEq(b.seasons, 1, 'Mixed: B has 1 season');
  assertEq(b.complete_seasons, 1, 'Mixed: B has 1 complete season');
  assertEq(b.wins, 7, 'Mixed: B has 7 wins');
}

// ── Test 30: Null points vs zero points in career aggregation ───────────────────────────
// DB NULL means "unknown" — it must not be silently treated as 0 in a way
// that distorts records. A team with null points_for should not appear in
// "most points" single-season records, but a team with 0 points_for should.

function testNullPointsVsZeroPoints() {
  const managers = [makeManager('m1', 'A'), makeManager('m2', 'B')];
  const teams: LegacySeasonTeam[] = [
    // Team with null points_for (DB NULL — data missing)
    makeTeam('t1', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 5, losses: 8, points_for: null, points_against: null, final_standing: 10 }),
    // Team with 0 points_for (legitimately scored 0 all season)
    makeTeam('t2', 2024, { primary_manager_id: 'm2', primary_manager_name: 'B', wins: 0, losses: 13, points_for: 0, points_against: 2000, final_standing: 12 }),
  ];

  const careers = calculateCareerStats(teams, managers);
  const a = careers.find((c) => c.manager_id === 'm1')!;
  const b = careers.find((c) => c.manager_id === 'm2')!;

  // Career points: null team → career PF is null (missing data, not zero)
  assertEq(a.points_for, null, 'Null points: career PF is null (missing data, not zero)');
  assertEq(a.points_against, null, 'Null points: career PA is null (missing data, not zero)');
  // Zero-point team → career PF is 0 (legitimate)
  assertEq(b.points_for, 0, 'Zero points: career PF is 0 (legitimate)');
  assertEq(b.points_against, 2000, 'Zero points: career PA is 2000');

  // Single-season records: null-points team excluded from most_points
  const records = calculateSingleSeasonRecords(teams);
  const nullTeamInRecords = records.most_points.find((r) => r.team_name === 'Team t1');
  assert(nullTeamInRecords === undefined, 'Null points: excluded from most_points single-season records');
  const zeroTeamInRecords = records.most_points.find((r) => r.team_name === 'Team t2');
  assert(zeroTeamInRecords !== undefined, 'Zero points: included in most_points single-season records');
}

// ── Test 31: Manager identity changes reflected on reload ───────────────────────────────
// When a manager's display name changes (e.g. GUID resolved to human name),
// the career stats should use the updated display_name from the managers array.
// This simulates a reload after the name mapping changes.

function testManagerIdentityChangeOnReload() {
  // First load: manager has GUID as display_name
  const managersBefore = [makeManager('m1', '{BC7447B2-4463-43D3-AB2F-B47B053E1793}')];
  // Second load: same manager, now with resolved human name
  const managersAfter = [makeManager('m1', 'carltonmeans')];

  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2024, { primary_manager_id: 'm1', primary_manager_name: 'carltonmeans', wins: 10, losses: 3, final_standing: 1, playoff_seed: 1, playoff_team_count: 6 }),
  ];

  const careersBefore = calculateCareerStats(teams, managersBefore);
  const careersAfter = calculateCareerStats(teams, managersAfter);

  // The display_name in career stats comes from the manager object, not the team
  assertEq(careersBefore[0].display_name, '{BC7447B2-4463-43D3-AB2F-B47B053E1793}', 'Identity: GUID name before resolution');
  assertEq(careersAfter[0].display_name, 'carltonmeans', 'Identity: human name after resolution');
  // Stats should be identical
  assertEq(careersBefore[0].wins, careersAfter[0].wins, 'Identity: wins unchanged after name change');
  assertEq(careersBefore[0].championships, careersAfter[0].championships, 'Identity: championships unchanged');
  // Career records should show the updated name
  const recordsBefore = calculateCareerRecords(careersBefore);
  const recordsAfter = calculateCareerRecords(careersAfter);
  assertEq(recordsBefore.most_wins[0].manager_name, '{BC7447B2-4463-43D3-AB2F-B47B053E1793}', 'Identity: records show GUID before');
  assertEq(recordsAfter.most_wins[0].manager_name, 'carltonmeans', 'Identity: records show human name after');
}

// ── Test 32: Commissioner-renamed manager retains chosen name ──────────────
function testCommissionerRenamedManagerRetainsName() {
  const aliases = [{ external_owner_id: '{BC7447B2-4463-43D3-AB2F-B47B053E1793}' }];
  const importedNames: Record<string, string> = {
    '{BC7447B2-4463-43D3-AB2F-B47B053E1793}': 'carltonmeans',
  };
  const resolved = resolveManagerDisplayName('Carlton (Commissioner)', aliases, importedNames);
  assertEq(resolved, 'Carlton (Commissioner)', 'Commissioner rename: human name preserved');
}

// ── Test 33: GUID-only manager uses current-league name fallback ──────────
function testGuidManagerUsesCurrentLeagueFallback() {
  const aliases = [{ external_owner_id: '{BC7447B2-4463-43D3-AB2F-B47B053E1793}' }];
  const importedNames: Record<string, string> = {
    '{BC7447B2-4463-43D3-AB2F-B47B053E1793}': 'carltonmeans',
  };
  const resolved = resolveManagerDisplayName('{BC7447B2-4463-43D3-AB2F-B47B053E1793}', aliases, importedNames);
  assertEq(resolved, 'carltonmeans', 'GUID fallback: uses imported member name');
}

// ── Test 34: Multiple ESPN aliases resolved deterministically ──────────────
function testMultipleAliasesDeterministic() {
  const aliases = [
    { external_owner_id: '{ZZZZZZZZ-4463-43D3-AB2F-B47B053E1793}' },
    { external_owner_id: '{AAAAAAAA-4463-43D3-AB2F-B47B053E1793}' },
  ];
  const importedNames: Record<string, string> = {
    '{ZZZZZZZZ-4463-43D3-AB2F-B47B053E1793}': 'zzz_name',
    '{AAAAAAAA-4463-43D3-AB2F-B47B053E1793}': 'aaa_name',
  };
  const resolved = resolveManagerDisplayName('{BC7447B2-4463-43D3-AB2F-B47B053E1793}', aliases, importedNames);
  assertEq(resolved, 'aaa_name', 'Multiple aliases: first alphabetically wins');
}

// ── Test 35: Unrelated league imported members are not used ────────────────
function testUnrelatedLeagueNotUsed() {
  const aliases = [{ external_owner_id: '{BC7447B2-4463-43D3-AB2F-B47B053E1793}' }];
  const importedNames: Record<string, string> = {};
  const resolved = resolveManagerDisplayName('{BC7447B2-4463-43D3-AB2F-B47B053E1793}', aliases, importedNames);
  assertEq(resolved, 'Unresolved Manager', 'Unrelated league: unresolved when no current-league data');
}

// ── Test 36: Co-manager display-name resolution ────────────────────────────
function testCoManagerNameResolution() {
  const aliases = [{ external_owner_id: '{24B305E2-BE54-43EF-B305-E2BE54A3EFB1}' }];
  const importedNames: Record<string, string> = {
    '{24B305E2-BE54-43EF-B305-E2BE54A3EFB1}': 'espn33266911',
  };
  const resolved = resolveManagerDisplayName('{24B305E2-BE54-43EF-B305-E2BE54A3EFB1}', aliases, importedNames);
  assertEq(resolved, 'espn33266911', 'Co-manager: GUID resolved to imported name');
}

// ── Test 37: Career scoring with complete points data ──────────────────────
function testCareerScoringCompletePoints() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, points_for: 1500, points_against: 1200, final_standing: 1 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 8, losses: 5, points_for: 1400, points_against: 1300, final_standing: 5 }),
  ];
  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].points_for, 2900, 'Complete points: career PF 2900');
  assertEq(careers[0].points_against, 2500, 'Complete points: career PA 2500');
}

// ── Test 38: Career scoring with NULL points in one season ─────────────────
function testCareerScoringNullPointsOneSeason() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, points_for: 1500, points_against: 1200, final_standing: 1 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 8, losses: 5, points_for: null, points_against: null, final_standing: 5 }),
  ];
  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].points_for, null, 'Null season: career PF null (one season missing)');
  assertEq(careers[0].points_against, null, 'Null season: career PA null (one season missing)');
  assertEq(careers[0].wins, 18, 'Null season: 18 wins unaffected');
  assertEq(careers[0].losses, 8, 'Null season: 8 losses unaffected');
}

// ── Test 39: Career scoring with legitimate zero-point season ──────────────
function testCareerScoringZeroPointSeason() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, points_for: 1500, points_against: 1200, final_standing: 1 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 0, losses: 13, points_for: 0, points_against: 2000, final_standing: 12 }),
  ];
  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].points_for, 1500, 'Zero-point season: career PF 1500 (0 is valid)');
  assertEq(careers[0].points_against, 3200, 'Zero-point season: career PA 3200');
}

// ── Test 40: Missing PF and PA handled independently ───────────────────────
function testMissingPFIndependentFromPA() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, points_for: null, points_against: 1200, final_standing: 1 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 8, losses: 5, points_for: 1500, points_against: null, final_standing: 5 }),
  ];
  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].points_for, null, 'Independent PF: null (season 1 missing)');
  assertEq(careers[0].points_against, null, 'Independent PA: null (season 2 missing)');
  assertEq(careers[0].wins, 18, 'Independent: 18 wins unaffected');
  assertEq(careers[0].losses, 8, 'Independent: 8 losses unaffected');
}

// ── Test 41: W/L/T unaffected by missing scoring data ──────────────────────
function testWLTUnaffectedByMissingScoring() {
  const managers = [makeManager('m1', 'A')];
  const teams: LegacySeasonTeam[] = [
    makeTeam('t1', 2023, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 10, losses: 3, ties: 1, points_for: null, points_against: null, final_standing: 1, is_champion: true, playoff_seed: 1, playoff_team_count: 6 }),
    makeTeam('t2', 2024, { primary_manager_id: 'm1', primary_manager_name: 'A', wins: 8, losses: 5, ties: 0, points_for: null, points_against: null, final_standing: 5, playoff_seed: 3, playoff_team_count: 6 }),
  ];
  const careers = calculateCareerStats(teams, managers);
  assertEq(careers[0].wins, 18, 'WLT unaffected: 18 wins');
  assertEq(careers[0].losses, 8, 'WLT unaffected: 8 losses');
  assertEq(careers[0].ties, 1, 'WLT unaffected: 1 tie');
  assertEq(careers[0].championships, 1, 'WLT unaffected: 1 championship');
  assertEq(careers[0].playoff_appearances, 2, 'WLT unaffected: 2 playoff appearances');
  assertEq(careers[0].points_for, null, 'WLT unaffected: PF null');
  assertEq(careers[0].points_against, null, 'WLT unaffected: PA null');
  const records = calculateCareerRecords(careers);
  const inPoints = records.most_points.find((r) => r.manager_name === 'A');
  assert(inPoints === undefined, 'WLT unaffected: excluded from points leaderboard');
  const inWins = records.most_wins.find((r) => r.manager_name === 'A');
  assert(inWins !== undefined, 'WLT unaffected: included in wins leaderboard');
}

// ── Run all tests ──────────────────────────────────────────────────────────────────────

console.log('Running legacyStats tests...\n');

testZeroScoreH2H();
testZeroZeroTie();
testNullScoresH2H();
testUndecidedExcluded();
testByeExcluded();
testRivalsZeroScore();
testRivalsExclusions();
testMatchupRecordsZeroScore();
testMatchupRecordsExclusions();
testPlayoffQualification();
testAllSeededButNotAllQualify();
testChampionshipHistoryVerified();
testChampionshipWrongParticipants();
testChampionshipMissingScores();
testMultipleSeasonsCareer();
testCoManagerAttribution();
testIncompleteSeason();
testTieWinPct();
testCareerRecordsPlayoffNull();
testMarginWithZeroScore();
testIncompleteSeasonCareerExclusion();
testPartiallyImportedSeason();
testMissingPointsNotZero();
testMissingPlayoffSettingsComplete();
testMultipleTeamsSameSeason();
testCareerLeaderboardCompleteOnly();
testMatchupRecordsFromIncompleteSeason();
testImportedButOngoingSeason();
testMixedCompleteIncompleteCareerStats();
testNullPointsVsZeroPoints();
testManagerIdentityChangeOnReload();
testCommissionerRenamedManagerRetainsName();
testGuidManagerUsesCurrentLeagueFallback();
testMultipleAliasesDeterministic();
testUnrelatedLeagueNotUsed();
testCoManagerNameResolution();
testCareerScoringCompletePoints();
testCareerScoringNullPointsOneSeason();
testCareerScoringZeroPointSeason();
testMissingPFIndependentFromPA();
testWLTUnaffectedByMissingScoring();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
