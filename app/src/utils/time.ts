export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `expires in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `expires in ${h}h`;
  const d = Math.floor(h / 24);
  return `expires in ${d}d`;
}
