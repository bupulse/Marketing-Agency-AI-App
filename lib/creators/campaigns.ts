import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { linkSiteUrl } from "@/lib/auth/request-site";
import { getPlanLimits } from "@/lib/plan-catalog";
import { creatorsPerCampaignLimit, liveCampaignsLimit } from "@/lib/plans";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { companyRegion } from "@/lib/region";
import { hashToken, newInviteToken } from "@/lib/team/service";
import { askMessage, can, type Role } from "@/lib/team/roles";
import {
  campaignSchema,
  CREATOR_INVITE_DAYS,
  firstProblem,
  goalsSchema,
  readQuestions,
  taskSchema,
  taskSpans,
  type CampaignInput,
  type GoalsInput,
  type TaskInput,
  type TaskRepeat,
} from "./company-forms";
import { readPayRules, withoutPost, type PayoutBreakdown } from "./pay";
import { dayIn, periodsFor, ymdOf } from "./periods";
import { uniqueSlug } from "./slug";

// The company side of creator campaigns (docs/CREATOR_CAMPAIGNS.md): campaigns and their pay periods, tasks, picking
// applicants (single-use invite links), removing creators, rejecting posts, marking payouts paid and changing an open
// period's goals. Every function takes the acting person's company (from requireActiveUser) and checks the `creators`
// permission itself, and every row is looked up inside that company, so the pages, the actions and the tests share the
// rules. The feature (`creators` in the plan) is checked by the server actions (app/dashboard/creators/actions.ts).

export type CreatorCampaignErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "limit";

export class CreatorCampaignError extends Error {
  constructor(
    readonly code: CreatorCampaignErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CreatorCampaignError";
  }
}

/** The person acting: `requireActiveUser()` gives all of these. */
export type CampaignActor = { actorId: string; businessId: string; role: Role };

const json = (v: unknown) => v as Prisma.InputJsonValue;
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const INVITE_TTL_MS = CREATOR_INVITE_DAYS * 24 * 60 * 60 * 1000;

function assertManager(actor: CampaignActor) {
  if (!can(actor.role, "creators")) throw new CreatorCampaignError("forbidden", askMessage("creators"));
}

function parse<T>(result: { success: true; data: T } | { success: false; error: import("zod").ZodError }): T {
  if (!result.success) throw new CreatorCampaignError("invalid", firstProblem(result.error));
  return result.data;
}

