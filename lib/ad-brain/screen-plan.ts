// What the screen robot captures and which captures an ad may use (docs/AD_BRAIN.md, section 7). Pure.
//   - The pages: Home, Posts, Calendar, Autopilot, Designs, Photos, and Leads only when there are leads.
//   - Each at phone (390x844 @3x) and desktop (1512x900).
//   - A page whose data is empty would mislead ("0 leads", an empty calendar): it is not shown in ads.
//   - Captures older than 24 hours are taken again before the next ad (or at once from Admin -> Ad Brain).

export type ScreenPageId = "home" | "posts" | "calendar" | "autopilot" | "designs" | "photos" | "leads";
export type ScreenViewport = "phone" | "desktop";

export const SCREEN_PAGES: readonly { id: ScreenPageId; path: string; label: string }[] = [
  { id: "home", path: "/dashboard", label: "Home" },
  { id: "posts", path: "/dashboard/content", label: "Posts" },
  { id: "calendar", path: "/dashboard/calendar", label: "Calendar" },
  { id: "autopilot", path: "/dashboard/autopilot", label: "Autopilot" },
  { id: "designs", path: "/dashboard/designs", label: "Designs" },
  { id: "photos", path: "/dashboard/gallery", label: "Photos" },
  { id: "leads", path: "/dashboard/leads", label: "Leads" },
];
export const SCREEN_VIEWPORTS: readonly ScreenViewport[] = ["phone", "desktop"];

/** Captures are taken again when the newest is older than this. */
export const SCREENS_FRESH_MS = 24 * 60 * 60 * 1000;

/** How much real data each page has (from the database, at capture time). */
export type PageCounts = Record<ScreenPageId, number>;

/** The pages worth opening: every page except Leads when there are none (never capture "0 leads"). */
export function pagesToCapture(counts: PageCounts) {
  return SCREEN_PAGES.filter((p) => p.id !== "leads" || counts.leads > 0);
}

/** A page whose data is empty, which would mislead in an ad. Home always has something to show. */
export const isEmptyPage = (id: ScreenPageId, counts: PageCounts) => id !== "home" && (counts[id] ?? 0) <= 0;

/** True when the captures must be taken again (none yet, or the newest is 24 h old). */
export const screensStale = (newest: Date | null, now = new Date()) => !newest || now.getTime() - newest.getTime() >= SCREENS_FRESH_MS;

export type StoredCapture = { id: string; key: string; page: string; viewport: string; capturedAt: string; empty: boolean; createdAt: Date };

/**
 * The captures an ad may use: for each page and size, the newest one, unless its page was empty when it was taken.
 * Fixture captures (the 10 Nov prototype) only when no robot capture exists and `allowFixtures` (tests and dev).
 */
export function currentCaptures<T extends StoredCapture & { provider: string }>(rows: T[], allowFixtures: boolean): T[] {
  const robot = rows.filter((r) => r.provider === "robot");
  if (robot.length === 0) return allowFixtures ? rows.filter((r) => r.provider !== "robot") : [];
  const newest = new Map<string, T>();
  for (const r of robot) {
    const key = `${r.page}-${r.viewport}`;
    const had = newest.get(key);
    if (!had || r.createdAt > had.createdAt) newest.set(key, r);
  }
  return [...newest.values()].filter((r) => !r.empty);
}
