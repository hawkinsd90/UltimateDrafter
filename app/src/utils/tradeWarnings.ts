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

  // Use only explicit max fields, not starter slot counts.
  // roster_qb / roster_rb / etc. are lineup slots, not roster maximums.
  // Only warn when a dedicated max field exists and would be exceeded.
  const s = leagueSettings as LeagueSettings & {
    max_qb?:         number;
    max_rb?:         number;
    max_wr?:         number;
    max_te?:         number;
    max_k?:          number;
    max_dst?:        number;
    max_roster_size?: number;
  };

  function simulate(roster: TradeWarningPlayer[], give: TradeWarningPlayer[], take: TradeWarningPlayer[]) {
    return roster.filter(p => !give.includes(p)).concat(take);
  }

  function countPos(roster: TradeWarningPlayer[], pos: string) {
    return roster.filter(p => p.fantasyPosition === pos).length;
  }

  const afterProposer = simulate(proposerRoster, sending, receiving);
  const afterReceiver = simulate(receiverRoster, receiving, sending);

  const posLimits: Array<{ pos: string; max: number | undefined }> = [
    { pos: 'QB',  max: s.max_qb  },
    { pos: 'RB',  max: s.max_rb  },
    { pos: 'WR',  max: s.max_wr  },
    { pos: 'TE',  max: s.max_te  },
    { pos: 'K',   max: s.max_k   },
    { pos: 'DST', max: s.max_dst },
  ];

  const proposerTeam = 'Your team';
  const receiverTeam = 'Trade partner';

  for (const { pos, max } of posLimits) {
    if (!max) continue;
    const pc = countPos(afterProposer, pos);
    if (pc > max) warnings.push(`This trade may put ${proposerTeam} over the ${pos} limit (${pc} ${pos}, max ${max})`);
    const rc = countPos(afterReceiver, pos);
    if (rc > max) warnings.push(`This trade may put ${receiverTeam} over the ${pos} limit (${rc} ${pos}, max ${max})`);
  }

  if (s.max_roster_size) {
    if (afterProposer.length > s.max_roster_size) {
      warnings.push(`This trade may leave ${proposerTeam} over total roster size (${afterProposer.length} players, max ${s.max_roster_size})`);
    }
    if (afterReceiver.length > s.max_roster_size) {
      warnings.push(`This trade may leave ${receiverTeam} over total roster size (${afterReceiver.length} players, max ${s.max_roster_size})`);
    }
  }

  return warnings;
}