/** One lock per campaign (or company) for the counted limits: the second request waits, then counts again. */
async function lock(tx: Pick<typeof prisma, "$executeRaw">, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`creators:${key}`}))`;
}

async function company(businessId: string) {
  const b = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, timezone: true, userId: true } });
  if (!b) throw new CreatorCampaignError("not_found", "Finish setting up your business first.");
  return b;
}

/** The plan limits of creator campaigns (lib/plans.ts): the plan the company account's subscription is on. */
export async function campaignLimits(businessId: string): Promise<{ liveCampaigns: number; creatorsPerCampaign: number }> {
  const b = await prisma.business.findUnique({ where: { id: businessId }, select: { user: { select: { subscription: { select: { plan: true } } } } } });
  const limits = await getPlanLimits(b?.user.subscription?.plan ?? "TRIAL");
  return { liveCampaigns: liveCampaignsLimit(limits), creatorsPerCampaign: creatorsPerCampaignLimit(limits) };
}

async function campaignOf(actor: CampaignActor, id: string) {
  const c = await prisma.creatorCampaign.findFirst({ where: { id, businessId: actor.businessId } });
  if (!c) throw new CreatorCampaignError("not_found", "That campaign no longer exists.");
  return c;
}

// ---- reads ---------------------------------------------------------------------------------------------------------

export async function listCampaigns(actor: CampaignActor) {
  assertManager(actor);
  const rows = await prisma.creatorCampaign.findMany({
    where: { businessId: actor.businessId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, slug: true, status: true, startsOn: true, endsOn: true, platforms: true, acceptingApplications: true, _count: { select: { tasks: true } } },
  });
  const groups = rows.length
    ? await prisma.campaignCreator.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  const n = (id: string, status: string) => groups.find((g) => g.campaignId === id && g.status === status)?._count._all ?? 0;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    startsOn: ymdOf(r.startsOn),
    endsOn: ymdOf(r.endsOn),
    platforms: r.platforms,
    acceptingApplications: r.acceptingApplications,
    tasks: r._count.tasks,
    applied: n(r.id, "APPLIED"),
    joined: n(r.id, "JOINED"),
  }));
}
export type CampaignRow = Awaited<ReturnType<typeof listCampaigns>>[number];

/** A campaign with what every one of its pages needs at the top. */
export async function getCampaign(actor: CampaignActor, id: string) {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  const [b, applied, tasks] = await Promise.all([company(actor.businessId), prisma.campaignCreator.count({ where: { campaignId: id, status: "APPLIED" } }), prisma.creatorTask.count({ where: { campaignId: id } })]);
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    brief: c.brief,
    rules: c.rules,
    status: c.status,
    acceptingApplications: c.acceptingApplications,
    startsOn: ymdOf(c.startsOn),
    endsOn: ymdOf(c.endsOn),
    platforms: c.platforms,
    mentions: c.mentions,
    currency: c.currency,
    payRules: readPayRules(c.payRules),
    viewTargetPerCreator: c.viewTargetPerCreator,
    viewTargetCampaign: c.viewTargetCampaign,
    questions: readQuestions(c.questions),
    timezone: b.timezone,
    companyName: b.name,
    applied,
    tasks,
  };
}
export type CampaignView = Awaited<ReturnType<typeof getCampaign>>;

/** The currency a new campaign starts with: the company's region's (RWF in Rwanda). */
export async function defaultCurrency(businessId: string): Promise<string> {
  return (await companyRegion(businessId).catch(() => null))?.currency?.toUpperCase() ?? "RWF";
}

export async function listTasks(actor: CampaignActor, campaignId: string) {
  assertManager(actor);
  await campaignOf(actor, campaignId);
  const rows = await prisma.creatorTask.findMany({ where: { campaignId }, orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }], include: { _count: { select: { submissions: true } } } });
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    instructions: t.instructions,
    startsOn: ymdOf(t.startsOn),
    endsOn: ymdOf(t.endsOn),
    postsPerDay: t.postsPerDay,
    platforms: t.platforms,
    platformMode: t.platformMode as "ALL" | "ANY",
    mediaKind: t.mediaKind as "VIDEO" | "IMAGE" | "ANY",
    submissions: t._count.submissions,
  }));
}
export type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];

/** Everyone who applied to the campaign, newest first, with what they sent. */
export async function listCampaignCreators(actor: CampaignActor, campaignId: string) {
  assertManager(actor);
  await campaignOf(actor, campaignId);
  const rows = await prisma.campaignCreator.findMany({ where: { campaignId }, orderBy: [{ createdAt: "desc" }] });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    name: r.name,
    email: r.email,
    phone: r.phone,
    handles: readHandles(r.handles),
    samples: r.samples,
    answers: (r.answers && typeof r.answers === "object" ? r.answers : {}) as Record<string, string>,
    inviteExpiresAt: r.inviteExpiresAt?.toISOString() ?? null,
    appliedAt: r.createdAt.toISOString(),
    joinedAt: r.joinedAt?.toISOString() ?? null,
    removedAt: r.removedAt?.toISOString() ?? null,
  }));
}
export type CampaignCreatorRow = Awaited<ReturnType<typeof listCampaignCreators>>[number];

/** CampaignCreator.handles as stored (Json): [{ network, handle, followers }]. */
export function readHandles(value: unknown): { network: string; handle: string; followers: number | null }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((h) => {
    if (!h || typeof h !== "object") return [];
    const { network, handle, followers } = h as Record<string, unknown>;
    if (typeof network !== "string" || typeof handle !== "string") return [];
    return [{ network, handle, followers: typeof followers === "number" && Number.isFinite(followers) ? followers : null }];
  });
}

// ---- campaigns ------------------------------------------------------------------------------------------------------

/**
 * Creates a campaign as a DRAFT with its 30-day pay periods (lib/creators/periods.ts, in the company's timezone), each
 * starting with the goals given. Its public page is /c/<slug>.
 */
export async function createCampaign(actor: CampaignActor, input: CampaignInput) {
  assertManager(actor);
  const v = parse(campaignSchema.safeParse(input));
  const b = await company(actor.businessId);
  if (v.startsOn < dayIn(new Date(), b.timezone)) throw new CreatorCampaignError("invalid", "The first day cannot be in the past.");
  const periods = periodsFor(v.startsOn, v.endsOn, b.timezone);
  const slug = await uniqueSlug(v.name, async (s) => (await prisma.creatorCampaign.count({ where: { slug: s } })) > 0);
  const row = await prisma.creatorCampaign.create({
    data: {
      businessId: actor.businessId,
      slug,
      name: v.name,
      brief: v.brief,
      rules: v.rules || null,
      platforms: v.platforms,
      mentions: v.mentions,
      currency: v.currency,
      payRules: json(v.payRules),
      viewTargetPerCreator: v.viewTargetPerCreator ?? null,
      viewTargetCampaign: v.viewTargetCampaign ?? null,
      questions: json(v.questions),
      startsOn: day(v.startsOn),
      endsOn: day(v.endsOn),
      createdBy: actor.actorId,
      periods: {
        create: periods.map((p) => ({ index: p.index, startsAt: p.startsAt, endsAt: p.endsAt, viewTargetPerCreator: v.viewTargetPerCreator ?? null, viewTargetCampaign: v.viewTargetCampaign ?? null, budget: v.budget ?? null })),
      },
    },
    select: { id: true, slug: true },
  });
  return row;
}

/**
 * Saves the campaign's settings. Dates and currency change only while it is a draft (its periods are made again);
 * afterwards the pay rules apply to every period still open (closed ones keep what they paid), and new default goals
 * and budget go to the periods that have not started yet.
 */
export async function updateCampaign(actor: CampaignActor, id: string, input: CampaignInput, now = new Date()) {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  if (c.status === "ENDED") throw new CreatorCampaignError("conflict", "This campaign has ended and can no longer be changed.");
  const v = parse(campaignSchema.safeParse(input));
  const draft = c.status === "DRAFT";
  const datesChanged = v.startsOn !== ymdOf(c.startsOn) || v.endsOn !== ymdOf(c.endsOn);
  if (!draft && (datesChanged || v.currency !== c.currency)) throw new CreatorCampaignError("conflict", "The dates and the currency can be changed only while the campaign is a draft.");
  const b = await company(actor.businessId);
  if (draft && datesChanged && v.startsOn < dayIn(now, b.timezone)) throw new CreatorCampaignError("invalid", "The first day cannot be in the past.");

  // Tasks keep only platforms the campaign still has; one left with none must be changed first.
  const tasks = await prisma.creatorTask.findMany({ where: { campaignId: id }, select: { id: true, title: true, platforms: true, startsOn: true, endsOn: true } });
  const keep = new Set<string>(v.platforms);
  const orphan = tasks.find((t) => !t.platforms.some((p) => keep.has(p)));
  if (orphan) throw new CreatorCampaignError("invalid", `The task "${orphan.title}" uses only platforms you took off. Change or delete it first.`);
  if (draft && datesChanged) {
    const outside = tasks.find((t) => ymdOf(t.startsOn) < v.startsOn || ymdOf(t.endsOn) > v.endsOn);
    if (outside) throw new CreatorCampaignError("invalid", `The task "${outside.title}" falls outside the new dates. Change it first.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.creatorCampaign.update({
      where: { id },
      data: {
        name: v.name,
        brief: v.brief,
        rules: v.rules || null,
        platforms: v.platforms,
        mentions: v.mentions,
        currency: v.currency,
        payRules: json(v.payRules),
        viewTargetPerCreator: v.viewTargetPerCreator ?? null,
        viewTargetCampaign: v.viewTargetCampaign ?? null,
        questions: json(v.questions),
        startsOn: day(v.startsOn),
        endsOn: day(v.endsOn),
      },
    });
    for (const t of tasks) {
      const platforms = t.platforms.filter((p) => keep.has(p));
      if (platforms.length !== t.platforms.length) await tx.creatorTask.update({ where: { id: t.id }, data: { platforms } });
    }
    const goals = { viewTargetPerCreator: v.viewTargetPerCreator ?? null, viewTargetCampaign: v.viewTargetCampaign ?? null, budget: v.budget ?? null };
    if (draft && datesChanged) {
      await tx.creatorPeriod.deleteMany({ where: { campaignId: id } });
      await tx.creatorPeriod.createMany({ data: periodsFor(v.startsOn, v.endsOn, b.timezone).map((p) => ({ campaignId: id, index: p.index, startsAt: p.startsAt, endsAt: p.endsAt, ...goals })) });
    } else {
      await tx.creatorPeriod.updateMany({ where: { campaignId: id, status: "OPEN", ...(draft ? {} : { startsAt: { gt: now } }) }, data: goals });
    }
  });
}

