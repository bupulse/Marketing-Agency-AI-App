// A published post's results (views, likes, comments, shares) as the post itself shows them: the badge on calendar
// cards and the Results part of the post detail. Pure and client-safe. lib/publishing/results-query.ts fills them for
// a page in one query; the hourly metrics job (lib/publishing/metrics.ts) collects them from the networks.
import type { FeatureKey } from "@/lib/features";
import type { Network } from "@/lib/social/types";

/**
 * The plan rule for per-post results, in one place. They are basic feedback on what BuPulse published, so every plan
 * that can publish (the "calendar" feature) shows them on the post itself. The full Analytics page (totals, trend,
 * best posts, results by network) stays behind the "analytics" feature (app/dashboard/analytics/page.tsx).
 * To make per-post results an Analytics extra instead, set this to "analytics". The metrics job collects for every
 * publishing business either way, so a company sees its results the day its plan gains them.
 */
export const POST_RESULTS_FEATURE: FeatureKey = "calendar";

/** Results are read for this many days after publishing; the metrics job stops after that. */
export const RESULTS_DAYS = 30;

/**
 * Networks whose post results BuPulse can read, and for which account types ("all": every type). Matches the
 * providers that have `metrics` (tests/publishing/results.test.ts checks).
 */
export const RESULTS_ACCOUNT_TYPES: Partial<Record<Network, "all" | readonly string[]>> = {
  instagram: "all",
  facebook: "all",
  youtube: "all",
  // Statistics of a member's own posts need a permission LinkedIn keeps for approved partners: company pages only.
  linkedin: ["organization"],
  // Through BuPulse-Socials only (SOCIALS_ONLY_RESULTS). TikTok: once the video is public and passed TikTok's checks.
  tiktok: "all",
  twitter: "all",
};

/**
 * Accounts connected through BuPulse-Socials (Composio) share fewer results: Facebook likes, comments and shares and
 * Instagram likes and comments; TikTok views, likes, comments and shares; X views, likes, replies, reposts and saves.
 * LinkedIn and YouTube there have no metrics (lib/social/composio/networks.ts).
 */
export const SOCIALS_RESULTS: readonly Network[] = ["facebook", "instagram", "tiktok", "twitter"];
/** Networks whose results only BuPulse-Socials reads (BuPulse's own TikTok app has no metrics; X has no app of its own). */
export const SOCIALS_ONLY_RESULTS: readonly Network[] = ["tiktok", "twitter"];

/** Whether the network shares post results for this kind of account (and the way it was connected). */
export function sharesResults(network: string, accountType: string | null | undefined, method?: string | null): boolean {
  if (method === "COMPOSIO" && !SOCIALS_RESULTS.includes(network as Network)) return false;
  if (method !== "COMPOSIO" && SOCIALS_ONLY_RESULTS.includes(network as Network)) return false;
  const types = RESULTS_ACCOUNT_TYPES[network as Network];
  return types === "all" || Boolean(types && accountType && types.includes(accountType));
}

export type ResultKey = "views" | "reach" | "likes" | "comments" | "shares" | "saves";
export type ResultCounts = Record<ResultKey, number | null>;

/**
 * What a published post shows about its results:
 * - ready: the numbers of its newest snapshot, taken at `updatedAt`; `stale` says why they no longer update
 * - waiting: none yet; they arrive within a day of publishing
 * - unsupported: the network (or this kind of account) does not share results; `via: "socials"` when it is the
 *   BuPulse-Socials connection that cannot read them
 * - by_hand: the owner posted it ("Post it yourself" reminders), so there is no post for BuPulse to read
 * - reconnect: the account must be reconnected before results can be read
 * - disconnected: the account was removed from BuPulse
 * - none: nothing came in (the network sent no numbers, or the post is past the results window)
 */
export type PostResults =
  | ({ state: "ready"; updatedAt: string; stale: "reconnect" | "disconnected" | "final" | null } & ResultCounts)
  | { state: "waiting" | "unsupported" | "by_hand" | "reconnect" | "disconnected" | "none" }
  | { state: "unsupported"; via: "socials" };

/** The post fields the results depend on. */
export type ResultsPost = {
  status: string;
  network: string;
  externalId: string | null;
  publishedAt: Date | null;
  remindOnly: boolean;
  connection: { postingMode: string; accountType: string | null; status: string; method?: string | null } | null;
};

