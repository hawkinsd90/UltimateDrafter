import type { Database } from '../types/supabase';

type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

export interface TradeWarningPlayer {
  fantasyPosition: string | null;
}

export function computeTradeWarnings(
  proposerRoster:  TradeWarningPlayer[],
  receiverRoster:  TradeWarningPlayer[],
  sending:         TradeWarningPlayer[],
  receiving:       TradeWarningPlayer[],
  leagueSettings:  LeagueSettings | null,
): string[] {
  const warnings: string[] = [];
  if (!leagueSettings) return warnings;

  const s = leagueSettings as LeagueSettings & {
    roster_qb?: number; roster_rb?: number; roster_wr?: number;
    roster_te?: number; roster_k?: number;  roster_dst?: number;
    roster_flex?: number; roster_op?: number; bench?: number;
    max_roster_size?: number;
  };

  function simulate(roster: TradeWarningPlayer[], give: TradeWarningPlayer[], take: TradeWarningPlayer[]) {
    const after = roster.filter(p => !give.includes(p)).concat(take);
    return after;
  }

  function countPos(roster: TradeWarningPlayer[], pos: string) {
    return roster.filter(p => p.fantasyPosition === pos).length;
  }

  const afterProposer = simulate(proposerRoster, sending, receiving);
  const afterReceiver = simulate(receiverRoster, receiving, sending);

  const posLimits: Array<{ pos: string; limit: number | undefined }> = [
    { pos: 'QB',  limit: s.roster_qb },
    { pos: 'RB',  limit: s.roster_rb },
    { pos: 'WR',  limit: s.roster_wr },
    { pos: 'TE',  limit: s.roster_te },
    { pos: 'K',   limit: s.roster_k  },
    { pos: 'DST', limit: s.roster_dst },
  ];

  const maxRoster = s.max_roster_size;

  const proposerTeam = 'Your team';
  const receiverTeam = 'Trade partner';

  for (const { pos, limit } of posLimits) {
    if (!limit) continue;
    const pc = countPos(afterProposer, pos);
    if (pc > limit) warnings.push(`This trade may put ${proposerTeam} over the ${pos} limit (${pc} ${pos}, max ${limit})`);
    const rc = countPos(afterReceiver, pos);
    if (rc > limit) warnings.push(`This trade may put ${receiverTeam} over the ${pos} limit (${rc} ${pos}, max ${limit})`);
  }

  if (maxRoster) {
    if (afterProposer.length > maxRoster) {
      warnings.push(`This trade may leave ${proposerTeam} over total roster size (${afterProposer.length} players, max ${maxRoster})`);
    }
    if (afterReceiver.length > maxRoster) {
      warnings.push(`This trade may leave ${receiverTeam} over total roster size (${afterReceiver.length} players, max ${maxRoster})`);
    }
  }

  return warnings;
}
