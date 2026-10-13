import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import "server-only";
import { prisma } from "@/lib/db";
import { resolveSubject, subjectColumns } from "@/lib/knowledge/service";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { composeSchema, editSchema, isOwnMediaPath, type ComposeParsed } from "./schemas";
import { cleanSlotTimes, nextFreeSlots } from "./slots";
import { bestTime } from "./best-time";
import { buildProfile, preferredHours, preferredWeekdays } from "@/lib/autopilot/learning";
import { loadPostResults } from "@/lib/autopilot/results";
import { EDITABLE, QUEUED, type PostStatusName } from "./status";
import { parseLocalInput } from "./time";
import { formatFor, validatePost, type PostFormatName } from "./validate";
import type { ComposeInput, EditInput } from "./types";
import { composerMediaFor, isVideoPath } from "@/lib/visuals/post-media";
import { readyMedia } from "@/lib/visuals/service";

/** A problem the owner can fix. `code` tells the action layer whether it was a missing thing, bad input or a race. */
export class PublishingError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "invalid" | "conflict",
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

const NOT_FOUND = () => new PublishingError("We could not find that post.", "not_found");

export type Owner = { businessId: string; userId: string };

/** Can this account be posted to (or reminded about) right now? */
export function accountUsable(c: { status: string; postingMode: string }): boolean {
  if (c.status === "ACTIVE" || c.status === "EXPIRING") return true;
  return c.postingMode === "NOTIFY" && c.status !== "REVOKED";
}

async function businessSettings(businessId: string) {
  const [business, autopilot] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } }),
    prisma.autopilotSettings.findUnique({ where: { businessId }, select: { postingTimes: true } }),
  ]);
  if (!business) throw new PublishingError("We could not find your business.", "not_found");
  return { timezone: business.timezone || "UTC", slotTimes: cleanSlotTimes(autopilot?.postingTimes) };
}

/** Times where any of these accounts already has a queued post, so "Add to queue" does not stack posts. */
async function takenTimes(connectionIds: string[], now: Date): Promise<Date[]> {
  const rows = await prisma.post.findMany({
    where: { connectionId: { in: connectionIds }, status: { in: [...QUEUED] }, scheduledAt: { gte: now } },
    select: { scheduledAt: true },
    take: 2000,
  });
  return rows.flatMap((r) => (r.scheduledAt ? [r.scheduledAt] : []));
}

async function resolveTime(
  when: ComposeInput["when"] | { mode: "keep" },
  ctx: { timezone: string; slotTimes: string[]; connectionIds: string[]; now: Date },
): Promise<{ status: "DRAFT" | "SCHEDULED"; scheduledAt: Date | null } | null> {
  const { now } = ctx;
  switch (when.mode) {
    case "keep":
      return null;
    case "draft":
      return { status: "DRAFT", scheduledAt: null };
    case "now":
      return { status: "SCHEDULED", scheduledAt: now };
    case "queue": {
      const [slot] = nextFreeSlots({ times: ctx.slotTimes, zone: ctx.timezone, now, taken: await takenTimes(ctx.connectionIds, now) });
      if (!slot) throw new PublishingError("Your queue is full for the next few months. Pick a date instead.", "invalid");
      return { status: "SCHEDULED", scheduledAt: slot };
    }
    case "schedule": {
      const at = parseLocalInput(when.local, ctx.timezone);
      if (!at) throw new PublishingError("Pick a valid date and time.", "invalid", { when: "Pick a valid date and time." });
      if (at.getTime() <= now.getTime()) throw new PublishingError("Pick a time in the future.", "invalid", { when: "Pick a time in the future." });
      return { status: "SCHEDULED", scheduledAt: at };
    }
  }
}

/** Sizes of the owner's Gallery photos among these paths (designs and others are not recorded, so are skipped). */
async function mediaSizes(businessId: string, paths: string[]) {
  if (paths.length === 0) return [];
  const rows = await prisma.mediaAsset.findMany({ where: { businessId, path: { in: paths } }, select: { width: true, height: true } });
  return rows;
}

function checkMedia(userId: string, paths: string[]) {
  if (!paths.every((p) => isOwnMediaPath(userId, p))) throw new PublishingError("One of the photos is not yours to use.", "invalid", { media: "One of the photos is not yours to use." });
}

function firstIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): PublishingError {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[issue.path.length ? String(issue.path[0]) : "form"] ??= issue.message;
  return new PublishingError(error.issues[0]?.message ?? "Check the post and try again.", "invalid", fieldErrors);
}

/**
 * Creates one post per chosen account, all sharing a groupId. Each account gets the text written for its
 * network (per-network overrides) checked against that network's rules; nothing is saved unless all pass.
 * "now" only creates the posts due immediately: the caller publishes them (engine.publishPostsNow).
 */
export async function createPosts(owner: Owner, input: ComposeInput, now = new Date()): Promise<{ groupId: string; postIds: string[]; scheduledAt: Date | null; status: "DRAFT" | "SCHEDULED" }> {
  const parsed = composeSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const data: ComposeParsed = parsed.data;
  checkMedia(owner.userId, data.mediaPaths);

  const connections = await prisma.connection.findMany({
    where: { id: { in: data.connectionIds }, businessId: owner.businessId, kind: "SOCIAL" },
  });
  if (connections.length !== new Set(data.connectionIds).size) throw new PublishingError("One of those accounts is not connected.", "not_found");
  const ordered = data.connectionIds.flatMap((id) => connections.filter((c) => c.id === id));

  const [subject, content] = await Promise.all([
    data.subjectId ? resolveSubject(owner.businessId, data.subjectId) : null,
    data.contentId ? prisma.generatedContent.findFirst({ where: { id: data.contentId, businessId: owner.businessId }, select: { id: true } }) : null,
  ]);
  if ((data.subjectId && !subject) || (data.contentId && !content)) throw new PublishingError("We could not find that product or campaign.", "not_found");

  const draft = data.when.mode === "draft";
  const problems: string[] = [];
  const sizes = !draft && ordered.some((c) => c.provider === "instagram") ? await mediaSizes(owner.businessId, data.mediaPaths) : [];
  // The content's visuals (docs/CONTENT_VISUALS.md): a video goes only where the network takes it, and with the script
  // reminder of TikTok and YouTube; the other networks get the photos (or the content's picture).
  const visual = content ? await readyMedia(owner.businessId, { contentId: content.id }) : { images: [], video: null };
  const rows = ordered.map((connection) => {
    if (!isNetwork(connection.provider)) throw new PublishingError("That account cannot be posted to.", "invalid");
    const network = connection.provider;
    const rules = getProvider(network).rules;
    const override = data.overrides[network];
    const text = override?.text ?? data.text;
    const hashtags = override?.hashtags ?? data.hashtags;
    let mediaPaths = composerMediaFor(network, rules.videoOnly, data.mediaPaths, visual.images);
    if (rules.videoOnly && visual.video && !mediaPaths.some(isVideoPath)) mediaPaths = [visual.video];
    const format: PostFormatName = formatFor(rules, mediaPaths.length);
    const label = connection.displayName ?? rules.label;
    if (draft) {
      if (!text.trim() && data.mediaPaths.length === 0) problems.push("Write something or add a photo to save a draft.");
    } else {
      if (!accountUsable(connection)) problems.push(`${label} needs to be reconnected first. Open Channels to fix it.`);
      for (const issue of validatePost(rules, { format, text, hashtags, mediaCount: mediaPaths.length, mediaSizes: sizes }).errors) problems.push(`${label}: ${issue}`);
    }
    return { connection, network, text: text.trim(), hashtags, format, mediaPaths };
  });
  if (problems.length > 0) throw new PublishingError([...new Set(problems)][0], "invalid", { form: [...new Set(problems)].join(" ") });

  const settings = await businessSettings(owner.businessId);
  const time = await resolveTime(data.when, { ...settings, connectionIds: ordered.map((c) => c.id), now });
  if (!time) throw new PublishingError("Choose when to post.", "invalid");

  const groupId = globalThis.crypto.randomUUID();
  const created = await prisma.$transaction(
    rows.map((row) =>
      prisma.post.create({
        data: {
          businessId: owner.businessId,
          connectionId: row.connection.id,
          network: row.network,
          groupId,
          ...subjectColumns(subject),
          contentId: content?.id,
          status: time.status,
          format: row.format,
          source: "MANUAL",
          text: row.text,
          hashtags: row.hashtags,
          mediaPaths: row.mediaPaths,
          link: data.link,
          scheduledAt: time.scheduledAt,
        },
        select: { id: true },
      }),
    ),
  );
  // Scheduled from Studio content by hand: the drafts BuPulse made of that content for the same accounts are replaced.
  if (!draft && content) {
    await prisma.post.deleteMany({ where: { businessId: owner.businessId, contentId: content.id, source: "STUDIO", status: "PENDING_APPROVAL", connectionId: { in: ordered.map((c) => c.id) } } });
  }
  if (!draft) await trackEvent(EVENT_NAMES.postScheduled, { businessId: owner.businessId, props: { count: created.length, status: time.status } });
  return { groupId, postIds: created.map((p) => p.id), scheduledAt: time.scheduledAt, status: time.status };
}

