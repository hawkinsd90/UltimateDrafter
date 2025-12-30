import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const samplePlayers = [
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Create Supabase client with service role key
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Check if players already exist
    const { data: existingPlayers } = await supabaseClient
      .from('players')
      .select('name')
      .limit(1);

    if (existingPlayers && existingPlayers.length > 0) {
      return new Response(
        JSON.stringify({ message: 'Players already seeded', count: 0 }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Insert players using service role
    const { error } = await supabaseClient
      .from('players')
      .insert(samplePlayers.map(p => ({
        ...p,
        metadata: {}
      })));

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({ message: 'Players seeded successfully', count: samplePlayers.length }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});