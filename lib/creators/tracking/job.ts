import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { pollLimit } from "@/lib/social/inbox/budget";
import { getInboxSettings } from "@/lib/social/inbox/settings";
import { composioReady } from "@/lib/social/inbox/transport";
import { timeBudget } from "@/lib/platform/limits";
import { SocialError } from "@/lib/social/types";
import { composioCreatorId } from "../auth";
import { isCreatorNetwork, NETWORK_LABEL, type CreatorNetwork } from "../describe";
import { creatorAdapter } from "./adapters";
import { BudgetError, composioCaller } from "./caller";
import { closePeriod } from "./close";
import { cleanupMedia } from "./cleanup";
import { nextReadAt, numbersOf, sameNumbers, type Numbers } from "./numbers";
import { notifyPayouts, notifyReconnect, notifyRemoved } from "./notify";
import { removePost } from "./removal";
import { resolvePosts, type ResolveDeps } from "./resolve";
import type { Caller, CreatorAdapter } from "./types";

// The 6-hourly creator views job (/api/cron/creator-views, docs/CREATOR_CAMPAIGNS.md "Reading views"), in this order:
//   1. periods whose end has passed: their final reading (stored at the period's end, so it is both that period's end
//      and the next one's start), then the close and the payouts;
//   2. links handed in that could not be checked yet;
//   3. tracked posts due for a reading, per connected account (one list call reads many posts);
//   4. posts on accounts disconnected for over 3 days: REMOVED;
//   5. handed-in files 60 days after their campaign ended.
// Each Composio call is reserved against the month's limit first; when it runs out the job stops early, without
// failing, and the next run goes on. The answer has `nextCursor` while work is left and time ran out.

const HOUR = 60 * 60 * 1000;
/** A reading this close to its time is taken now: the next run is 6 hours away. */
const DUE_MARGIN_MS = 30 * 60 * 1000;
/** A period closes without its final reading when that reading could not be taken for this long. */
export const CLOSE_WAIT_MS = 24 * HOUR;
/** A post not found on the account is REMOVED only when a second reading at least this much later misses it too. */
export const MISSING_CONFIRM_MS = 6 * HOUR;
/** Posts on an account that cannot be read (signed out, removed) are REMOVED after this long (owner decision). */
export const DISCONNECTED_MS = 3 * 24 * HOUR;
/** A post or account that could not be read is tried again after this long. */
const RETRY_MS = HOUR;
/** Campaigns whose posts are read: their periods still run (an ENDED campaign closes the periods it has). */
const READ_STATUSES = ["LIVE", "PAUSED", "ENDED"];

export type JobDeps = {
  adapter: (network: CreatorNetwork) => CreatorAdapter;
  caller: (connection: { network: string; composioConnectedAccountId: string; profileId: string }, limit: number) => Caller;
  ready: () => Promise<boolean>;
  limit: () => Promise<number>;
  notify: boolean;
};

const defaultDeps: JobDeps = {
  adapter: creatorAdapter,
  caller: (c, limit) => composioCaller(c.network as CreatorNetwork, c.composioConnectedAccountId, composioCreatorId(c.profileId), limit),
  ready: composioReady,
  limit: async () => pollLimit((await getInboxSettings()).monthlyCap),
  notify: true,
};

export type JobResult = {
  ok: true;
  composio: boolean;
  closed: number;
  checked: number;
  read: number;
  snapshots: number;
  removed: number;
  mediaDeleted: number;
  limited: boolean;
  nextCursor: string | null;
};

type PostRow = { id: string; externalId: string | null; postedAt: Date | null; checks: Prisma.JsonValue; views: number; impressions: number; likes: number; comments: number; shares: number };
type ConnectionRow = { id: string; network: string; status: string; composioConnectedAccountId: string; externalAccountId: string; profileId: string };

const POST_SELECT = { id: true, externalId: true, postedAt: true, checks: true, views: true, impressions: true, likes: true, comments: true, shares: true } as const;

type Ctx = { deps: JobDeps; limit: number; now: Date; removed: { postId: string; reason: string }[]; result: JobResult };

/**
 * Reads these tracked posts of one connected account and stores what changed. `capturedAt`: the time the snapshots
 * stand for (a period's end for its final reading). Returns false when the account could not be read.
 */