/** The budget the next periods start with: the first period not started yet, else the last one. For the settings form. */
export async function defaultBudget(campaignId: string, now = new Date()): Promise<number | null> {
  const next = (await prisma.creatorPeriod.findFirst({ where: { campaignId, startsAt: { gt: now } }, orderBy: { index: "asc" }, select: { budget: true } })) ?? (await prisma.creatorPeriod.findFirst({ where: { campaignId }, orderBy: { index: "desc" }, select: { budget: true } }));
  return next?.budget ?? null;
}

/**
 * DRAFT → LIVE (needs a task, a last day still ahead and a free place under the plan's `liveCampaigns`), LIVE ⇄ PAUSED,
 * and any → ENDED. Ending stops applications and hand-ins; the period running now still closes on its day and pays as
 * usual, and periods that had not started are deleted.
 */
export async function setCampaignStatus(actor: CampaignActor, id: string, next: "LIVE" | "PAUSED" | "ENDED", now = new Date()) {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  if (c.status === next) return { status: next };
  if (c.status === "ENDED") throw new CreatorCampaignError("conflict", "This campaign has ended.");
  if (next === "PAUSED" && c.status !== "LIVE") throw new CreatorCampaignError("conflict", "Only a live campaign can be paused.");
  if (next === "LIVE") {
    const b = await company(actor.businessId);
    if (ymdOf(c.endsOn) < dayIn(now, b.timezone)) throw new CreatorCampaignError("invalid", "The campaign's last day has passed. Change its dates first.");
    if (c.status === "DRAFT" && (await prisma.creatorTask.count({ where: { campaignId: id } })) === 0) throw new CreatorCampaignError("invalid", "Add at least one task first, so creators know what to post.");
  }
  const limits = next === "LIVE" && c.status === "DRAFT" ? await campaignLimits(actor.businessId) : null;
  await prisma.$transaction(async (tx) => {
    if (limits) {
      await lock(tx, actor.businessId);
      const running = await tx.creatorCampaign.count({ where: { businessId: actor.businessId, status: { in: ["LIVE", "PAUSED"] }, id: { not: id } } });
      if (running >= limits.liveCampaigns) {
        throw new CreatorCampaignError("limit", `Your plan allows ${limits.liveCampaigns} live ${limits.liveCampaigns === 1 ? "campaign" : "campaigns"} at a time (paused ones count). End one first, or ask for a bigger plan.`);
      }
    }
    const done = await tx.creatorCampaign.updateMany({ where: { id, status: c.status }, data: { status: next, ...(next === "ENDED" ? { acceptingApplications: false } : {}) } });
    if (done.count === 0) throw new CreatorCampaignError("conflict", "Someone changed this campaign just now. Open it again.");
    if (next === "ENDED") await tx.creatorPeriod.deleteMany({ where: { campaignId: id, status: "OPEN", startsAt: { gt: now }, payouts: { none: {} } } });
  });
  return { status: next };
}

