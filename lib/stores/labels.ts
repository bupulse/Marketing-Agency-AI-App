/** "Last synced 5 minutes ago" for the connector card; no database or network. */
export function relativeSync(date: Date | null | undefined, now = Date.now()): string {
  if (!date) return "Not synced yet";
  const minutes = Math.max(0, Math.round((now - date.getTime()) / 60_000));
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Last synced ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Last synced ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `Last synced ${Math.round(hours / 24)} days ago`;
}
