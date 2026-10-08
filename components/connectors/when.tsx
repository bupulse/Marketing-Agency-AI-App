/** A date in the viewer's own time zone. Server and browser can disagree on the zone, so the mismatch is allowed. */
export function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}