export async function setAcceptingApplications(actor: CampaignActor, id: string, on: boolean) {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  if (c.status === "ENDED" && on) throw new CreatorCampaignError("conflict", "This campaign has ended.");
  await prisma.creatorCampaign.update({ where: { id }, data: { acceptingApplications: on } });
}

/** A draft nobody applied to can be deleted; anything else is ended instead (its history stays). */
export async function deleteCampaign(actor: CampaignActor, id: string) {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  if (c.status !== "DRAFT") throw new CreatorCampaignError("conflict", "Only a draft can be deleted. End the campaign instead.");
  if ((await prisma.campaignCreator.count({ where: { campaignId: id } })) > 0) throw new CreatorCampaignError("conflict", "Creators already applied to this draft. End it instead.");
  await prisma.creatorCampaign.delete({ where: { id } });
}

// ---- tasks ----------------------------------------------------------------------------------------------------------

function checkTask(c: { startsOn: Date; endsOn: Date; platforms: string[] }, t: { startsOn: string; endsOn: string; platforms: string[] }) {
  if (t.startsOn < ymdOf(c.startsOn) || t.endsOn > ymdOf(c.endsOn)) throw new CreatorCampaignError("invalid", "The task's days must be inside the campaign's dates.");
  const extra = t.platforms.find((p) => !c.platforms.includes(p));
  if (extra) throw new CreatorCampaignError("invalid", "Pick platforms of the campaign only.");
}

