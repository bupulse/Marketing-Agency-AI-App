import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import "server-only";
import { prisma } from "@/lib/db";
import { timeBudget } from "@/lib/platform/limits";
import { disabledNetworks, isServiceEnabled } from "@/lib/admin/switch";
import { blockMessage, companyEntitlements, notInPlanMessage } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { loadCredentials, markConnectionError } from "@/lib/social/connections";
import { SocialError, type PublishRequest } from "@/lib/social/types";
import { alertRecipients } from "@/lib/team/recipients";
import { sendEmail, renderEmail } from "./email";
import { isVideoPath } from "@/lib/visuals/post-media";
import { adminStorageClient, EMAIL_URL_SECONDS, PUBLISH_URL_SECONDS, signPaths, signPathsForNetwork } from "./media";
import { queueWebhookEvent } from "@/lib/webhooks/emit";
import { postData } from "@/lib/webhooks/events";
import { createMarkPostedToken } from "./token";
import { composeText } from "./validate";
import { CONTEST_NOTE, contestBlocked } from "@/lib/content-flow/contest";

/** A claimed post whose lock is older than this was abandoned by a crashed run and is taken again. */
export const STALE_LOCK_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
/** Minutes to wait after the 1st, 2nd, 3rd and 4th failed attempt (the 5th is final). */
export const BACKOFF_MINUTES = [1, 5, 15, 60] as const;
export const MAX_POSTS_PER_RUN = 20;
const CLAIM_BATCH = 5;
/** Stop claiming posts after this long; posts in flight still finish. Netlify stops a function at 60 s, so 15 s there. */
const timeBudgetMs = () => timeBudget(45_000, 15_000);

export type PublishRunResult = {
  claimed: number;
  published: number;
  reminders: number;
  retrying: number;
  failed: number;
  /** Posts that may or may not have gone out: left for the owner to check, never sent again. */
  uncertain: number;
};

/** How long to wait after this many attempts, or null when the post has used them all. */
export function backoffMinutes(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1];
}

const postInclude = {
  connection: true,
  business: { select: { id: true, name: true, user: { select: { email: true } } } },
} satisfies Prisma.PostInclude;
type ClaimedPost = Prisma.PostGetPayload<{ include: typeof postInclude }>;

/** Accounts waiting to be deleted, or suspended by the admin, do not publish: their posts stay where they are. */
const NOT_BEING_DELETED = Prisma.sql`AND "businessId" NOT IN (
  SELECT b."id" FROM "Business" b JOIN "User" u ON u."id" = b."userId" WHERE u."deletionScheduledFor" IS NOT NULL OR u."suspendedAt" IS NOT NULL
)`;

/**
 * Atomically takes due posts: one UPDATE ... RETURNING over rows locked with SKIP LOCKED, so two runs at
 * the same moment can never both get a post. Due means SCHEDULED, past its time and any back-off wait, with
 * attempts left. A PUBLISHING post is never taken again (see sweepStalePosts): the network may already have it.
 * Each claim counts as an attempt.
 */
/**
 * Posts the admin console marked "Needs reconnect:" on an account it force-disconnected (REVOKED, tokens erased) wait
 * untouched: no attempt, no FAILED, no failure email. Reconnecting restores them (restoreQueuedPosts in social/connections).
 */
const NOT_FORCE_DISCONNECTED = Prisma.sql`AND NOT ("lastError" LIKE 'Needs reconnect:%' AND EXISTS (
  SELECT 1 FROM "Connection" c WHERE c."id" = "Post"."connectionId" AND c."status" = 'REVOKED'::"ConnectionStatus" AND c."accessTokenEncrypted" IS NULL))`;

