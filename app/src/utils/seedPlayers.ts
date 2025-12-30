import { supabase } from '../lib/supabase';

export async function seedSamplePlayers() {
  const players = [
    { name: 'Patrick Mahomes', position: 'QB', team: 'Kansas City Chiefs', sport: 'football' },
    { name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', sport: 'football' },
    { name: 'Joe Burrow', position: 'QB', team: 'Cincinnati Bengals', sport: 'football' },
    { name: 'Lamar Jackson', position: 'QB', team: 'Baltimore Ravens', sport: 'football' },
    { name: 'Jalen Hurts', position: 'QB', team: 'Philadelphia Eagles', sport: 'football' },
    { name: 'Christian McCaffrey', position: 'RB', team: 'San Francisco 49ers', sport: 'football' },
    { name: 'Tyreek Hill', position: 'WR', team: 'Miami Dolphins', sport: 'football' },
    { name: 'Justin Jefferson', position: 'WR', team: 'Minnesota Vikings', sport: 'football' },
    { name: 'CeeDee Lamb', position: 'WR', team: 'Dallas Cowboys', sport: 'football' },
    { name: 'Amon-Ra St. Brown', position: 'WR', team: 'Detroit Lions', sport: 'football' },
    { name: 'Travis Kelce', position: 'TE', team: 'Kansas City Chiefs', sport: 'football' },
    { name: 'Sam LaPorta', position: 'TE', team: 'Detroit Lions', sport: 'football' },
    { name: 'Bijan Robinson', position: 'RB', team: 'Atlanta Falcons', sport: 'football' },
    { name: 'Breece Hall', position: 'RB', team: 'New York Jets', sport: 'football' },
    { name: 'Jahmyr Gibbs', position: 'RB', team: 'Detroit Lions', sport: 'football' },
    { name: 'Garrett Wilson', position: 'WR', team: 'New York Jets', sport: 'football' },
    { name: 'Ja\'Marr Chase', position: 'WR', team: 'Cincinnati Bengals', sport: 'football' },
    { name: 'A.J. Brown', position: 'WR', team: 'Philadelphia Eagles', sport: 'football' },
    { name: 'Puka Nacua', position: 'WR', team: 'Los Angeles Rams', sport: 'football' },
    { name: 'Davante Adams', position: 'WR', team: 'Las Vegas Raiders', sport: 'football' },
    { name: 'LeBron James', position: 'SF', team: 'Los Angeles Lakers', sport: 'basketball' },
    { name: 'Stephen Curry', position: 'PG', team: 'Golden State Warriors', sport: 'basketball' },
    { name: 'Kevin Durant', position: 'PF', team: 'Phoenix Suns', sport: 'basketball' },
    { name: 'Giannis Antetokounmpo', position: 'PF', team: 'Milwaukee Bucks', sport: 'basketball' },
    { name: 'Luka Doncic', position: 'PG', team: 'Dallas Mavericks', sport: 'basketball' },
    { name: 'Nikola Jokic', position: 'C', team: 'Denver Nuggets', sport: 'basketball' },
    { name: 'Joel Embiid', position: 'C', team: 'Philadelphia 76ers', sport: 'basketball' },
    { name: 'Jayson Tatum', position: 'SF', team: 'Boston Celtics', sport: 'basketball' },
    { name: 'Damian Lillard', position: 'PG', team: 'Milwaukee Bucks', sport: 'basketball' },
    { name: 'Anthony Davis', position: 'PF', team: 'Los Angeles Lakers', sport: 'basketball' },
  ];

  const { data: existingPlayers } = await supabase
    .from('players')
    .select('name')
    .limit(1);

  if (existingPlayers && existingPlayers.length > 0) {
    console.log('Players already seeded');
    return;
  }

  const { error } = await supabase
    .from('players')
    .insert(players.map(p => ({
      ...p,
      metadata: {}
    })));

  if (error) {
    console.error('Error seeding players:', error);
  } else {
    console.log('Players seeded successfully');
  }
}
