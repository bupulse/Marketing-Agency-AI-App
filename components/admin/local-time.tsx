"use client";

/** A saved UTC time shown in the viewer's own timezone. The server renders UTC; the browser swaps it in. */
export function LocalTime({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

/** Hidden field holding the browser's UTC offset in minutes; filled in on the client so the server HTML stays stable. */
export function TimezoneField() {
  return <input type="hidden" name="tz" ref={(el) => { if (el) el.value = String(new Date().getTimezoneOffset()); }} />;
}
