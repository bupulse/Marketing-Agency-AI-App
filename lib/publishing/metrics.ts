import "server-only";
import { disabledNetworks } from "@/lib/admin/switch";
import { prisma } from "@/lib/db";
import { timeBudget } from "@/lib/platform/limits";
import { logError } from "@/lib/errors";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { loadCredentials, markConnectionError } from "@/lib/social/connections";
import { SocialError } from "@/lib/social/types";
import { RESULTS_ACCOUNT_TYPES, RESULTS_DAYS } from "./results";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Posts newer than this are tracked; older ones stop being measured. */
export const METRICS_DAYS = RESULTS_DAYS;
/** A post measured within this long ago is skipped, so a repeated run does not hit the networks twice. */
const FRESH_HOURS = 20;
const MAX_POSTS_PER_RUN = 150;
/**
 * Posts of one account read per run. Instagram takes five calls per post, so one busy account's posts are spread
 * over several hourly runs instead of bursting its hourly per-account call limit.
 */
export const MAX_POSTS_PER_ACCOUNT = 25;
const PAUSE_MS = 250;

/** Only networks and account types that share results, so posts that can never have any do not take a run's places. */
const readableNetworks = () =>
  Object.entries(RESULTS_ACCOUNT_TYPES).map(([network, types]) => (types === "all" ? { network } : { network, connection: { accountType: { in: [...types] } } }));

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
      OR: readableNetworks(),
      metrics: { none: { capturedAt: { gte: new Date(now.getTime() - FRESH_HOURS * 60 * 60_000) } } },
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
      const snapshot = await provider.metrics(await loadCredentials(post.connectionId), post.externalId);
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