async function ownedPost(businessId: string, postId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, businessId }, include: { connection: { select: { id: true, displayName: true, provider: true, status: true, postingMode: true } } } });
  if (!post) throw NOT_FOUND();
  return post;
}

const NO_LONGER_EDITABLE = "This post changed while you were looking at it. It may be going out right now.";

/** Edits one post (text, hashtags, photos, link, and optionally when it goes out). */
export async function updatePost(owner: Owner, postId: string, input: EditInput, now = new Date()): Promise<{ status: PostStatusName; scheduledAt: Date | null }> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const data = parsed.data;
  checkMedia(owner.userId, data.mediaPaths);
  const post = await ownedPost(owner.businessId, postId);
  if (!(EDITABLE as readonly string[]).includes(post.status)) throw new PublishingError("A post that is live or going out cannot be edited. Duplicate it instead.", "conflict");
  if (!isNetwork(post.network)) throw new PublishingError("That account cannot be posted to.", "invalid");

  const rules = getProvider(post.network).rules;
  const format = formatFor(rules, data.mediaPaths.length);
  const settings = await businessSettings(owner.businessId);
  const time = await resolveTime(data.when, { ...settings, connectionIds: post.connectionId ? [post.connectionId] : [], now });
  const becomesDraft = time ? time.status === "DRAFT" : post.status === "DRAFT";
  if (!becomesDraft) {
    const issues = validatePost(rules, { format, text: data.text, hashtags: data.hashtags, mediaCount: data.mediaPaths.length, mediaSizes: post.network === "instagram" ? await mediaSizes(owner.businessId, data.mediaPaths) : [] }).errors;
    if (issues.length > 0) throw new PublishingError(issues[0], "invalid", { form: issues.join(" ") });
    if (time && (!post.connection || !accountUsable(post.connection))) throw new PublishingError("This account needs to be reconnected first. Open Channels to fix it.", "invalid");
  } else if (!data.text.trim() && data.mediaPaths.length === 0) {
    throw new PublishingError("Write something or add a photo to save a draft.", "invalid");
  }

  const update: Prisma.PostUpdateManyMutationInput = { text: data.text.trim(), hashtags: data.hashtags, mediaPaths: data.mediaPaths, link: data.link, format };
  if (time) {
    update.status = time.status;
    update.scheduledAt = time.scheduledAt;
    update.attempts = 0;
    update.nextAttemptAt = null;
    update.lockedAt = null;
    update.lastError = null;
  }
  const { count } = await prisma.post.updateMany({ where: { id: postId, businessId: owner.businessId, status: { in: [...EDITABLE] } }, data: update });
  if (count === 0) throw new PublishingError(NO_LONGER_EDITABLE, "conflict");
  return { status: (time?.status ?? post.status) as PostStatusName, scheduledAt: time ? time.scheduledAt : post.scheduledAt };
}

