export function getSeasonLabel(sport: string, date: Date = new Date()): string {
  const currentYear = date.getFullYear();
  const currentMonth = date.getMonth() + 1;

  const seasonStartMonth = sport === 'basketball' ? 10 : 9;

  if (currentMonth >= seasonStartMonth) {
    const nextYear = currentYear + 1;
    return `${currentYear}-${nextYear.toString().slice(-2)}`;
  } else {
    const prevYear = currentYear - 1;
    return `${prevYear}-${currentYear.toString().slice(-2)}`;
  }
}
