import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { loadCredentials, markConnectionError } from "@/lib/social/connections";
import { SocialError } from "@/lib/social/types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Posts newer than this are tracked; older ones stop being measured. */
export const METRICS_DAYS = 30;
/** A post measured within this long ago is skipped, so a repeated run does not hit the networks twice. */
const FRESH_HOURS = 20;
const MAX_POSTS_PER_RUN = 150;
const PAUSE_MS = 250;
const TIME_BUDGET_MS = 45_000;

export type MetricsRunResult = { checked: number; saved: number; skipped: number; failed: number };

/**
 * Daily: for posts published in the last 30 days, asks the network for views, likes and so on and stores a
 * PostMetrics row. Throttled (a pause between calls, a cap and a time budget); one bad post never stops the run.
 */
export async function collectMetrics(now = new Date(), options: { limit?: number; budgetMs?: number; pauseMs?: number } = {}): Promise<MetricsRunResult> {
  const result: MetricsRunResult = { checked: 0, saved: 0, skipped: 0, failed: 0 };
  const deadline = Date.now() + (options.budgetMs ?? TIME_BUDGET_MS);
  const posts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      externalId: { not: null },
      connectionId: { not: null },
      publishedAt: { gte: new Date(now.getTime() - METRICS_DAYS * DAY_MS) },
      connection: { postingMode: "AUTO" },
      metrics: { none: { capturedAt: { gte: new Date(now.getTime() - FRESH_HOURS * 60 * 60_000) } } },
    },
    orderBy: { publishedAt: "desc" },
    take: options.limit ?? MAX_POSTS_PER_RUN,
    select: { id: true, network: true, externalId: true, connectionId: true, businessId: true },
  });

  const stoppedConnections = new Set<string>();
  for (const post of posts) {
    if (Date.now() > deadline) break;
    if (!isNetwork(post.network) || !post.externalId || !post.connectionId || stoppedConnections.has(post.connectionId)) {
      result.skipped++;
      continue;
    }
    const provider = getProvider(post.network);
    if (!provider.metrics) {
      result.skipped++;
      continue;
    }
    result.checked++;
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