async function readAccount(ctx: Ctx, connection: ConnectionRow, posts: PostRow[], capturedAt: Date): Promise<boolean> {
  const { now } = ctx;
  if (!isCreatorNetwork(connection.network) || connection.status !== "ACTIVE") return false;
  const network = connection.network;
  let result;
  try {
    result = await ctx.deps.adapter(network).read(
      ctx.deps.caller(connection, ctx.limit),
      { network, externalAccountId: connection.externalAccountId },
      posts.filter((p) => p.externalId).map((p) => ({ externalId: p.externalId!, postedAt: p.postedAt })),
    );
  } catch (error) {
    if (error instanceof BudgetError) throw error;
    if (error instanceof SocialError && error.kind === "auth") {
      // Signed out on the network: the creator is told once; DISCONNECTED_MS later the posts stop earning.
      const flipped = await prisma.creatorConnection.updateMany({ where: { id: connection.id, status: "ACTIVE" }, data: { status: "EXPIRED", lastError: error.message.slice(0, 300) } });
      if (flipped.count && ctx.deps.notify) await notifyReconnect(connection.id).catch(() => false);
    } else {
      await prisma.creatorConnection.update({ where: { id: connection.id }, data: { lastError: (error instanceof Error ? error.message : String(error)).slice(0, 300) } });
      if (!(error instanceof SocialError)) await logError(error, { source: "creators.read", network });
    }
    return false;
  }
  await prisma.creatorConnection.update({ where: { id: connection.id }, data: { lastCheckedAt: now, lastError: null } });

  const gone = new Set(result.gone);
  for (const post of posts) {
    const found = post.externalId ? result.found.get(post.externalId) : undefined;
    const checks = (post.checks && typeof post.checks === "object" && !Array.isArray(post.checks) ? post.checks : {}) as Record<string, unknown>;
    if (found) {
      const previous: Numbers = { views: post.views, impressions: post.impressions, likes: post.likes, comments: post.comments, shares: post.shares };
      const numbers = numbersOf(found, previous);
      const changed = !sameNumbers(numbers, previous);
      const kept = { ...checks };
      delete kept.missingSince;
      await prisma.$transaction([
        ...(changed ? [prisma.creatorPostSnapshot.create({ data: { postId: post.id, capturedAt, ...numbers } })] : []),
        prisma.creatorPost.update({ where: { id: post.id }, data: { ...numbers, lastReadAt: now, nextReadAt: nextReadAt(post.postedAt, now), ...("missingSince" in checks ? { checks: kept as Prisma.InputJsonValue } : {}) } }),
      ]);
      ctx.result.read++;
      if (changed) ctx.result.snapshots++;
      continue;
    }
    if (gone.has(post.externalId ?? "")) {
      const since = typeof checks.missingSince === "string" ? Date.parse(checks.missingSince) : NaN;
      if (Number.isFinite(since) && now.getTime() - since >= MISSING_CONFIRM_MS) {
        const reason = `This post is no longer on your ${NETWORK_LABEL[network]} (deleted, hidden or private), so it stopped earning.`;
        if (await removePost(post.id, reason, now)) {
          ctx.removed.push({ postId: post.id, reason });
          ctx.result.removed++;
        }
        continue;
      }
      // First miss: looked at again in 6 hours before anything is taken away (a network can answer short for a while).
      await prisma.creatorPost.update({
        where: { id: post.id },
        data: { lastReadAt: now, nextReadAt: new Date(now.getTime() + MISSING_CONFIRM_MS), checks: { ...checks, missingSince: Number.isFinite(since) ? checks.missingSince : now.toISOString() } as Prisma.InputJsonValue },
      });
      continue;
    }
    // Not reached this time (more posts than one reading covers): next run.
    await prisma.creatorPost.update({ where: { id: post.id }, data: { nextReadAt: new Date(now.getTime() + RETRY_MS) } });
  }
  return true;
}

/**
 * Reads posts grouped by their connected account, until `deadline`. Returns the ids of the posts it did not read; those
 * whose account could not be read (signed out, the network failing) are looked at again in an hour, not at once.
 */
async function readPosts(ctx: Ctx, posts: (PostRow & { connectionId: string | null })[], capturedAt: Date, deadline: number): Promise<string[]> {
  const byConnection = new Map<string, typeof posts>();
  const failed: string[] = posts.filter((p) => !p.connectionId).map((p) => p.id);
  const skipped: string[] = [];
  for (const p of posts) if (p.connectionId) byConnection.set(p.connectionId, [...(byConnection.get(p.connectionId) ?? []), p]);
  const connections = await prisma.creatorConnection.findMany({ where: { id: { in: [...byConnection.keys()] } }, select: { id: true, network: true, status: true, composioConnectedAccountId: true, externalAccountId: true, profileId: true } });
  for (const connection of connections) {
    const ids = byConnection.get(connection.id)!.map((p) => p.id);
    if (Date.now() > deadline) skipped.push(...ids);
    else if (!(await readAccount(ctx, connection, byConnection.get(connection.id)!, capturedAt))) failed.push(...ids);
  }
  if (failed.length) await prisma.creatorPost.updateMany({ where: { id: { in: failed } }, data: { nextReadAt: new Date(ctx.now.getTime() + RETRY_MS) } });
  return [...failed, ...skipped];
}

/**
 * One run of the job. `budgetMs`: how long it may keep starting work (Netlify stops a function at 60 s). `only`: these
 * campaigns and nothing else (the database tests), which also skips the file clean-up.
 */