export async function claimDuePosts(args: { now: Date; limit: number; ids?: string[]; businessId?: string }): Promise<string[]> {
  const { now, limit } = args;
  if (args.ids && args.ids.length === 0) return [];
  const only = args.ids ? Prisma.sql`AND "id" IN (${Prisma.join(args.ids)})` : Prisma.empty;
  const business = args.businessId ? Prisma.sql`AND "businessId" = ${args.businessId}` : Prisma.empty;
  // Networks switched off in the admin console are skipped, so their posts stay SCHEDULED (not failed) until it is back on.
  const paused = await disabledNetworks();
  const pausedSql = paused.length ? Prisma.sql`AND "network" NOT IN (${Prisma.join(paused)})` : Prisma.empty;
  // Reminder posts (NOTIFY accounts and SCRIPT posts) need Resend. While it is off they are not claimed, so they stay
  // SCHEDULED with no attempt used, and go out as soon as it is switched back on.
  const emailOff = !(await isServiceEnabled("resend"));
  const reminderSql = emailOff ? Prisma.sql`AND "format" <> 'SCRIPT'::"PostFormat" AND NOT "remindOnly" AND ("connectionId" IS NULL OR "connectionId" NOT IN (SELECT "id" FROM "Connection" WHERE "postingMode" = 'NOTIFY'))` : Prisma.empty;
  // Companies whose subscription is not live (waiting for a demo, past due, expired, cancelled) are not claimed at all:
  // their posts stay SCHEDULED, held, without using attempts. (A trial that ran out but was not flipped yet is caught
  // by the entitlement check below and released the same way.)
  const liveSql = Prisma.sql`AND "businessId" IN (SELECT b."id" FROM "Business" b JOIN "Subscription" s ON s."userId" = b."userId" WHERE s."status" IN ('ACTIVE'::"SubscriptionStatus", 'TRIALING'::"SubscriptionStatus"))`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Post" SET "status" = 'PUBLISHING'::"PostStatus", "lockedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "Post"
      WHERE "status" = 'SCHEDULED'::"PostStatus" AND "scheduledAt" <= ${now}
        AND "attempts" < ${MAX_ATTEMPTS}
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
        ${NOT_BEING_DELETED} ${NOT_FORCE_DISCONNECTED} ${liveSql} ${only} ${business} ${pausedSql} ${reminderSql}
      ORDER BY "scheduledAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return rows.map((r) => r.id);
}

export const UNCONFIRMED_MESSAGE = (network: string) => `We could not confirm this post went out. Check ${network} before retrying.`;
const OUT_OF_ATTEMPTS = "This post was tried too many times and has been stopped. Edit it or retry it from the calendar.";

/**
 * Posts stuck in PUBLISHING for over STALE_LOCK_MINUTES (a run crashed or timed out mid-publish) may already be
 * live, so they are never sent again: they become NEEDS_ACTION and the owner is asked to check. Posts that used
 * all their attempts without being claimed again become FAILED.
 */
export async function sweepStalePosts(now: Date): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MINUTES * 60_000);
  const stale = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Post" SET "status" = 'NEEDS_ACTION'::"PostStatus", "lockedAt" = NULL, "updatedAt" = ${now},
      "lastError" = 'We could not confirm this post went out. Check the network before retrying.'
    WHERE "status" = 'PUBLISHING'::"PostStatus" AND "lockedAt" < ${staleBefore}
    RETURNING "id"`;
  const capped = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Post" SET "status" = 'FAILED'::"PostStatus", "lockedAt" = NULL, "updatedAt" = ${now}, "lastError" = ${OUT_OF_ATTEMPTS}
    WHERE "status" = 'SCHEDULED'::"PostStatus" AND "attempts" >= ${MAX_ATTEMPTS} AND "scheduledAt" <= ${now}
    RETURNING "id"`;
  const ids = [...stale, ...capped].map((r) => r.id);
  if (ids.length === 0) return 0;
  for (const post of await prisma.post.findMany({ where: { id: { in: ids } }, include: postInclude })) {
    const uncertain = post.status === "NEEDS_ACTION";
    if (uncertain) await prisma.post.update({ where: { id: post.id }, data: { lastError: UNCONFIRMED_MESSAGE(label(post.network)) } });
    if (!uncertain) await emitPostEvent(post, "post.failed", { status: "FAILED", lastError: OUT_OF_ATTEMPTS });
    await emailOwner(post, uncertain ? "uncertain" : "failed", uncertain ? UNCONFIRMED_MESSAGE(label(post.network)) : OUT_OF_ATTEMPTS);
  }
  return ids.length;
}

