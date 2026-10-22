import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import "server-only";
import { prisma } from "@/lib/db";
import { resolveSubject, subjectColumns } from "@/lib/knowledge/service";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { composeSchema, editSchema, isOwnMediaPath, type ComposeParsed } from "./schemas";
import { cleanSlotTimes, nextFreeSlots } from "./slots";
import { bestTime, MIN_GAP_MINUTES } from "./best-time";
import { buildProfile, preferredHours, preferredWeekdays } from "@/lib/autopilot/learning";
import { loadPostResults } from "@/lib/autopilot/results";
import { EDITABLE, QUEUED, type PostStatusName } from "./status";
import { parseLocalInput } from "./time";
import { formatFor, validatePost, type PostFormatName } from "./validate";
import type { ComposeInput, EditInput } from "./types";
import { composerMediaFor, isVideoPath, trimNote, videoFitsNetwork } from "@/lib/visuals/post-media";
import { readyMedia } from "@/lib/visuals/service";
import { CONTEST_NOTE, contestAfterEdit, contestBlocked } from "@/lib/content-flow/contest";
import { addVersion, keepBaseline } from "@/lib/content-flow/post-versions";
import { piecesOf } from "@/lib/content-flow/versions";
import { recordStudioOutcome } from "@/lib/video-studio/outcomes";

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

/** The company (its account and business) and, when known, the person acting: their edits are named in a post's versions. */
export type Owner = { businessId: string; userId: string; actorId?: string | null };

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
  // Photos only: a video's shape is not held to Instagram's photo ratios.
  const rows = await prisma.mediaAsset.findMany({ where: { businessId, path: { in: paths }, kind: "photo" }, select: { width: true, height: true } });
  return rows;
}

