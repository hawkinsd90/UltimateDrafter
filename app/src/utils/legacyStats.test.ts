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

function makeManager(id: string, name: string): LegacyManager {
  return { id, display_name: name, linked_user_id: null, seasons: 0, aliases: [] };
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
    points_for: opts.points_for ?? 0,
    points_against: opts.points_against ?? 0,
    playoff_seed: opts.playoff_seed ?? null,
    playoff_team_count: opts.playoff_team_count ?? null,
    final_standing: opts.final_standing ?? null,
    is_champion: opts.is_champion ?? false,
    is_runner_up: opts.is_runner_up ?? false,
    primary_manager_id: opts.primary_manager_id ?? null,
    primary_manager_name: opts.primary_manager_name ?? null,
    co_manager_ids: opts.co_manager_ids ?? [],
    co_manager_names: opts.co_manager_names ?? [],
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