export async function runCreatorViews(opts: { now?: Date; budgetMs?: number; only?: string[] } = {}, deps: JobDeps = defaultDeps): Promise<JobResult> {
  const now = opts.now ?? new Date();
  const scope = opts.only ? { campaignId: { in: opts.only } } : {};
  const deadline = Date.now() + (opts.budgetMs ?? timeBudget(240_000, 40_000));
  const ready = await deps.ready();
  const result: JobResult = { ok: true, composio: ready, closed: 0, checked: 0, read: 0, snapshots: 0, removed: 0, mediaDeleted: 0, limited: false, nextCursor: null };
  const ctx: Ctx = { deps, limit: ready ? await deps.limit() : 0, now, removed: [], result };
  let more = false;

  try {
    // 1. Periods that ended: the final reading, then the close.
    const ending = await prisma.creatorPeriod.findMany({ where: { ...scope, status: "OPEN", endsAt: { lte: now }, campaign: { status: { not: "DRAFT" } } }, orderBy: { endsAt: "asc" }, take: 10, select: { id: true, campaignId: true, endsAt: true } });
    for (const period of ending) {
      if (Date.now() > deadline) {
        more = true;
        break;
      }
      const unreadPosts = await prisma.creatorPost.findMany({ where: { campaignId: period.campaignId, status: "TRACKING", OR: [{ lastReadAt: null }, { lastReadAt: { lt: period.endsAt } }] }, select: { ...POST_SELECT, connectionId: true } });
      const unread = ready && unreadPosts.length ? await readPosts(ctx, unreadPosts, period.endsAt, deadline) : unreadPosts.map((p) => p.id);
      if (unread.length && now.getTime() - period.endsAt.getTime() < CLOSE_WAIT_MS) {
        more = more || Date.now() > deadline;
        continue;
      }
      const closed = await closePeriod(period.id, now);
      if (closed.status === "closed") {
        result.closed++;
        if (deps.notify) await notifyPayouts(period.id).catch(() => 0);
      }
    }

    if (ready) {
      // 2. Links not checked yet (a hand-in checks its links at once; these are the ones that had to wait).
      const checking = await prisma.creatorPost.findMany({ where: { ...scope, status: "CHECKING", createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, orderBy: { updatedAt: "asc" }, take: 30, select: { id: true } });
      const resolveDeps: ResolveDeps = { adapter: deps.adapter, caller: (c) => deps.caller(c, ctx.limit), now };
      const checked = await resolvePosts(checking.map((p) => p.id), resolveDeps, deadline);
      result.checked = checked.tracking + checked.invalid + checked.waiting;
      if (checked.budget) throw new BudgetError();

      // 3. Tracked posts due a reading, in campaigns not waiting for a period close.
      const closing = new Set((await prisma.creatorPeriod.findMany({ where: { ...scope, status: "OPEN", endsAt: { lte: now } }, select: { campaignId: true } })).map((p) => p.campaignId));
      const due = await prisma.creatorPost.findMany({
        where: { AND: [scope, { campaignId: { notIn: [...closing] } }], status: "TRACKING", campaign: { status: { in: READ_STATUSES } }, OR: [{ nextReadAt: null }, { nextReadAt: { lte: new Date(now.getTime() + DUE_MARGIN_MS) } }] },
        orderBy: { nextReadAt: "asc" },
        take: 300,
        select: { ...POST_SELECT, connectionId: true },
      });
      const unread = await readPosts(ctx, due, now, deadline);
      if (due.length === 300 || (unread.length && Date.now() > deadline)) more = true;
    }
  } catch (error) {
    if (!(error instanceof BudgetError)) throw error;
    result.limited = true;
    more = false;
  }

  // 4. Accounts that could not be read for over 3 days: their posts stop earning (owner decision).
  const stale = await prisma.creatorConnection.findMany({
    where: { status: { not: "ACTIVE" }, OR: [{ lastCheckedAt: { lt: new Date(now.getTime() - DISCONNECTED_MS) } }, { lastCheckedAt: null, updatedAt: { lt: new Date(now.getTime() - DISCONNECTED_MS) } }], posts: { some: { ...scope, status: "TRACKING" } } },
    select: { id: true, network: true },
    take: 50,
  });
  for (const c of stale) {
    const reason = `Your ${isCreatorNetwork(c.network) ? NETWORK_LABEL[c.network] : c.network} was disconnected from BuPulse for more than 3 days, so its posts stopped earning.`;
    for (const p of await prisma.creatorPost.findMany({ where: { ...scope, connectionId: c.id, status: "TRACKING" }, select: { id: true } })) {
      if (await removePost(p.id, reason, now)) {
        ctx.removed.push({ postId: p.id, reason });
        result.removed++;
      }
    }
  }

  // 5. Files of campaigns that ended 60 days ago.
  if (!opts.only && Date.now() < deadline) result.mediaDeleted = await cleanupMedia(now).catch(async (error) => {
    await logError(error, { source: "creators.media-cleanup" });
    return 0;
  });

  if (deps.notify) await notifyRemoved(ctx.removed).catch(() => 0);
  result.nextCursor = more ? "more" : null;
  return result;
}
