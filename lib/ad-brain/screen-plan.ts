// What the screen robot captures and which captures an ad may use (docs/AD_BRAIN.md, section 7). Pure.
//   - The pages: Home, Posts, Calendar, Autopilot, Designs, Photos, and Leads only when there are leads.
//   - Each at phone (390x844 @3x) and desktop (1512x900).
//   - A page whose data is empty would mislead ("0 leads", an empty calendar): it is not shown in ads.
//   - Captures older than 24 hours are taken again before the next ad (or at once from Admin -> Ad Brain).

import { appUrl, frontOrigin, marketingAppPath } from "@/lib/platform/app-hosts";

export type ScreenPageId = "home" | "posts" | "calendar" | "autopilot" | "designs" | "photos" | "leads";
export type ScreenViewport = "phone" | "desktop";

/**
 * The pages by the address clients see on the Marketing host (marketing.bupulse.com/content, docs/HOSTS.md). The robot
 * opens the same page by its app path on this server's own loopback address (robotPath: /content -> /dashboard/content),
 * because the pass only works there; the ad's browser bar shows the real address (shownAddress).
 */
export const SCREEN_PAGES: readonly { id: ScreenPageId; path: string; label: string }[] = [
  { id: "home", path: "/", label: "Home" },
  { id: "posts", path: "/content", label: "Posts" },
  { id: "calendar", path: "/calendar", label: "Calendar" },
  { id: "autopilot", path: "/autopilot", label: "Autopilot" },
  { id: "designs", path: "/designs", label: "Designs" },
  { id: "photos", path: "/gallery", label: "Photos" },
  { id: "leads", path: "/leads", label: "Leads" },
];

/** The app path the robot opens on loopback for a clean Marketing address (always under /dashboard). */
export const robotPath = (clean: string) => marketingAppPath(clean);

/**
 * The page's address as clients see it, for the browser bar in an ad: "marketing.bupulse.com/content" once the
 * Marketing host is set, else the front host and the app path ("bupulse.com/dashboard/content").
 */
export function shownAddress(clean: string, env: Record<string, string | undefined> = process.env): string {
  const url = appUrl(robotPath(clean), frontOrigin(env), env);
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
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