/** Moves a post to another time (drag and drop, or the keyboard alternative). */
export async function reschedulePost(owner: Owner, postId: string, scheduledAt: Date, now = new Date()): Promise<void> {
  if (Number.isNaN(scheduledAt.getTime())) throw new PublishingError("Pick a valid date and time.", "invalid");
  if (scheduledAt.getTime() <= now.getTime()) throw new PublishingError("Pick a time in the future.", "invalid");
  const post = await ownedPost(owner.businessId, postId);
  if (!(["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "FAILED", "NEEDS_ACTION"] as string[]).includes(post.status)) {
    throw new PublishingError("A post that is live or going out cannot be moved.", "conflict");
  }
  const revive = post.status === "FAILED" || post.status === "NEEDS_ACTION";
  const { count } = await prisma.post.updateMany({
    where: { id: postId, businessId: owner.businessId, status: post.status },
    data: revive ? { scheduledAt, status: "SCHEDULED", attempts: 0, nextAttemptAt: null, lockedAt: null, lastError: null } : { scheduledAt },
  });
  if (count === 0) throw new PublishingError(NO_LONGER_EDITABLE, "conflict");
}

/** A copy of a post as a new draft (no time, no link to the published original). */
export async function duplicatePost(owner: Owner, postId: string): Promise<{ id: string }> {
  const post = await ownedPost(owner.businessId, postId);
  return prisma.post.create({
    data: {
      businessId: owner.businessId,
      connectionId: post.connectionId,
      network: post.network,
      groupId: globalThis.crypto.randomUUID(),
      projectId: post.projectId,
      productId: post.productId,
      campaignId: post.campaignId,
      contentId: post.contentId,
      status: "DRAFT",
      format: post.format,
      source: "MANUAL",
      title: post.title,
      text: post.text,
      hashtags: post.hashtags,
      mediaPaths: post.mediaPaths,
      link: post.link,
    },
    select: { id: true },
  });
}

/**
 * Deletes a post. A published post is only removed from BuPulse: the networks do not let BuPulse delete
 * for you, so it stays live there (`note` tells the owner).
 */
export async function deletePost(owner: Owner, postId: string): Promise<{ note?: string }> {
  const post = await ownedPost(owner.businessId, postId);
  if (post.status === "PUBLISHING") throw new PublishingError("This post is being published right now. Try again in a minute.", "conflict");
  const { count } = await prisma.post.deleteMany({ where: { id: postId, businessId: owner.businessId, status: post.status } });
  if (count === 0) throw new PublishingError(NO_LONGER_EDITABLE, "conflict");
  return post.status === "PUBLISHED" ? { note: "Removed from BuPulse. It stays live on the network: delete it there too if you want it gone." } : {};
}

/**
 * The best time for each post (lib/publishing/best-time.ts): the business's posting times, ordered by what works on
 * the post's network (learned from its own results, else the network's defaults), on the account's free slots. Posts
 * in one call keep 2.5 hours apart on the same account too. Falls back to the next free queue slot.
 */
export async function bestTimesFor(businessId: string, posts: { id: string; network: string; connectionId: string | null }[], now = new Date()): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (posts.length === 0) return out;
  const settings = await businessSettings(businessId);
  const connectionIds = [...new Set(posts.flatMap((p) => (p.connectionId ? [p.connectionId] : [])))];
  const [results, queued] = await Promise.all([
    loadPostResults(businessId).catch(() => []),
    connectionIds.length
      ? prisma.post.findMany({ where: { connectionId: { in: connectionIds }, status: { in: [...QUEUED] }, scheduledAt: { gte: now }, id: { notIn: posts.map((p) => p.id) } }, select: { connectionId: true, scheduledAt: true }, take: 2000 })
      : [],
  ]);
  const profile = buildProfile(results, settings.timezone);
  const taken = new Map<string, Date[]>();
  for (const q of queued ?? []) if (q.connectionId && q.scheduledAt) taken.set(q.connectionId, [...(taken.get(q.connectionId) ?? []), q.scheduledAt]);
  for (const post of posts) {
    const key = post.connectionId ?? `none:${post.id}`;
    const busy = taken.get(key) ?? [];
    const at =
      (isNetwork(post.network)
        ? bestTime({ zone: settings.timezone, now, postingTimes: settings.slotTimes, hours: preferredHours(profile, post.network), weekdays: preferredWeekdays(profile, post.network), taken: busy })
        : null) ??
      nextFreeSlots({ times: settings.slotTimes, zone: settings.timezone, now, taken: busy })[0] ??
      new Date(now.getTime() + 10 * 60_000);
    out.set(post.id, at);
    taken.set(key, [...busy, at]);
  }
  return out;
}

/**
 * Approves posts waiting for review (Autopilot's and Studio's) so they are published. Only this business's posts
 * that still wait are touched. A post keeps its planned time when that is still ahead; one without a time, or whose
 * time passed, goes out at the best time for its network.
 */
export async function approvePosts(businessId: string, postIds: string[], now = new Date()): Promise<{ approved: number }> {
  const ids = [...new Set(postIds)].slice(0, 200);
  if (ids.length === 0) return { approved: 0 };
  const posts = await prisma.post.findMany({ where: { id: { in: ids }, businessId, status: "PENDING_APPROVAL" }, select: { id: true, network: true, connectionId: true, scheduledAt: true } });
  if (posts.length === 0) return { approved: 0 };

  const stale = posts.filter((p) => !p.scheduledAt || p.scheduledAt.getTime() <= now.getTime());
  const times = stale.length > 0 ? await bestTimesFor(businessId, stale, now) : new Map<string, Date>();

  let approved = 0;
  for (const post of posts) {
    const scheduledAt = times.get(post.id);
    const { count } = await prisma.post.updateMany({
      where: { id: post.id, businessId, status: "PENDING_APPROVAL" },
      data: { status: "SCHEDULED", reviewNote: null, ...(scheduledAt ? { scheduledAt } : {}) },
    });
    approved += count;
  }
  return { approved };
}

/**
 * Takes a scheduled post back to "Needs review" (the safety window of auto-approval: nothing goes out that the owner
 * wants to look at first). Refused once the publisher has picked it up.
 */
export async function unschedulePost(owner: Owner, postId: string): Promise<void> {
  const { count } = await prisma.post.updateMany({
    where: { id: postId, businessId: owner.businessId, status: "SCHEDULED", lockedAt: null },
    data: { status: "PENDING_APPROVAL", autoScheduledAt: null },
  });
  if (count === 0) {
    const post = await prisma.post.findFirst({ where: { id: postId, businessId: owner.businessId }, select: { status: true } });
    if (!post) throw NOT_FOUND();
    throw new PublishingError(NO_LONGER_EDITABLE, "conflict");
  }
}

/** Puts a failed post back in line to be published now. */
export async function retryPost(owner: Owner, postId: string, now = new Date()): Promise<void> {
  const post = await ownedPost(owner.businessId, postId);
  if (post.status !== "FAILED") throw new PublishingError("Only a failed post can be retried.", "conflict");
  const { count } = await prisma.post.updateMany({
    where: { id: postId, businessId: owner.businessId, status: "FAILED" },
    data: { status: "SCHEDULED", scheduledAt: now, attempts: 0, nextAttemptAt: null, lockedAt: null, lastError: null },
  });
  if (count === 0) throw new PublishingError(NO_LONGER_EDITABLE, "conflict");
}

/** "Mark as posted": the owner posted a reminder post by hand. */
export async function markPosted(businessId: string, postId: string, now = new Date()): Promise<void> {
  const { count } = await prisma.post.updateMany({
    where: { id: postId, businessId, status: "NEEDS_ACTION" },
    data: { status: "PUBLISHED", publishedAt: now, lastError: null },
  });
  if (count === 0) {
    const post = await prisma.post.findFirst({ where: { id: postId, businessId }, select: { status: true } });
    if (!post) throw NOT_FOUND();
    if (post.status !== "PUBLISHED") throw new PublishingError("This post is not waiting for you to post it.", "conflict");
  }
}

/** The "I posted it" link in the reminder email. The signed token has already proved who it is for. */
export async function markPostedFromEmail(postId: string, now = new Date()): Promise<{ found: boolean }> {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { businessId: true } });
  if (!post) return { found: false };
  await markPosted(post.businessId, postId, now).catch((error) => {
    if (!(error instanceof PublishingError)) throw error;
  });
  return { found: true };
}

/** Saves the business's time zone (set once from the calendar when it is still "UTC"). */
export async function setBusinessTimezone(businessId: string, timezone: string): Promise<void> {
  await prisma.business.update({ where: { id: businessId }, data: { timezone } });
}