export type ResultsSnapshot = ResultCounts & { capturedAt: Date };

const RESULT_KEYS: readonly ResultKey[] = ["views", "reach", "likes", "comments", "shares", "saves"];
const MUST_RECONNECT = new Set(["EXPIRED", "REVOKED"]);
const DAY_MS = 24 * 60 * 60 * 1000;

const hasNumbers = (s: ResultCounts) => RESULT_KEYS.some((k) => s[k] !== null);

/** A published post's results from its newest snapshot (null when it has none); null for posts not published. */
export function postResults(post: ResultsPost, latest: ResultsSnapshot | null, now: Date): PostResults | null {
  if (post.status !== "PUBLISHED") return null;
  const c = post.connection;
  const pastWindow = post.publishedAt !== null && now.getTime() - post.publishedAt.getTime() > RESULTS_DAYS * DAY_MS;
  if (latest && hasNumbers(latest)) {
    const stale = !c ? "disconnected" : MUST_RECONNECT.has(c.status) ? "reconnect" : pastWindow ? "final" : null;
    const counts = Object.fromEntries(RESULT_KEYS.map((k) => [k, latest[k]])) as ResultCounts;
    return { state: "ready", updatedAt: latest.capturedAt.toISOString(), stale, ...counts };
  }
  if (c?.postingMode === "NOTIFY" || (!c && post.remindOnly) || !post.externalId) return { state: "by_hand" };
  if (!c) return { state: "disconnected" };
  if (!sharesResults(post.network, c.accountType, c.method)) return c.method === "COMPOSIO" && !SOCIALS_RESULTS.includes(post.network as Network) ? { state: "unsupported", via: "socials" } : { state: "unsupported" };
  if (MUST_RECONNECT.has(c.status)) return { state: "reconnect" };
  if (latest || pastWindow) return { state: "none" };
  return { state: "waiting" };
}

const LABEL: Record<ResultKey, [string, string]> = {
  views: ["view", "views"],
  reach: ["person reached", "people reached"],
  likes: ["like", "likes"],
  comments: ["comment", "comments"],
  shares: ["share", "shares"],
  saves: ["save", "saves"],
};

export const resultLabel = (key: ResultKey, value: number) => LABEL[key][value === 1 ? 0 : 1];

/** The numbers the network gave, in display order (unknown ones left out). */
export function knownResults(r: ResultCounts): { key: ResultKey; value: number }[] {
  return RESULT_KEYS.flatMap((key) => (r[key] === null ? [] : [{ key, value: r[key] as number }]));
}

/** The calendar badge: views (reach when the network gives no views), likes and comments, where known. */
export function badgeResults(r: ResultCounts): { key: ResultKey; value: number }[] {
  const seen: ResultKey = r.views !== null ? "views" : "reach";
  return (
    [
      [seen, r[seen]],
      ["likes", r.likes],
      ["comments", r.comments],
    ] as const
  ).flatMap(([key, value]) => (value === null ? [] : [{ key, value }]));
}

/** One line on why there are no numbers (or why they stopped updating); null when there is nothing to say. */
export function resultsNote(results: PostResults, network: string, label: string): string | null {
  switch (results.state) {
    case "ready":
      if (results.stale === "reconnect") return `Not updating: ${label} needs to be reconnected.`;
      if (results.stale === "disconnected") return `Not updating: this ${label} account was disconnected.`;
      if (results.stale === "final") return `Final results: BuPulse reads them for ${RESULTS_DAYS} days after publishing.`;
      return null;
    case "waiting":
      return "Results appear within a day of publishing.";
    case "unsupported":
      if ("via" in results) return `${label} accounts connected through BuPulse-Socials don't share post results with BuPulse yet.`;
      return network === "linkedin" ? "LinkedIn shares results for company pages only, not personal profiles." : `${label} doesn't share post results with BuPulse.`;
    case "by_hand":
      return `You posted this yourself ("Post it yourself" mode), so BuPulse can't read its results. Check them on ${label}.`;
    case "reconnect":
      return `${label} needs to be reconnected before BuPulse can read this post's results.`;
    case "disconnected":
      return `This ${label} account was disconnected, so BuPulse no longer reads its results.`;
    case "none":
      return `${label} sent no results for this post.`;
  }
}