async function loadClaimed(ids: string[]): Promise<ClaimedPost[]> {
  return prisma.post.findMany({ where: { id: { in: ids }, status: "PUBLISHING" }, include: postInclude, orderBy: { scheduledAt: "asc" } });
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

const NETWORK_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube" };
const label = (network: string) => NETWORK_LABEL[network] ?? network;

/** Writes the new state of a claimed post; only a post still PUBLISHING is touched. */
async function settle(postId: string, data: Prisma.PostUpdateManyMutationInput): Promise<boolean> {
  const { count } = await prisma.post.updateMany({ where: { id: postId, status: "PUBLISHING" }, data: { ...data, lockedAt: null } });
  return count === 1;
}

/** Reminder path (NOTIFY accounts and SCRIPT posts): email everything needed to post by hand, then wait for "I posted it". */
async function sendReminder(post: ClaimedPost): Promise<"reminders" | "retrying" | "failed"> {
  const [to, ...copies] = await alertRecipients(post.businessId, post.business.user.email);
  if (!to) {
    await settle(post.id, { status: "FAILED", lastError: "There is no email address to send the reminder to." });
    return "failed";
  }
  // Resend was switched off after this post was claimed: hand the attempt back and wait, instead of counting a failure.
  if (!(await isServiceEnabled("resend"))) return releaseUnsent(post);
  const network = label(post.network);
  const isScript = post.format === "SCRIPT";
  const admin = adminStorageClient();
  const signed = admin && post.mediaPaths.length ? await signPaths(admin, post.mediaPaths, EMAIL_URL_SECONDS) : new Map<string, string>();
  const links = post.mediaPaths.flatMap((path, i) => (signed.has(path) ? [{ label: isVideoPath(path) ? "Your video" : `Image ${i + 1}`, url: signed.get(path) as string }] : []));
  const hasVideo = post.mediaPaths.some(isVideoPath);
  const token = await createMarkPostedToken(post.id);
  const heading = isScript ? `Time to film and post on ${network}` : `Time to post on ${network}`;

  const sentEmail = {
    to,
    subject: heading,
    ...renderEmail({
      heading,
      intro: isScript
        ? hasVideo
          ? `Your ${network} video is scheduled for now. BuPulse cannot upload to ${network} yet, so download your video below and post it with this caption.`
          : `Your ${network} video is scheduled for now. BuPulse cannot publish video yet, so here is the script and caption to film and post it yourself.`
        : !post.connection
          ? `Your ${network} post is scheduled for now. ${network} is not connected to BuPulse yet, so here is everything ready to copy and post yourself. Connect it in Channels and the next posts go out on their own.`
          : `Your ${network} post is scheduled for now. ${post.connection.displayName ?? "This account"} is set to remind you instead of posting automatically, so here is everything ready to copy.`,
      blocks: [
        { label: isScript ? "Script" : "Caption", value: post.text },
        ...(post.hashtags.length ? [{ label: "Hashtags", value: post.hashtags.join(" ") }] : []),
        ...(post.link ? [{ label: "Link", value: post.link }] : []),
      ],
      links,
      button: { label: "I posted it", url: `${siteUrl()}/posted?token=${encodeURIComponent(token)}` },
      footer: links.length ? (hasVideo ? "Download links work for 7 days." : "Image links work for 7 days.") : post.mediaPaths.length ? "Open BuPulse to download the images for this post." : undefined,
    }),
  };
  const sent = await sendEmail(sentEmail);
  if (!sent) {
    // A switch flipped while sending is a pause, not a failed attempt.
    if (!(await isServiceEnabled("resend"))) return releaseUnsent(post);
    return retryLater(post, "We could not send the reminder email.");
  }
  await settle(post.id, { status: "NEEDS_ACTION", lastError: null, nextAttemptAt: null });
  // Admins who opted in get the same reminder (best effort; the Owner's copy is the one that counts).
  for (const copy of copies) await sendEmail({ ...sentEmail, to: copy }).catch(() => false);
  return "reminders";
}

/**
 * Puts a claimed post back to SCHEDULED, undoing the attempt the claim counted, because a service it needs is switched
 * off or its account is read-only. `held` is shown on the post as the reason it waits (cleared when it is tried again).
 */
async function releaseUnsent(post: ClaimedPost, held: string | null = null): Promise<"retrying"> {
  await settle(post.id, { status: "SCHEDULED", attempts: Math.max(0, post.attempts - 1), nextAttemptAt: null, lastError: held });
  return "retrying";
}

/** Back to SCHEDULED with a wait (1, 5, 15, 60 minutes), or FAILED after the last attempt. */
async function retryLater(post: ClaimedPost, message: string, retryAfterSeconds?: number): Promise<"retrying" | "failed"> {
  const wait = backoffMinutes(post.attempts);
  if (wait === null) {
    await failFinally(post, message);
    return "failed";
  }
  const minutes = Math.max(wait, retryAfterSeconds ? Math.ceil(retryAfterSeconds / 60) : 0);
  await settle(post.id, { status: "SCHEDULED", nextAttemptAt: new Date(Date.now() + minutes * 60_000), lastError: message });
  return "retrying";
}

/** Tells the owner by email that a post failed, or that we cannot tell whether it went out. */
async function emailOwner(post: ClaimedPost, kind: "failed" | "uncertain", message: string, reconnect = false) {
  const recipients = await alertRecipients(post.businessId, post.business.user.email);
  if (!recipients.length) return;
  const network = label(post.network);
  const uncertain = kind === "uncertain";
  const email = {
    subject: uncertain ? `Please check your ${network} post` : `Your ${network} post could not be published`,
    ...renderEmail({
      heading: uncertain ? `Please check your ${network} post` : `Your ${network} post could not be published`,
      intro: uncertain
        ? `We sent this post to ${network} but did not get a clear answer, so we have not tried again. Please look at your ${network} page. If it is there, press "Mark as posted" in your calendar. If it is not, you can retry it.`
        : reconnect
          ? `${network} no longer lets BuPulse post for you, so this post did not go out. Reconnect the account, then retry the post from your calendar.`
          : `We tried to publish this post to ${network} and it did not work. You can fix it and retry from your calendar.`,
      blocks: [
        { label: uncertain ? "What happened" : "What went wrong", value: message },
        { label: "The post", value: composeText(post.text, post.hashtags).slice(0, 500) },
      ],
      button: { label: reconnect ? "Reconnect your account" : "Open your calendar", url: `${siteUrl()}/dashboard/${reconnect ? "connections" : "calendar"}` },
    }),
  };
  for (const to of recipients) await sendEmail({ to, ...email });
}

/** Outgoing webhooks (post.published / post.failed): queued after the state is saved, never slows or breaks publishing. */
function emitPostEvent(post: ClaimedPost, event: "post.published" | "post.failed", changes: { status: string; lastError: string | null; permalink?: string | null; publishedAt?: Date | null }): Promise<void> {
  return queueWebhookEvent(post.businessId, event, () => postData({ ...post, ...changes, permalink: changes.permalink ?? post.permalink, publishedAt: changes.publishedAt ?? post.publishedAt }));
}

/** Marks the post FAILED and tells the owner by email. */
async function failFinally(post: ClaimedPost, message: string, reconnect = false) {
  const saved = await settle(post.id, { status: "FAILED", lastError: message, nextAttemptAt: null });
  if (saved) await emitPostEvent(post, "post.failed", { status: "FAILED", lastError: message });
  await emailOwner(post, "failed", message, reconnect);
}

/** The final call may have created the post: keep it for the owner to check, and never send it again. */
async function leaveUncertain(post: ClaimedPost) {
  const message = UNCONFIRMED_MESSAGE(label(post.network));
  await settle(post.id, { status: "NEEDS_ACTION", lastError: message, nextAttemptAt: null });
  await emailOwner(post, "uncertain", message);
}

function guessMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : "image/jpeg";
}

