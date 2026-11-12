// Admin -> Settings, split into small pages (10 Nov 2026 redesign): one page per settings area under
// /admin/settings/<slug>. Pure (no React, no database): the hub, the area pages, the server actions and the
// old-anchor redirect all read it. Tests: tests/admin-system/settings-areas.test.ts.

export const SETTINGS_BASE = "/admin/settings";

export const SETTINGS_SLUGS = ["momo", "paddle", "vat", "currency", "goal", "content", "voices", "lead-alerts", "google-calendar", "calls", "availability", "trial", "loading"] as const;
export type SettingsSlug = (typeof SETTINGS_SLUGS)[number];

export const isSettingsSlug = (v: unknown): v is SettingsSlug => typeof v === "string" && (SETTINGS_SLUGS as readonly string[]).includes(v);

export const settingsHref = (slug: SettingsSlug, anchor?: string) => `${SETTINGS_BASE}/${slug}${anchor ? `#${anchor}` : ""}`;

/** The page titles (the hub's cards and each page's header and tab title). */
export const SETTINGS_TITLE: Record<SettingsSlug, string> = {
  momo: "Mobile Money",
  paddle: "Card payments (Paddle)",
  vat: "VAT (Rwanda)",
  currency: "Card prices and currency",
  goal: "Revenue goal",
  content: "Daily posts and videos",
  voices: "Kinyarwanda and Swahili voices",
  "lead-alerts": "Lead alerts on Telegram",
  "google-calendar": "Google Calendar",
  calls: "Demo calls",
  availability: "When clients can book you",
  trial: "Free trial",
  loading: "Loading animation",
};

/**
 * The old one-page Settings had a panel per #anchor; links and bookmarks to them (Payments, Plans, Demos, Revenue,
 * Google's sign-in callback, the Mobile Money save) now open the page that holds that panel.
 */
export const OLD_SETTINGS_ANCHORS: Record<string, string> = {
  currency: settingsHref("currency"),
  momo: settingsHref("momo"),
  paddle: settingsHref("paddle"),
  goal: settingsHref("goal"),
  "daily-posts": settingsHref("content", "daily-posts"),
  "skit-videos": settingsHref("content", "skit-videos"),
  "first-post-preview": settingsHref("content", "first-post-preview"),
  "language-voices": settingsHref("voices"),
  "lead-alerts": settingsHref("lead-alerts"),
  "google-calendar": settingsHref("google-calendar"),
  availability: settingsHref("availability"),
};

/**
 * Where an old `#anchor` link should go, keeping the query (`?notice=` / `?error=` from a save). `routes` maps an
 * anchor (without #) to a path that may carry its own #anchor. Null when the anchor is not an old one.
 */
export function hashTarget(routes: Record<string, string>, hash: string, search = ""): string | null {
  const key = decodeURIComponent(hash.replace(/^#/, ""));
  if (!key || !Object.hasOwn(routes, key)) return null;
  const to = routes[key];
  const at = to.indexOf("#");
  const path = at === -1 ? to : to.slice(0, at);
  const anchor = at === -1 ? "" : to.slice(at);
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${path}${query}${anchor}`;
}

/**
 * The page a "Save" of the shared settings form returns to, from the fields the form carries (each area's form has
 * its own fields), so the notice shows on the page the owner was on. Unknown forms go back to the hub.
 */
export function settingsBackFor(has: (field: string) => boolean): string {
  if (has("dailyPanel")) return settingsHref("content", "daily-posts");
  if (has("skitPanel")) return settingsHref("content", "skit-videos");
  if (has("previewPanel")) return settingsHref("content", "first-post-preview");
  if (has("vatPanel") || has("vatRatePercent") || has("vatTin")) return settingsHref("vat");
  if (has("currencyPanel") || has("usdToRwf") || has("cardMarginPercent") || has("displayCurrency") || has("usdToEur")) return settingsHref("currency");
  if (has("revenueGoalRwf") || has("goalStartMonth")) return settingsHref("goal");
  if (has("meetingLink") || has("organizerEmail") || has("slotMinutes") || has("bufferMinutes") || has("demoDailyCap") || has("blockedDates")) return settingsHref("calls");
  if (has("trialDays")) return settingsHref("trial");
  if (has("pageLoader")) return settingsHref("loading");
  return SETTINGS_BASE;
}
