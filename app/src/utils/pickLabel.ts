export function formatPickLabel(
  seasonYear: number,
  roundNumber: number,
  originalTeamName?: string | null,
): string {
  const base = `${seasonYear} Round ${roundNumber}`;
  if (originalTeamName) {
    return `${base} — originally ${originalTeamName}`;
  }
  return base;
}

export function formatPickLabelShort(
  seasonYear: number,
  roundNumber: number,
  originalTeamName?: string | null,
): string {
  const base = `${seasonYear} Rd ${roundNumber}`;
  if (originalTeamName) {
    return `${base} (${originalTeamName})`;
  }
  return base;
}