/** The network has the post but we could not record it: shout, with everything needed to fix it by hand. */
async function logSaveFailure(post: ClaimedPost, result: { externalId: string; permalink?: string }, error: unknown) {
  console.error(`[publishing] PUBLISHED ON ${post.network} BUT NOT SAVED post=${post.id} externalId=${result.externalId} permalink=${result.permalink ?? ""}`);
  await logError(error, {
    source: "publishing.save-after-publish",
    businessId: post.businessId,
    postId: post.id,
    network: post.network,
    externalId: result.externalId,
    permalink: result.permalink,
    note: "Published on the network but could not be saved. Do NOT re-publish: set the post to PUBLISHED by hand.",
  });
}

/** Records a successful publish, retrying the write a few times. Logs loudly if it cannot. */
async function saveSuccess(post: ClaimedPost, result: { externalId: string; permalink?: string }) {
  const data = { status: "PUBLISHED" as const, externalId: result.externalId, permalink: result.permalink ?? null, publishedAt: new Date(), lastError: null, nextAttemptAt: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (await settle(post.id, data)) {
        await trackEvent(EVENT_NAMES.postPublished, { businessId: post.businessId, props: { network: post.network } });
        await emitPostEvent(post, "post.published", { status: "PUBLISHED", lastError: null, permalink: data.permalink, publishedAt: data.publishedAt });
        return;
      }
      return await logSaveFailure(post, result, new Error("The post was no longer in PUBLISHING state"));
    } catch (error) {
      if (attempt === 3) return await logSaveFailure(post, result, error);
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

async function handleProviderError(post: ClaimedPost, error: unknown): Promise<"retrying" | "failed" | "uncertain"> {
  if (!(error instanceof SocialError)) {
    await logError(error, { source: "publishing.provider", businessId: post.businessId, postId: post.id, network: post.network });
    return retryLater(post, "Something went wrong on our side. We will try again.");
  }
  // An error from the call that creates the post (timeout, 5xx) may hide a post that is live: never resend it.
  if (error.stage === "final" && (error.kind === "temporary" || error.kind === "rate_limit")) {
    await leaveUncertain(post);
    return "uncertain";
  }
  switch (error.kind) {
    case "auth":
      if (post.connectionId) await markConnectionError(post.connectionId, error).catch((e) => logError(e, { source: "publishing.mark-connection", postId: post.id }));
      await failFinally(post, `${label(post.network)} no longer lets BuPulse post for this account. Reconnect it to continue.`, true);
      return "failed";
    case "invalid":
      await failFinally(post, error.message);
      return "failed";
    case "rate_limit":
    case "temporary":
      return retryLater(post, error.message, error.retryAfter);
  }
}

/** Publishes one claimed post through its network and records the result. Never throws. */
async function processPost(post: ClaimedPost): Promise<keyof Omit<PublishRunResult, "claimed">> {
  try {
    // Last line of defence: a contest without the owner's confirmed prize and rules never goes out; it goes back to
    // waiting for the owner (lib/content-flow/contest.ts).
    if (contestBlocked(post)) {
      await settle(post.id, { status: "PENDING_APPROVAL", reviewNote: CONTEST_NOTE, autoScheduledAt: null });
      return "retrying";
    }
    // A post for an app that is not connected (remindOnly) is a reminder; one that lost its account fails.
    const byHand = !post.connection && post.remindOnly;
    if ((!post.connection && !byHand) || !isNetwork(post.network)) {
      const message = "The account for this post was disconnected.";
      if (await settle(post.id, { status: "FAILED", lastError: message })) await emitPostEvent(post, "post.failed", { status: "FAILED", lastError: message });
      return "failed";
    }
    // Scheduling is a plan feature. A post of a company whose plan (resolved) lost it fails with the reason, instead
    // of going out. While the plan cannot be checked (catalog degraded, unknown plan key) the post is handed back and
    // retried later: a deploy or database blip must never fail scheduled posts for good. A read-only account (demo
    // pending, trial over, past due, plan ended) keeps its posts too: SCHEDULED and held, with the reason on them,
    // until it pays (then they go out, late ones first).
    const access = await companyEntitlements(post.businessId);
    if (!access.resolved) return releaseUnsent(post);
    if (access.block) return releaseUnsent(post, blockMessage(access.block));
    if (!access.inPlan.has("calendar")) {
      const message = notInPlanMessage("calendar");
      if (await settle(post.id, { status: "FAILED", lastError: message })) await emitPostEvent(post, "post.failed", { status: "FAILED", lastError: message });
      return "failed";
    }
    if (!access.usable.has("calendar")) return releaseUnsent(post);
    if (!post.connection || post.connection.postingMode === "NOTIFY" || post.format === "SCRIPT") return await sendReminder(post);

    const provider = getProvider(post.network);
    let result: { externalId: string; permalink?: string };
    try {
      const admin = adminStorageClient();
      if (post.mediaPaths.length > 0 && !admin) throw new SocialError("Photos cannot be sent: the storage key is not set.", "temporary", post.network);
      const { urls: signed, jpeg } = admin ? await signPathsForNetwork(admin, post.mediaPaths, post.network, PUBLISH_URL_SECONDS) : { urls: new Map<string, string>(), jpeg: new Set<string>() };
      if (post.mediaPaths.some((p) => !signed.has(p))) {
        throw new SocialError("A photo on this post is missing from your storage. Edit the post and add it again.", "invalid", post.network);
      }
      const assets = post.mediaPaths.length
        ? await prisma.mediaAsset.findMany({ where: { businessId: post.businessId, path: { in: post.mediaPaths } }, select: { path: true, mimeType: true, width: true, height: true } })
        : [];
      const request: PublishRequest = {
        format: post.format === "CAROUSEL" || post.format === "ARTICLE" ? post.format : "POST",
        title: post.title,
        text: composeText(post.text, post.hashtags),
        media: post.mediaPaths.map((path) => {
          const asset = assets.find((a) => a.path === path);
          return { url: signed.get(path) as string, mimeType: jpeg.has(path) ? "image/jpeg" : (asset?.mimeType ?? guessMime(path)), width: asset?.width, height: asset?.height };
        }),
        link: post.link,
      };
      result = await provider.publish(await loadCredentials(post.connection.id), request);
    } catch (error) {
      return await handleProviderError(post, error);
    }

    // The network accepted the post. From here on it must never be sent again.
    await saveSuccess(post, result);
    return "published";
  } catch (error) {
    await logError(error, { source: "publishing.process", businessId: post.businessId, postId: post.id });
    return retryLater(post, "Something went wrong on our side. We will try again.").catch(() => "retrying" as const);
  }
}

async function runClaimed(ids: string[], totals: PublishRunResult) {
  totals.claimed += ids.length;
  const posts = await loadClaimed(ids);
  for (const outcome of await Promise.all(posts.map(processPost))) totals[outcome] += 1;
}

/**
 * Publishes what is due. Claims a few posts at a time (so posts not yet processed are never left locked),
 * up to MAX_POSTS_PER_RUN and a time budget. Called every minute by /api/cron/publish.
 */
export async function publishDue(now = new Date(), options: { limit?: number; budgetMs?: number } = {}): Promise<PublishRunResult> {
  const limit = options.limit ?? MAX_POSTS_PER_RUN;
  const deadline = Date.now() + (options.budgetMs ?? timeBudgetMs());
  const totals: PublishRunResult = { claimed: 0, published: 0, reminders: 0, retrying: 0, failed: 0, uncertain: 0 };
  await sweepStalePosts(now).catch((error) => logError(error, { source: "publishing.sweep" }));
  while (totals.claimed < limit && Date.now() < deadline) {
    const ids = await claimDuePosts({ now, limit: Math.min(CLAIM_BATCH, limit - totals.claimed) });
    if (ids.length === 0) break;
    await runClaimed(ids, totals);
  }
  return totals;
}

/** "Post now" and "Retry": publishes these posts of this business right away (they must already be due). */
export async function publishPostsNow(businessId: string, postIds: string[], now = new Date()): Promise<PublishRunResult> {
  const totals: PublishRunResult = { claimed: 0, published: 0, reminders: 0, retrying: 0, failed: 0, uncertain: 0 };
  const ids = await claimDuePosts({ now, limit: Math.min(postIds.length, MAX_POSTS_PER_RUN), ids: postIds, businessId });
  if (ids.length > 0) await runClaimed(ids, totals);
  return totals;
}