async function galleryVideoLengths(businessId: string, paths: string[]): Promise<Map<string, number>> {
  const videos = paths.filter(isVideoPath);
  if (videos.length === 0) return new Map();
  const rows = await prisma.mediaAsset.findMany({ where: { businessId, path: { in: videos }, kind: "video" }, select: { path: true, durationMs: true } });
  return new Map(rows.flatMap((r) => (r.durationMs ? [[r.path, r.durationMs] as const] : [])));
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
  // The owner's own Gallery videos and their lengths (docs/MEDIA.md): one too long for a network stays out of it.
  const videoMs = await galleryVideoLengths(owner.businessId, data.mediaPaths);
  const rows = ordered.map((connection) => {
    if (!isNetwork(connection.provider)) throw new PublishingError("That account cannot be posted to.", "invalid");
    const network = connection.provider;
    const rules = getProvider(network).rules;
    const override = data.overrides[network];
    const text = override?.text ?? data.text;
    const hashtags = override?.hashtags ?? data.hashtags;
    let mediaPaths = composerMediaFor(network, rules.videoOnly, data.mediaPaths, visual.images, videoMs);
    const tooLong = data.mediaPaths.some((p) => isVideoPath(p) && !videoFitsNetwork(network, videoMs.get(p)));
    if (!draft && tooLong && rules.videoOnly && !mediaPaths.some(isVideoPath) && !visual.video) problems.push(`${connection.displayName ?? rules.label}: ${trimNote(network)}`);
    if (rules.videoOnly && visual.video && !mediaPaths.some(isVideoPath)) mediaPaths = [visual.video];
    const format: PostFormatName = formatFor(rules, mediaPaths.length, mediaPaths.some(isVideoPath));
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
  const creates = rows.map((row) =>
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
  );
  // Scheduled from Studio content by hand: the drafts BuPulse made of that content for the same accounts are replaced,
  // in the same transaction, unless the owner already edited them.
  // The owner's edited drafts are kept as history but cancelled (superseded), so the account never gets two posts.
  const draftsOf = { businessId: owner.businessId, contentId: content?.id, source: { in: ["STUDIO" as const, "DAILY" as const] }, status: "PENDING_APPROVAL" as const, connectionId: { in: ordered.map((c) => c.id) } };
  const replace =
    !draft && content
      ? [
          prisma.post.deleteMany({ where: { ...draftsOf, ownerEditedAt: null } }),
          prisma.post.updateMany({ where: { ...draftsOf, ownerEditedAt: { not: null } }, data: { status: "CANCELLED", reviewNote: "Replaced by the post you scheduled." } }),
        ]
      : [];
  const created = (await prisma.$transaction([...creates, ...replace])).slice(0, creates.length) as { id: string }[];
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
  const format = formatFor(rules, data.mediaPaths.length, data.mediaPaths.some(isVideoPath));
  const settings = await businessSettings(owner.businessId);
  const time = await resolveTime(data.when, { ...settings, connectionIds: post.connectionId ? [post.connectionId] : [], now });
  const becomesDraft = time ? time.status === "DRAFT" : post.status === "DRAFT";
  if (!becomesDraft) {
    const issues = validatePost(rules, { format, text: data.text, hashtags: data.hashtags, mediaCount: data.mediaPaths.length, mediaSizes: post.network === "instagram" ? await mediaSizes(owner.businessId, data.mediaPaths) : [] }).errors;
    if (issues.length > 0) throw new PublishingError(issues[0], "invalid", { form: issues.join(" ") });
    if (time && !post.remindOnly && (!post.connection || !accountUsable(post.connection))) throw new PublishingError("This account needs to be reconnected first. Open Channels to fix it.", "invalid");
  } else if (!data.text.trim() && data.mediaPaths.length === 0) {
    throw new PublishingError("Write something or add a photo to save a draft.", "invalid");
  }

  const update: Prisma.PostUpdateManyMutationInput = { text: data.text.trim(), hashtags: data.hashtags, mediaPaths: data.mediaPaths, link: data.link, format, ownerEditedAt: now };
  // A contest edited away from its confirmed prize, end date or winner rule needs confirming again; until then it
  // cannot be scheduled, and a scheduled one goes back to waiting (lib/content-flow/contest.ts).
  const contest = contestAfterEdit(post.contest, update.text as string);
  if (contest) {
    update.contest = contest;
    if (contestBlocked({ text: update.text as string, contest })) {
      if (time?.status === "SCHEDULED") throw new PublishingError(CONTEST_NOTE, "invalid", { form: CONTEST_NOTE });
      if (!time && post.status === "SCHEDULED") Object.assign(update, { status: "PENDING_APPROVAL", reviewNote: CONTEST_NOTE, autoScheduledAt: null });
    }
  }
  if (time) {
    update.status = time.status;
    update.scheduledAt = time.scheduledAt;
    update.attempts = 0;
    update.nextAttemptAt = null;
    update.lockedAt = null;
    update.lastError = null;
  }
  // A change of the words keeps the post's versions (docs/CONTENT.md, "Versions"): the words before, then the new ones.
  const wordsChanged = update.text !== post.text || data.hashtags.length !== post.hashtags.length || data.hashtags.some((h, i) => h !== post.hashtags[i]);
  const content = wordsChanged && post.contentId ? await prisma.generatedContent.findFirst({ where: { id: post.contentId, businessId: owner.businessId }, select: { videoScript: true, adHeadlines: true } }) : null;
  const before = piecesOf(post, content);
  if (wordsChanged) await keepBaseline(prisma, post, before, now);
  const { count } = await prisma.post.updateMany({ where: { id: postId, businessId: owner.businessId, status: { in: [...EDITABLE] } }, data: update });
  if (count === 0) throw new PublishingError(NO_LONGER_EDITABLE, "conflict");
  if (wordsChanged) await addVersion(prisma, post, { ...before, text: update.text as string, hashtags: data.hashtags }, { kind: "edit", actorId: owner.actorId }, new Date(Math.max(now.getTime(), Date.now())));
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
  if (revive && contestBlocked(post)) throw new PublishingError(CONTEST_NOTE, "invalid");
  const { count } = await prisma.post.updateMany({
    where: { id: postId, businessId: owner.businessId, status: post.status },
    data: revive ? { scheduledAt, status: "SCHEDULED", attempts: 0, nextAttemptAt: null, lockedAt: null, lastError: null, ownerEditedAt: now } : { scheduledAt, ownerEditedAt: now },
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

type SlotDb = Pick<typeof prisma, "$executeRaw" | "post">;

/**
 * Writes a post's new time only if no other queued post on the same account is within 2.5 hours of it, checked and
 * written under a per-account lock, so two approvals or auto-approvals running at once cannot stack posts. `where`
 * guards the write (status, and for auto-approval the updatedAt read with the safety checks).
 * "taken": the time collides, pick another; "changed": the post changed meanwhile; "ok": written.
 */
export async function claimSlot(
  args: { businessId: string; postId: string; connectionId: string | null; at: Date; where: Prisma.PostWhereInput; data: Prisma.PostUpdateManyMutationInput },
): Promise<"ok" | "taken" | "changed"> {
  const gap = MIN_GAP_MINUTES * 60_000;
  return prisma.$transaction(async (tx: SlotDb) => {
    if (args.connectionId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`post-slot:${args.connectionId}`}))`;
      const clash = await tx.post.findFirst({
        where: { connectionId: args.connectionId, id: { not: args.postId }, status: { in: [...QUEUED] }, scheduledAt: { gt: new Date(args.at.getTime() - gap), lt: new Date(args.at.getTime() + gap) } },
        select: { id: true },
      });
      if (clash) return "taken";
    }
    const { count } = await tx.post.updateMany({ where: { id: args.postId, businessId: args.businessId, ...args.where }, data: { ...args.data, scheduledAt: args.at } });
    return count > 0 ? "ok" : "changed";
  });
}

/**
 * claimSlot, picking a new best time (up to 3 times) when another post took the slot first. "ok": written; "taken": no
 * free time was found; "changed": the post changed meanwhile (the guard in `where` failed).
 */
export async function scheduleAtFreeSlot(
  post: { id: string; network: string; connectionId: string | null },
  first: Date,
  args: { businessId: string; where: Prisma.PostWhereInput; data: Prisma.PostUpdateManyMutationInput; now: Date },
): Promise<"ok" | "taken" | "changed"> {
  let at = first;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await claimSlot({ businessId: args.businessId, postId: post.id, connectionId: post.connectionId, at, where: args.where, data: args.data });
    if (result !== "taken") return result;
    at = (await bestTimesFor(args.businessId, [post], args.now)).get(post.id) ?? at;
  }
  return "taken";
}

/**
 * Approves posts waiting for review (Autopilot's and Studio's) so they are published. Only this business's posts
 * that still wait are touched. A post keeps its planned time when that is still ahead; one without a time, or whose
 * time passed, goes out at the best time for its network.
 */
export async function approvePosts(businessId: string, postIds: string[], now = new Date()): Promise<{ approved: number; skipped: number }> {
  const ids = [...new Set(postIds)].slice(0, 200);
  if (ids.length === 0) return { approved: 0, skipped: 0 };
  const found = await prisma.post.findMany({ where: { id: { in: ids }, businessId, status: "PENDING_APPROVAL" }, select: { id: true, network: true, connectionId: true, scheduledAt: true, text: true, contest: true } });
  // A contest waits until the owner confirmed its prize and rules (lib/content-flow/contest.ts).
  const posts = found.filter((p) => !contestBlocked(p));
  if (posts.length === 0) return { approved: 0, skipped: found.length };

  const stale = posts.filter((p) => !p.scheduledAt || p.scheduledAt.getTime() <= now.getTime());
  const times = stale.length > 0 ? await bestTimesFor(businessId, stale, now) : new Map<string, Date>();

  // `skipped`: no free time could be found (every pick was taken by another post on the account): it stays in review.
  let approved = 0;
  let skipped = found.length - posts.length;
  for (const post of posts) {
    const scheduledAt = times.get(post.id);
    const data = { status: "SCHEDULED" as const, reviewNote: null };
    if (scheduledAt) {
      if ((await scheduleAtFreeSlot(post, scheduledAt, { businessId, where: { status: "PENDING_APPROVAL" }, data, now })) === "ok") approved += 1;
      else skipped += 1;
      continue;
    }
    const { count } = await prisma.post.updateMany({ where: { id: post.id, businessId, status: "PENDING_APPROVAL" }, data });
    approved += count;
  }
  return { approved, skipped };
}

/**
 * Takes a scheduled post back to "Needs review" (the safety window of auto-approval: nothing goes out that the owner
 * wants to look at first). Refused once the publisher has picked it up.
 */
export async function unschedulePost(owner: Owner, postId: string, now = new Date()): Promise<void> {
  const { count } = await prisma.post.updateMany({
    where: { id: postId, businessId: owner.businessId, status: "SCHEDULED", lockedAt: null },
    data: { status: "PENDING_APPROVAL", autoScheduledAt: null, ownerEditedAt: now },
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
  if (contestBlocked(post)) throw new PublishingError(CONTEST_NOTE, "invalid");
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
  if (count === 1) {
    // The owner posted a reminder by hand: a Video Studio MP4's outcome is recorded for the Brain (never fails this).
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, businessId: true, network: true, mediaPaths: true } });
    if (post) await recordStudioOutcome(post, now);
  }
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