/**
 * Adds a task, or one per week or per day of the span (owner decision: one task for the whole month, one per week, or
 * one per day). Repeated ones get "(week 2)" or the day after their title.
 */
export async function createTasks(actor: CampaignActor, campaignId: string, input: TaskInput, repeat: TaskRepeat = "none") {
  assertManager(actor);
  const c = await campaignOf(actor, campaignId);
  if (c.status === "ENDED") throw new CreatorCampaignError("conflict", "This campaign has ended.");
  const t = parse(taskSchema.safeParse(input));
  checkTask(c, t);
  const spans = taskSpans(t.startsOn, t.endsOn, repeat);
  const label = (s: { startsOn: string }, i: number) =>
    repeat === "week" ? `${t.title} (week ${i + 1})` : repeat === "day" ? `${t.title} (${new Date(`${s.startsOn}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })})` : t.title;
  const { count } = await prisma.creatorTask.createMany({
    data: spans.map((s, i) => ({ campaignId, title: label(s, i).slice(0, 140), instructions: t.instructions, startsOn: day(s.startsOn), endsOn: day(s.endsOn), postsPerDay: t.postsPerDay, platforms: t.platforms, platformMode: t.platformMode, mediaKind: t.mediaKind })),
  });
  return { count };
}

export async function updateTask(actor: CampaignActor, taskId: string, input: TaskInput) {
  assertManager(actor);
  const task = await prisma.creatorTask.findFirst({ where: { id: taskId, campaign: { businessId: actor.businessId } }, include: { campaign: true } });
  if (!task) throw new CreatorCampaignError("not_found", "That task no longer exists.");
  if (task.campaign.status === "ENDED") throw new CreatorCampaignError("conflict", "This campaign has ended.");
  const t = parse(taskSchema.safeParse(input));
  checkTask(task.campaign, t);
  await prisma.creatorTask.update({
    where: { id: taskId },
    data: { title: t.title, instructions: t.instructions, startsOn: day(t.startsOn), endsOn: day(t.endsOn), postsPerDay: t.postsPerDay, platforms: t.platforms, platformMode: t.platformMode, mediaKind: t.mediaKind },
  });
}

/** A task creators already handed in cannot be deleted (their posts and pay hang on it): change it instead. */
export async function deleteTask(actor: CampaignActor, taskId: string) {
  assertManager(actor);
  const task = await prisma.creatorTask.findFirst({ where: { id: taskId, campaign: { businessId: actor.businessId } }, select: { id: true, _count: { select: { submissions: true } } } });
  if (!task) throw new CreatorCampaignError("not_found", "That task no longer exists.");
  if (task._count.submissions > 0) throw new CreatorCampaignError("conflict", "Creators already handed in this task, so it cannot be deleted. Change its days or words instead.");
  await prisma.creatorTask.delete({ where: { id: taskId } });
}

// ---- applicants and creators ----------------------------------------------------------------------------------------

async function creatorOf(actor: CampaignActor, campaignCreatorId: string) {
  const row = await prisma.campaignCreator.findFirst({ where: { id: campaignCreatorId, campaign: { businessId: actor.businessId } }, include: { campaign: { select: { id: true, name: true, status: true } } } });
  if (!row) throw new CreatorCampaignError("not_found", "That creator is no longer in this campaign.");
  return row;
}

async function sendInviteEmail(to: string, name: string, campaign: string, companyName: string, link: string): Promise<boolean> {
  const { html, text } = renderEmail({
    heading: `You're in: ${campaign}`,
    intro: `Hi ${name.trim().split(/\s+/)[0] || "there"}, ${companyName} picked you for their creator campaign "${campaign}" on BuPulse. Open the link to make your creator login, connect your accounts and see your tasks.`,
    button: { label: "Join the campaign", url: link },
    footer: `This link works once and expires in ${CREATOR_INVITE_DAYS} days. If you did not apply, you can ignore this email.`,
  });
  return sendEmail({ to, subject: `${companyName} picked you for "${campaign}"`, html, text }).catch(() => false);
}

