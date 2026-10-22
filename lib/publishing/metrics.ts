import "server-only";
import { disabledNetworks } from "@/lib/admin/switch";
import { prisma } from "@/lib/db";
import { timeBudget } from "@/lib/platform/limits";
import { logError } from "@/lib/errors";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { loadCredentials, markConnectionError } from "@/lib/social/connections";
import { SocialError, type Network } from "@/lib/social/types";
import { RESULTS_ACCOUNT_TYPES, RESULTS_DAYS, SOCIALS_ONLY_RESULTS } from "./results";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Posts newer than this are tracked; older ones stop being measured. */
export const METRICS_DAYS = RESULTS_DAYS;
/** A post measured within this long ago is skipped, so a repeated run does not hit the networks twice. */
const FRESH_HOURS = 20;
/**
 * Networks read less often: X charges BuPulse for every post read (docs/guide/features/13-social-connections.md), so an
 * X post is read about once a week (days 1, 8, 15, 22 and 29), not every day.
 */
export const FRESH_HOURS_BY_NETWORK: Partial<Record<Network, number>> = { twitter: 7 * 24 - 4 };
const MAX_POSTS_PER_RUN = 150;
/**
 * Posts of one account read per run. Instagram takes five calls per post, so one busy account's posts are spread
 * over several hourly runs instead of bursting its hourly per-account call limit.
 */
export const MAX_POSTS_PER_ACCOUNT = 25;
const PAUSE_MS = 250;

/**
 * Only networks and account types that share results (TikTok and X: accounts connected through BuPulse-Socials), so
 * posts that can never have any do not take a run's places; each with how long ago its last reading may be.
 */
const readableNetworks = (now: Date) =>
  Object.entries(RESULTS_ACCOUNT_TYPES).map(([network, types]) => {
    const fresh = { metrics: { none: { capturedAt: { gte: new Date(now.getTime() - (FRESH_HOURS_BY_NETWORK[network as Network] ?? FRESH_HOURS) * 60 * 60_000) } } } };
    const method = SOCIALS_ONLY_RESULTS.includes(network as Network) ? { method: "COMPOSIO" as const } : {};
    if (types === "all") return Object.keys(method).length ? { network, connection: method, ...fresh } : { network, ...fresh };
    return { network, connection: { accountType: { in: [...types] }, ...method }, ...fresh };
  });

/** Netlify stops a function at 60 s, so the run stops sooner there; the next hourly run does the rest. */
const timeBudgetMs = () => timeBudget(45_000, 30_000);

export type MetricsRunResult = { checked: number; saved: number; skipped: number; failed: number };

/**
 * Hourly: for posts published in the last 30 days, asks the network for views, likes and so on and stores a
 * PostMetrics row (each post at most once every 20 hours). Every publishing business is read, whatever its plan:
 * per-post results show on every plan that publishes (POST_RESULTS_FEATURE in lib/publishing/results.ts).
 * Throttled (a pause between calls, caps per run and per account, a time budget); one bad post never stops the run.
 * Accounts that must be reconnected are left out until they are, and one that fails sign-in mid-run is marked so.
 */
export async function collectMetrics(now = new Date(), options: { limit?: number; budgetMs?: number; pauseMs?: number } = {}): Promise<MetricsRunResult> {
  const result: MetricsRunResult = { checked: 0, saved: 0, skipped: 0, failed: 0 };
  const deadline = Date.now() + (options.budgetMs ?? timeBudgetMs());
  // Networks switched off in the admin console are skipped (their tokens and posts are left alone).
  const paused = await disabledNetworks();
  const posts = await prisma.post.findMany({
    where: {
      ...(paused.length ? { network: { notIn: paused } } : {}),
      status: "PUBLISHED",
      externalId: { not: null },
      connectionId: { not: null },
      publishedAt: { gte: new Date(now.getTime() - METRICS_DAYS * DAY_MS) },
      connection: { postingMode: "AUTO", status: { notIn: ["EXPIRED", "REVOKED"] } },
      OR: readableNetworks(now),
    },
    orderBy: { publishedAt: "desc" },
    take: options.limit ?? MAX_POSTS_PER_RUN,
    select: { id: true, network: true, externalId: true, connectionId: true, businessId: true },
  });

  const stoppedConnections = new Set<string>();
  const perAccount = new Map<string, number>();
  for (const post of posts) {
    if (Date.now() > deadline) break;
    if (!isNetwork(post.network) || !post.externalId || !post.connectionId || stoppedConnections.has(post.connectionId) || (perAccount.get(post.connectionId) ?? 0) >= MAX_POSTS_PER_ACCOUNT) {
      result.skipped++;
      continue;
    }
    const provider = getProvider(post.network);
    if (!provider.metrics) {
      result.skipped++;
      continue;
    }
    result.checked++;
    perAccount.set(post.connectionId, (perAccount.get(post.connectionId) ?? 0) + 1);
    try {
      const { resolved, ...snapshot } = await provider.metrics(await loadCredentials(post.connectionId), post.externalId);
      // Publishing gave a temporary id (TikTok's publish id): the post keeps the lasting one and its link from now on.
      if (resolved) await prisma.post.update({ where: { id: post.id }, data: { externalId: resolved.externalId, ...(resolved.permalink ? { permalink: resolved.permalink } : {}) } });
      // An account connected a way that cannot read numbers (e.g. a BuPulse-Socials LinkedIn profile) has nothing to save.
      if (Object.values(snapshot).every((v) => v === undefined)) {
        result.skipped++;
        continue;
      }
      await prisma.postMetrics.create({
        data: { postId: post.id, capturedAt: now, views: snapshot.views, reach: snapshot.reach, likes: snapshot.likes, comments: snapshot.comments, saves: snapshot.saves, shares: snapshot.shares },
      });
      result.saved++;
    } catch (error) {
      result.failed++;
      if (error instanceof SocialError && error.kind === "auth") {
        // The account needs reconnecting: stop asking for its other posts this run.
        stoppedConnections.add(post.connectionId);
        await markConnectionError(post.connectionId, error).catch(() => {});
      } else if (error instanceof SocialError && error.kind === "rate_limit") {
        stoppedConnections.add(post.connectionId);
      } else {
        await logError(error, { source: "publishing.metrics", level: "warn", businessId: post.businessId, postId: post.id });
      }
    }
    await new Promise((r) => setTimeout(r, options.pauseMs ?? PAUSE_MS));
  }
  return result;
}
