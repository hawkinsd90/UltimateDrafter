import type { Database } from '../types/supabase';

type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

export interface RosterSlot {
  label:        string;
  displayLabel: string;
  section:      'starters' | 'bench';
}

export const POS_PRIORITY = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DEF'];

export function buildEmptySlots(settings: LeagueSettings | null): RosterSlot[] {
  const s = settings;
  const qb    = s?.roster_qb   ?? 1;
  const rb    = s?.roster_rb   ?? 2;
  const wr    = s?.roster_wr   ?? 2;
  const te    = s?.roster_te   ?? 1;
  const flex  = s?.roster_flex ?? 1;
  const k     = s?.roster_k    ?? 1;
  const dst   = s?.roster_dst  ?? 1;
  const op    = (s as (LeagueSettings & { roster_op?: number }) | null)?.roster_op ?? 0;
  const bench = s?.bench       ?? 6;

  const slots: RosterSlot[] = [];
  for (let i = 0; i < qb;    i++) slots.push({ label: 'QB',   displayLabel: 'QB',             section: 'starters' });
  for (let i = 0; i < rb;    i++) slots.push({ label: 'RB',   displayLabel: 'RB',             section: 'starters' });
  for (let i = 0; i < wr;    i++) slots.push({ label: 'WR',   displayLabel: 'WR',             section: 'starters' });
  for (let i = 0; i < te;    i++) slots.push({ label: 'TE',   displayLabel: 'TE',             section: 'starters' });
  for (let i = 0; i < flex;  i++) slots.push({ label: 'FLEX', displayLabel: 'FLEX',           section: 'starters' });
  for (let i = 0; i < k;     i++) slots.push({ label: 'K',    displayLabel: 'K',              section: 'starters' });
  for (let i = 0; i < dst;   i++) slots.push({ label: 'DST',  displayLabel: 'DST',            section: 'starters' });
  for (let i = 0; i < op;    i++) slots.push({ label: 'OP',   displayLabel: 'SuperFlex (OP)', section: 'starters' });
  for (let i = 0; i < bench; i++) slots.push({ label: 'BN',   displayLabel: 'BN',             section: 'bench' });
  return slots;
}

export function slotFitsPlayer(slotLabel: string, pos: string | null): boolean {
  if (!pos) return false;
  if (slotLabel === pos) return true;
  if (slotLabel === 'BN') return true;
  if (slotLabel === 'FLEX') return ['RB', 'WR', 'TE'].includes(pos);
  if (slotLabel === 'OP') return ['QB', 'RB', 'WR', 'TE'].includes(pos);
  return false;
}

export interface SlottablePlayer {
  id:             string;
  fantasyPosition: string | null;
}

export function assignPlayersToSlots<T extends SlottablePlayer>(slots: RosterSlot[], orderedPlayers: T[]): (T | null)[] {
  const used = new Set<string>();
  return slots.map(slot => {
    const match = orderedPlayers.find(p => !used.has(p.id) && slotFitsPlayer(slot.label, p.fantasyPosition));
    if (match) { used.add(match.id); return match; }
    return null;
  });
}

export function slotGroup(slot: RosterSlot): string {
  if (slot.section === 'bench') return 'BN';
  return slot.label;
}