/** A fresh single-use link for the creator (any older one stops working), emailed to them. */
async function issueInvite(id: string, tx: Pick<typeof prisma, "campaignCreator"> = prisma) {
  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await tx.campaignCreator.update({ where: { id }, data: { inviteTokenHash: await hashToken(token), inviteExpiresAt: expiresAt } });
  return { token, expiresAt };
}

async function deliver(actor: CampaignActor, row: { name: string; email: string; phone: string | null; campaign: { name: string } }, token: string, expiresAt: Date) {
  const link = `${await linkSiteUrl()}/creator/join/${token}`;
  const b = await company(actor.businessId);
  const sent = await sendInviteEmail(row.email, row.name, row.campaign.name, b.name, link);
  return { link, sent, expiresAt: expiresAt.toISOString(), name: row.name, phone: row.phone, companyName: b.name, campaignName: row.campaign.name };
}

/**
 * Picks an applicant: SELECTED, with a single-use invite link (only its sha-256 is stored, 14 days) emailed to them and
 * returned for WhatsApp. Refused past the plan's `creatorsPerCampaign` (SELECTED and JOINED count).
 */
export async function selectApplicant(actor: CampaignActor, campaignCreatorId: string) {
  assertManager(actor);
  const row = await creatorOf(actor, campaignCreatorId);
  if (row.campaign.status === "ENDED") throw new CreatorCampaignError("conflict", "This campaign has ended.");
  if (row.status !== "APPLIED" && row.status !== "DECLINED") throw new CreatorCampaignError("conflict", row.status === "SELECTED" ? "Already invited. Send a new link instead." : "This creator is not waiting for an answer.");
  const { creatorsPerCampaign } = await campaignLimits(actor.businessId);
  const invite = await prisma.$transaction(async (tx) => {
    await lock(tx, row.campaign.id);
    const picked = await tx.campaignCreator.count({ where: { campaignId: row.campaign.id, status: { in: ["SELECTED", "JOINED"] } } });
    if (picked >= creatorsPerCampaign) throw new CreatorCampaignError("limit", `Your plan allows ${creatorsPerCampaign} creators in one campaign, and all places are taken. Remove someone first, or ask for a bigger plan.`);
    const done = await tx.campaignCreator.updateMany({ where: { id: row.id, status: row.status }, data: { status: "SELECTED", selectedAt: new Date() } });
    if (done.count === 0) throw new CreatorCampaignError("conflict", "Someone changed this application just now. Open the page again.");
    return issueInvite(row.id, tx);
  });
  return deliver(actor, row, invite.token, invite.expiresAt);
}

