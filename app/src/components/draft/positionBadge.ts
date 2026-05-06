export function positionBadgeBg(pos: string | null): string {
  switch (pos) {
    case 'QB':  return '#1e3a8a';
    case 'RB':  return '#14532d';
    case 'WR':  return '#713f12';
    case 'TE':  return '#7c2d12';
    case 'K':   return '#3b0764';
    case 'DST': return '#450a0a';
    default:    return '#1e293b';
  }
}

export function positionBadgeColor(pos: string | null): string {
  switch (pos) {
    case 'QB':  return '#93c5fd';
    case 'RB':  return '#86efac';
    case 'WR':  return '#fde68a';
    case 'TE':  return '#fdba74';
    case 'K':   return '#d8b4fe';
    case 'DST': return '#fca5a5';
    default:    return '#94a3b8';
  }
}