/** A new link for an invited creator who has not joined yet (the old link stops working). */
export async function resendInvite(actor: CampaignActor, campaignCreatorId: string) {
  assertManager(actor);
  const row = await creatorOf(actor, campaignCreatorId);
  if (row.status !== "SELECTED") throw new CreatorCampaignError("conflict", row.status === "JOINED" ? "This creator already joined." : "Pick this creator first.");
  const invite = await issueInvite(row.id);
  return deliver(actor, row, invite.token, invite.expiresAt);
}

/** No to an applicant (or to an invited creator who has not joined: their link stops working). */
export async function declineApplicant(actor: CampaignActor, campaignCreatorId: string) {
  assertManager(actor);
  const row = await creatorOf(actor, campaignCreatorId);
  if (row.status !== "APPLIED" && row.status !== "SELECTED") throw new CreatorCampaignError("conflict", "Only an applicant or an invited creator can be declined.");
  await prisma.campaignCreator.update({ where: { id: row.id }, data: { status: "DECLINED", inviteTokenHash: null, inviteExpiresAt: null } });
}

/**
 * Takes a creator out of the campaign: they can no longer hand in. Posts they handed in keep what they earn in the
 * period running now (reject them to take that away); payouts already written stay theirs.
 */
export async function removeCreator(actor: CampaignActor, campaignCreatorId: string) {
  assertManager(actor);
  const row = await creatorOf(actor, campaignCreatorId);
  if (row.status !== "JOINED" && row.status !== "SELECTED") throw new CreatorCampaignError("conflict", "Only a creator in the campaign can be removed.");
  await prisma.campaignCreator.update({ where: { id: row.id }, data: { status: "REMOVED", removedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null } });
}

// ---- posts ----------------------------------------------------------------------------------------------------------

/** Statuses a post can be rejected from: anything that earns or may still earn. */
const REJECTABLE = ["CHECKING", "TRACKING", "FINAL"];

const reasonOf = (reason: string) => {
  const r = reason.trim();
  if (r.length < 3) throw new CreatorCampaignError("invalid", "Say why, in a few words: the creator sees it.");
  return r.slice(0, 500);
};

/** "Lose that post" (owner decision) in payouts not paid yet: its pay there drops to 0. Paid ones are taken back at the next close. */
async function dropFromDuePayouts(tx: Pick<typeof prisma, "creatorPayout">, campaignCreatorId: string, postIds: string[]) {
  const due = await tx.creatorPayout.findMany({ where: { campaignCreatorId, status: "DUE" }, select: { id: true, breakdown: true } });
  for (const p of due) {
    let b = p.breakdown as unknown as PayoutBreakdown;
    let changed: ReturnType<typeof withoutPost> = null;
    for (const postId of postIds) {
      const next = withoutPost(b, postId);
      if (next) {
        changed = next;
        b = next.breakdown;
      }
    }
    if (changed) await tx.creatorPayout.update({ where: { id: p.id }, data: { amount: changed.amount, deductions: changed.deductions, breakdown: json(changed.breakdown) } });
  }
}

/** Rejects one post of a submission, with the reason the creator sees. It earns nothing from now on. */
export async function rejectPost(actor: CampaignActor, postId: string, reason: string) {
  assertManager(actor);
  const why = reasonOf(reason);
  const post = await prisma.creatorPost.findFirst({ where: { id: postId, campaign: { businessId: actor.businessId } }, select: { id: true, status: true, campaignCreatorId: true } });
  if (!post) throw new CreatorCampaignError("not_found", "That post no longer exists.");
  if (!REJECTABLE.includes(post.status)) throw new CreatorCampaignError("conflict", "This post does not earn anything, so there is nothing to reject.");
  await prisma.$transaction(async (tx) => {
    await tx.creatorPost.update({ where: { id: post.id }, data: { status: "REJECTED", statusReason: why } });
    await dropFromDuePayouts(tx, post.campaignCreatorId, [post.id]);
  });
}

/** Rejects a whole hand-in (every post of it), with the reason the creator sees. */
export async function rejectSubmission(actor: CampaignActor, submissionId: string, reason: string) {
  assertManager(actor);
  const why = reasonOf(reason);
  const sub = await prisma.creatorSubmission.findFirst({ where: { id: submissionId, campaign: { businessId: actor.businessId } }, select: { id: true, status: true, campaignCreatorId: true, posts: { select: { id: true, status: true } } } });
  if (!sub) throw new CreatorCampaignError("not_found", "That hand-in no longer exists.");
  if (sub.status === "REJECTED") throw new CreatorCampaignError("conflict", "This hand-in was already rejected.");
  const ids = sub.posts.filter((p) => REJECTABLE.includes(p.status)).map((p) => p.id);
  await prisma.$transaction(async (tx) => {
    await tx.creatorSubmission.update({ where: { id: sub.id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectReason: why } });
    if (ids.length) {
      await tx.creatorPost.updateMany({ where: { id: { in: ids } }, data: { status: "REJECTED", statusReason: why } });
      await dropFromDuePayouts(tx, sub.campaignCreatorId, ids);
    }
  });
  return { posts: ids.length };
}

// ---- payouts and goals ----------------------------------------------------------------------------------------------

/** The company paid the creator by Mobile Money: PAID, with the reference it typed. */
export async function markPayoutPaid(actor: CampaignActor, payoutId: string, reference: string) {
  assertManager(actor);
  const ref = reference.trim();
  if (ref.length < 3 || ref.length > 60) throw new CreatorCampaignError("invalid", "Type the Mobile Money reference of the payment (3 to 60 characters).");
  const payout = await prisma.creatorPayout.findFirst({ where: { id: payoutId, period: { campaign: { businessId: actor.businessId } } }, select: { id: true, status: true } });
  if (!payout) throw new CreatorCampaignError("not_found", "That payout no longer exists.");
  const done = await prisma.creatorPayout.updateMany({ where: { id: payout.id, status: "DUE" }, data: { status: "PAID", paidAt: new Date(), paidBy: actor.actorId, reference: ref } });
  if (done.count === 0) throw new CreatorCampaignError("conflict", "This payout is already marked paid.");
}

/** An open period's goals: view targets and budget. Closed periods keep theirs. */
export async function updatePeriodGoals(actor: CampaignActor, periodId: string, input: GoalsInput) {
  assertManager(actor);
  const g = parse(goalsSchema.safeParse(input));
  const period = await prisma.creatorPeriod.findFirst({ where: { id: periodId, campaign: { businessId: actor.businessId } }, select: { id: true, status: true } });
  if (!period) throw new CreatorCampaignError("not_found", "That pay period no longer exists.");
  const done = await prisma.creatorPeriod.updateMany({ where: { id: period.id, status: "OPEN" }, data: { viewTargetPerCreator: g.viewTargetPerCreator ?? null, viewTargetCampaign: g.viewTargetCampaign ?? null, budget: g.budget ?? null } });
  if (done.count === 0) throw new CreatorCampaignError("conflict", "This period is closed: its payouts are written.");
}
