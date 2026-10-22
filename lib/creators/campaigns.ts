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
  OFFER_DAYS,
  PLATFORMS,
  readQuestions,
  taskSchema,
  taskSpans,
  type CampaignInput,
  type GoalsInput,
  type Platform,
  type TaskInput,
  type TaskRepeat,
} from "./company-forms";
import { defaultForm, readApplicationForm, type Answer } from "./form-fields";
import { paysAnything, readPayRules, withoutPost, type PayoutBreakdown } from "./pay";
import { dayIn, daysInclusive, MAX_CAMPAIGN_DAYS, periodsFor, ymdOf } from "./periods";
import { readRequirements } from "./requirements";
import { uniqueSlug } from "./slug";
import { addDaysYmd } from "@/lib/demo/slots";
import { MEDIA_MAX_FOLDERS } from "@/lib/media/rules";
import { readFiles, readLook, stepNumber, type CampaignFiles, type ReadinessFacts, type WizardStepId } from "./wizard";
import { suggestedPay, suggestedRequirements, withFields, type CampaignSuggestion } from "./wizard-suggest";
import {
  BRIEF_EVERY_VALUES,
  campaignFolderName,
  checkStep,
  FORMAT_VALUES,
  GOAL_VALUES,
  KIND_VALUES,
  mediaFromFormats,
  nameFromIdea,
  nextMonday,
  planTasks,
  reachedAfter,
  readinessProblems,
  taskTexts,
  tasksMatchSpans,
  type StepInput,
  type WizardAnswers,
} from "./wizard-steps";

// The company side of creator campaigns (docs/CREATOR_CAMPAIGNS.md): campaigns and their pay periods, tasks, picking
// applicants (single-use invite links, or straight in for creators with an account), removing creators, rejecting posts, marking payouts paid and changing an open
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
export async function lock(tx: Pick<typeof prisma, "$executeRaw">, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`creators:${key}`}))`;
}

/**
 * The places of a campaign taken under the plan's `creatorsPerCampaign`: invited (SELECTED), joined, and offers still
 * waiting for an answer (OFFERED, less than 14 days old). Call it under `lock(tx, campaignId)` before taking a place.
 */
export async function placesTaken(tx: Pick<typeof prisma, "campaignCreator">, campaignId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - OFFER_DAYS * 24 * 60 * 60 * 1000);
  return tx.campaignCreator.count({ where: { campaignId, OR: [{ status: { in: ["SELECTED", "JOINED"] } }, { status: "OFFERED", offeredAt: { gt: since } }] } });
}

/** The words of the refusal when every place is taken. */
export const placesFullMessage = (limit: number) => `Your plan allows ${limit} creators in one campaign, and all places are taken. Remove someone first, or ask for a bigger plan.`;

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
    select: { id: true, name: true, slug: true, status: true, setupStep: true, startsOn: true, endsOn: true, platforms: true, acceptingApplications: true, listed: true, hiddenAt: true, _count: { select: { tasks: true } } },
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
    /** A draft left in the wizard at this step ("Continue"); null once set up. */
    setupStep: r.setupStep,
    startsOn: ymdOf(r.startsOn),
    endsOn: ymdOf(r.endsOn),
    platforms: r.platforms,
    acceptingApplications: r.acceptingApplications,
    listed: r.listed,
    hidden: r.hiddenAt !== null,
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
  const wizard = madeWithWizard(c);
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    brief: c.brief,
    rules: c.rules,
    status: c.status,
    acceptingApplications: c.acceptingApplications,
    /** "Show on the marketplace": the company's switch. */
    listed: c.listed,
    /** Hidden from the marketplace by a BuPulse admin (whatever `listed` says), with the reason the company sees. */
    hiddenAt: c.hiddenAt?.toISOString() ?? null,
    hiddenReason: c.hiddenReason,
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
    /** A draft left in the wizard at this step ("Continue"); null once set up. */
    setupStep: c.setupStep,
    /** Made with the wizard: going live needs everything goLiveProblems asks for. */
    wizard,
    /** What a draft still needs before it can go live (empty: ready). */
    problems: c.status !== "DRAFT" ? [] : wizard ? await campaignReadiness(c) : tasks === 0 ? ["Add at least one task first, so creators know what to post."] : [],
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

/**
 * Everyone who applied to the campaign or was invited from the marketplace, newest first, with what they sent. A
 * creator the company invited (source OFFER) who has not joined keeps their email and WhatsApp hidden: contact details
 * show once a creator applied or joined (docs/CREATOR_MARKETPLACE.md).
 */
export async function listCampaignCreators(actor: CampaignActor, campaignId: string) {
  assertManager(actor);
  await campaignOf(actor, campaignId);
  const rows = await prisma.campaignCreator.findMany({ where: { campaignId }, orderBy: [{ createdAt: "desc" }] });
  return rows.map((r) => {
    const hideContact = r.source === "OFFER" && !r.joinedAt;
    return {
      id: r.id,
      status: r.status,
      source: r.source as "LINK" | "MARKETPLACE" | "OFFER",
      /** The creator has a BuPulse creator account (applied from it, or was invited from the marketplace). */
      profileId: r.profileId,
      name: r.name,
      email: hideContact ? null : r.email,
      phone: hideContact ? null : r.phone,
      handles: readHandles(r.handles),
      samples: r.samples,
      // Text, lists, numbers or ranges, by the form's field types (lib/creators/form-fields.ts).
      answers: (r.answers && typeof r.answers === "object" ? r.answers : {}) as Record<string, Answer>,
      inviteExpiresAt: r.inviteExpiresAt?.toISOString() ?? null,
      offeredAt: r.offeredAt?.toISOString() ?? null,
      appliedAt: r.createdAt.toISOString(),
      joinedAt: r.joinedAt?.toISOString() ?? null,
      removedAt: r.removedAt?.toISOString() ?? null,
    };
  });
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
      listed: v.listed ?? true,
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
        ...(v.listed === undefined ? {} : { listed: v.listed }),
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
 * DRAFT → LIVE (needs a last day still ahead, a free place under the plan's `liveCampaigns`, and a task; a campaign
 * made with the wizard needs everything readinessProblems asks for instead: the brief, tasks, do's and don'ts, photos,
 * an example and the full campaign check), LIVE ⇄ PAUSED,
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
    if (c.status === "DRAFT" && madeWithWizard(c)) {
      const problems = await campaignReadiness(c);
      if (problems.length) throw new CreatorCampaignError("invalid", problems.join(" "));
    } else if (c.status === "DRAFT" && (await prisma.creatorTask.count({ where: { campaignId: id } })) === 0) throw new CreatorCampaignError("invalid", "Add at least one task first, so creators know what to post.");
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
    const done = await tx.creatorCampaign.updateMany({ where: { id, status: c.status }, data: { status: next, ...(next === "ENDED" ? { acceptingApplications: false } : {}), ...(next === "LIVE" && c.status === "DRAFT" ? { setupStep: null } : {}) } });
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

/**
 * "Show on the marketplace" on or off. Off, the campaign leaves /creators but its /c/<slug> page keeps working for
 * anyone with the link. A campaign a BuPulse admin hid stays hidden either way.
 */
export async function setListed(actor: CampaignActor, id: string, on: boolean) {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  if (c.status === "ENDED" && on) throw new CreatorCampaignError("conflict", "This campaign has ended.");
  await prisma.creatorCampaign.update({ where: { id }, data: { listed: on } });
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

export async function creatorOf(actor: CampaignActor, campaignCreatorId: string) {
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

/** "You're in": a creator with an account was picked and joined at once; their campaign is in their portal. */
async function sendJoinedEmail(to: string, name: string, campaign: string, companyName: string, link: string): Promise<boolean> {
  const { html, text } = renderEmail({
    heading: `You're in: ${campaign}`,
    intro: `Hi ${name.trim().split(/\s+/)[0] || "there"}, ${companyName} picked you for their creator campaign "${campaign}" on BuPulse. It is in your creator account now: connect your accounts if you have not yet, and see your tasks.`,
    button: { label: "Open my campaigns", url: link },
    footer: "You get this email because you applied to this campaign with your BuPulse creator account.",
  });
  return sendEmail({ to, subject: `${companyName} picked you for "${campaign}"`, html, text }).catch(() => false);
}

async function deliver(actor: CampaignActor, row: { name: string; email: string; phone: string | null; campaign: { name: string } }, token: string, expiresAt: Date) {
  const link = `${await linkSiteUrl()}/creator/join/${token}`;
  const b = await company(actor.businessId);
  const sent = await sendInviteEmail(row.email, row.name, row.campaign.name, b.name, link);
  return { link, sent, expiresAt: expiresAt.toISOString(), name: row.name, phone: row.phone, companyName: b.name, campaignName: row.campaign.name };
}

/**
 * Picks an applicant. One who applied with their creator account (`profileId` set) joins at once: JOINED, no invite
 * link, and an email tells them (the campaign is in their portal). Anyone else becomes SELECTED, with a single-use
 * invite link (only its sha-256 is stored, 14 days) emailed to them and returned for WhatsApp. Refused past the plan's
 * `creatorsPerCampaign` (invited, joined and open offers count), and for creators the company invited itself (they
 * answer the offer instead).
 */
export async function selectApplicant(actor: CampaignActor, campaignCreatorId: string, now = new Date()) {
  assertManager(actor);
  const row = await creatorOf(actor, campaignCreatorId);
  if (row.campaign.status === "ENDED") throw new CreatorCampaignError("conflict", "This campaign has ended.");
  if (row.source === "OFFER") throw new CreatorCampaignError("conflict", row.status === "OFFERED" ? "You invited this creator: wait for their answer." : "This creator did not apply. Invite them again from Find creators.");
  if (row.status !== "APPLIED" && row.status !== "DECLINED") throw new CreatorCampaignError("conflict", row.status === "SELECTED" ? "Already invited. Send a new link instead." : "This creator is not waiting for an answer.");
  const profile = row.profileId ? await prisma.creatorProfile.findUnique({ where: { id: row.profileId }, select: { blockedAt: true } }) : null;
  if (profile?.blockedAt) throw new CreatorCampaignError("conflict", "BuPulse blocked this creator from the marketplace, so they cannot be picked.");
  const { creatorsPerCampaign } = await campaignLimits(actor.businessId);
  const invite = await prisma.$transaction(async (tx) => {
    await lock(tx, row.campaign.id);
    if ((await placesTaken(tx, row.campaign.id, now)) >= creatorsPerCampaign) throw new CreatorCampaignError("limit", placesFullMessage(creatorsPerCampaign));
    const data = profile ? { status: "JOINED", selectedAt: now, joinedAt: now, inviteTokenHash: null, inviteExpiresAt: null } : { status: "SELECTED", selectedAt: now };
    const done = await tx.campaignCreator.updateMany({ where: { id: row.id, status: row.status }, data });
    if (done.count === 0) throw new CreatorCampaignError("conflict", "Someone changed this application just now. Open the page again.");
    return profile ? null : issueInvite(row.id, tx);
  });
  if (invite) return { joined: false as const, ...(await deliver(actor, row, invite.token, invite.expiresAt)) };
  const b = await company(actor.businessId);
  const sent = await sendJoinedEmail(row.email, row.name, row.campaign.name, b.name, `${await linkSiteUrl()}/creator`);
  return { joined: true as const, sent, name: row.name };
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

// ---- the wizard (docs/CREATOR_CAMPAIGN_WIZARD.md) --------------------------------------------------------------------

type CampaignRecord = Awaited<ReturnType<typeof campaignOf>>;

/** Made with the wizard (a draft in it, or a campaign that saved its application form): it goes live on readinessProblems. */
export const madeWithWizard = (c: { setupStep?: number | null; applicationForm?: unknown }) => c.setupStep != null || c.applicationForm != null;

/** The campaign as the full campaign check (campaignSchema) reads it. */
function campaignInputOf(c: CampaignRecord): CampaignInput {
  return { name: c.name, brief: c.brief, rules: c.rules, platforms: c.platforms as Platform[], startsOn: ymdOf(c.startsOn), endsOn: ymdOf(c.endsOn), mentions: c.mentions, currency: c.currency, payRules: readPayRules(c.payRules), viewTargetPerCreator: c.viewTargetPerCreator, viewTargetCampaign: c.viewTargetCampaign, budget: null, questions: readQuestions(c.questions) };
}

/** Files in each of the campaign's Photos folders (0 for a folder not made yet). */
async function folderCounts(businessId: string, files: CampaignFiles) {
  const n = (folderId: string | null | undefined) => (folderId ? prisma.mediaAsset.count({ where: { businessId, folderId } }) : Promise.resolve(0));
  const [images, videos, documents] = await Promise.all([n(files.imagesFolderId), n(files.videosFolderId), n(files.documentsFolderId)]);
  return { images, videos, documents };
}

/** What the campaign still needs before it can go live (empty: ready). */
export async function campaignReadiness(c: CampaignRecord): Promise<string[]> {
  const files = readFiles(c.files);
  const [tasks, counts] = await Promise.all([prisma.creatorTask.count({ where: { campaignId: c.id } }), folderCounts(c.businessId, files)]);
  const facts: ReadinessFacts = { brief: c.brief, dos: c.dos, donts: c.donts, tasks, images: counts.images, videos: counts.videos, exampleLinks: files.exampleLinks.length };
  return readinessProblems(campaignInputOf(c), facts);
}

const oneOf = <T extends string>(list: readonly T[], v: string | null | undefined): T | null => (v && (list as readonly string[]).includes(v) ? (v as T) : null);

/** Every answer of the wizard, from the campaign as stored. */
function answersOf(c: CampaignRecord, tasks: TaskRow[], budget: number | null): WizardAnswers {
  const formats = c.formats.filter((f): f is (typeof FORMAT_VALUES)[number] => (FORMAT_VALUES as readonly string[]).includes(f));
  return {
    idea: c.idea ?? "",
    name: c.name,
    kind: oneOf(KIND_VALUES, c.kind),
    knowledgeCampaignId: c.knowledgeCampaignId,
    productIds: c.productIds,
    goal: oneOf(GOAL_VALUES, c.goal),
    requirements: readRequirements(c.requirements),
    platforms: c.platforms.filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p)),
    platformMode: c.platformMode === "ALL" ? "ALL" : "ANY",
    formats,
    mentions: c.mentions,
    startsOn: ymdOf(c.startsOn),
    endsOn: ymdOf(c.endsOn),
    briefEvery: oneOf(BRIEF_EVERY_VALUES, c.briefEvery),
    postsPerDay: tasks[0]?.postsPerDay ?? 1,
    mediaKind: tasks[0]?.mediaKind ?? mediaFromFormats(formats),
    brief: c.brief,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, instructions: t.instructions, startsOn: t.startsOn, endsOn: t.endsOn, postsPerDay: t.postsPerDay, platforms: t.platforms as Platform[], platformMode: t.platformMode, mediaKind: t.mediaKind, submissions: t.submissions })),
    dos: c.dos,
    donts: c.donts,
    rules: c.rules,
    currency: c.currency,
    payRules: readPayRules(c.payRules),
    viewTargetPerCreator: c.viewTargetPerCreator,
    viewTargetCampaign: c.viewTargetCampaign,
    budget,
    applicationForm: readApplicationForm(c.applicationForm, readQuestions(c.questions)),
    files: readFiles(c.files),
    look: readLook(c.look),
    listed: c.listed,
    acceptingApplications: c.acceptingApplications,
  };
}

/** A campaign with every answer of the wizard, for /dashboard/creators/[id]/setup and Settings. */
export async function getWizardCampaign(actor: CampaignActor, id: string) {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  const [b, tasks, budget, problems] = await Promise.all([company(actor.businessId), listTasks(actor, id), defaultBudget(id), c.status === "DRAFT" ? campaignReadiness(c) : Promise.resolve([] as string[])]);
  const answers = answersOf(c, tasks, budget);
  return {
    id: c.id,
    slug: c.slug,
    status: c.status,
    setupStep: c.setupStep,
    timezone: b.timezone,
    companyName: b.name,
    answers,
    counts: await folderCounts(actor.businessId, answers.files),
    problems,
  };
}
export type WizardCampaign = Awaited<ReturnType<typeof getWizardCampaign>>;

async function ownKnowledgeCampaign(businessId: string, id: string | null) {
  return id ? prisma.campaign.findFirst({ where: { id, businessId }, select: { id: true, startsAt: true, endsAt: true } }) : null;
}

/** The ids that are the company's products, in the order given. */
async function ownProductIds(businessId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const own = new Set((await prisma.product.findMany({ where: { businessId, id: { in: ids } }, select: { id: true } })).map((p) => p.id));
  return [...new Set(ids)].filter((id) => own.has(id));
}

const taskData = (t: TaskInput) => ({ title: t.title, instructions: t.instructions, startsOn: day(t.startsOn), endsOn: day(t.endsOn), postsPerDay: t.postsPerDay, platforms: t.platforms, platformMode: t.platformMode, mediaKind: t.mediaKind });
const taskRow = (campaignId: string, t: TaskInput) => ({ campaignId, ...taskData(t) });

/** The answers a suggestion can fill (columns shared by create and update). */
type Prefill = { goal?: string; requirements?: Prisma.InputJsonValue; platforms?: string[]; formats?: string[]; mentions?: string[]; briefEvery?: string; brief?: string; dos?: string[]; donts?: string[]; payRules?: Prisma.InputJsonValue; applicationForm?: Prisma.InputJsonValue };
type PrefillRow = Pick<CampaignRecord, "goal" | "requirements" | "platforms" | "formats" | "mentions" | "briefEvery" | "brief" | "dos" | "donts" | "payRules" | "applicationForm" | "platformMode" | "startsOn" | "endsOn" | "currency">;

/** The steps after `reached` the owner has not seen yet whose answers are still empty: the ones a suggestion fills. */
export function emptyOpenSteps(c: PrefillRow, tasks: number, reached: number | null): WizardStepId[] {
  const open = (step: WizardStepId) => stepNumber(step) > (reached ?? stepNumber("review"));
  const empty: [WizardStepId, boolean][] = [
    ["goal", !c.goal],
    ["creators", c.requirements == null],
    ["where", c.platforms.length === 0],
    ["when", !c.briefEvery],
    ["content", !c.brief.trim() || tasks === 0],
    ["rules", c.dos.length === 0 && c.donts.length === 0],
    ["pay", !paysAnything(readPayRules(c.payRules))],
    ["form", c.applicationForm == null],
  ];
  return empty.filter(([step, isEmpty]) => isEmpty && open(step)).map(([step]) => step);
}

/** Fills `steps` from the suggestion: the answers to write, and the tasks to make when there are none. */
function prefill(c: PrefillRow, tasks: number, s: CampaignSuggestion, steps: WizardStepId[], o: { creatorsPerCampaign: number; tiktokReady: boolean }): { data: Prefill; tasks: TaskInput[] } {
  const data: Prefill = {};
  const fill = new Set(steps);
  if (fill.has("goal")) data.goal = s.goal;
  if (fill.has("creators")) data.requirements = json(suggestedRequirements(s, null, o.creatorsPerCampaign));
  let platforms = c.platforms.filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
  if (fill.has("where")) {
    platforms = s.platforms.filter((p) => p !== "tiktok" || o.tiktokReady);
    if (!platforms.length) platforms = ["instagram"];
    data.platforms = platforms;
    if (!c.formats.length) data.formats = s.formats;
    if (!c.mentions.length) data.mentions = s.mentions;
  }
  if (fill.has("when")) data.briefEvery = s.briefEvery;
  let made: TaskInput[] = [];
  if (fill.has("content")) {
    if (!c.brief.trim()) data.brief = s.brief;
    if (tasks === 0 && platforms.length) {
      const briefEvery = oneOf(BRIEF_EVERY_VALUES, c.briefEvery) ?? s.briefEvery;
      made = planTasks({ startsOn: ymdOf(c.startsOn), endsOn: ymdOf(c.endsOn), briefEvery, postsPerDay: s.postsPerDay, mediaKind: s.mediaKind, platforms, platformMode: c.platformMode === "ALL" ? "ALL" : "ANY", texts: s.tasks });
    }
  }
  if (fill.has("rules")) {
    data.dos = s.dos;
    data.donts = s.donts;
  }
  if (fill.has("pay")) data.payRules = json(suggestedPay(s, c.currency));
  if (fill.has("form")) data.applicationForm = json(withFields(defaultForm(), s.fields));
  return { data, tasks: made };
}

/** The first and last day of a new draft: a Business info campaign's still ahead (a short one starts earlier), else from next Monday. */
export function draftDates(today: string, days: number, linked: { startsAt: Date | null; endsAt: Date | null } | null): { startsOn: string; endsOn: string } {
  const tomorrow = addDaysYmd(today, 1);
  if (linked?.startsAt && linked.endsAt) {
    const start = ymdOf(linked.startsAt);
    const end = ymdOf(linked.endsAt);
    if (end >= tomorrow && end >= start) {
      const early = addDaysYmd(end, -13);
      const startsOn = [start < early ? start : early, tomorrow].sort().at(-1)!;
      if (daysInclusive(startsOn, end) <= MAX_CAMPAIGN_DAYS) return { startsOn, endsOn: end };
    }
  }
  const startsOn = nextMonday(today);
  return { startsOn, endsOn: addDaysYmd(startsOn, Math.max(1, Math.min(MAX_CAMPAIGN_DAYS, days)) - 1) };
}

function parseStep<S extends WizardStepId>(step: S, input: unknown) {
  const r = checkStep(step, input);
  if (!r.ok) throw new CreatorCampaignError("invalid", r.error);
  return r.data;
}

/**
 * Step 1's "Next": makes the DRAFT campaign from the owner's line and fills every later step from the suggestion
 * (the AI's, or the template of its kind): goal, creators, networks, dates, brief and tasks, do's and don'ts, pay and
 * the application form. The name is the owner's, else the suggestion's. Its 30-day periods and its tasks come with it.
 */
export async function createDraft(actor: CampaignActor, input: StepInput<"idea">, suggestion: CampaignSuggestion, opts: { tiktokReady?: boolean; now?: Date } = {}) {
  assertManager(actor);
  const v = parseStep("idea", input);
  const now = opts.now ?? new Date();
  const b = await company(actor.businessId);
  const [linked, productIds, currency, limits] = await Promise.all([ownKnowledgeCampaign(actor.businessId, v.knowledgeCampaignId), ownProductIds(actor.businessId, v.productIds), defaultCurrency(actor.businessId), campaignLimits(actor.businessId)]);
  const name = (v.name || suggestion.name || nameFromIdea(v.idea) || "My creator campaign").slice(0, 80);
  const { startsOn, endsOn } = draftDates(dayIn(now, b.timezone), suggestion.days, linked);
  const blank: PrefillRow = { goal: null, requirements: null, platforms: [], formats: [], mentions: [], briefEvery: null, brief: "", dos: [], donts: [], payRules: {}, applicationForm: null, platformMode: "ANY", startsOn: day(startsOn), endsOn: day(endsOn), currency };
  const fill = prefill(blank, 0, suggestion, emptyOpenSteps(blank, 0, 1), { creatorsPerCampaign: limits.creatorsPerCampaign, tiktokReady: opts.tiktokReady === true });
  const slug = await uniqueSlug(name, async (s) => (await prisma.creatorCampaign.count({ where: { slug: s } })) > 0);
  return prisma.creatorCampaign.create({
    data: {
      businessId: actor.businessId,
      slug,
      name,
      idea: v.idea || null,
      kind: v.kind ?? suggestion.kind,
      knowledgeCampaignId: linked?.id ?? null,
      productIds,
      brief: "",
      platforms: [],
      mentions: [],
      currency,
      payRules: json({}),
      questions: json([]),
      startsOn: day(startsOn),
      endsOn: day(endsOn),
      createdBy: actor.actorId,
      setupStep: stepNumber("goal"),
      ...fill.data,
      periods: { create: periodsFor(startsOn, endsOn, b.timezone).map((p) => ({ index: p.index, startsAt: p.startsAt, endsAt: p.endsAt })) },
      tasks: { create: fill.tasks.map(taskData) },
    },
    select: { id: true, slug: true },
  });
}

export type SaveStepOptions = {
  /** TikTok's app is set up (lib/creators/connect-flow.ts tiktokAuthConfig): campaigns may run on it. */
  tiktokReady?: boolean;
  /** Step 1 of a draft: the suggestion for the steps not reached yet that are still empty (asked only when needed). */
  suggest?: () => Promise<CampaignSuggestion>;
  now?: Date;
};

/**
 * Saves one step of the wizard: only that step's answers, checked (STEP_SCHEMAS), and the furthest step reached. The
 * rules of the old form stay: dates and currency change only while it is a draft, a platform a live task needs cannot
 * be taken off, a task creators handed in is never deleted, the pay floor holds and the plan's creators per campaign.
 * While it is a draft, Content replaces the tasks with the ones sent and When plans them again over new days.
 */
export async function saveStep(actor: CampaignActor, id: string, step: WizardStepId, input: unknown, opts: SaveStepOptions = {}) {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  if (c.status === "ENDED") throw new CreatorCampaignError("conflict", "This campaign has ended and can no longer be changed.");
  const now = opts.now ?? new Date();
  const draft = c.status === "DRAFT";
  const setupStep = reachedAfter(c.setupStep, stepNumber(step));
  const update = (data: Prisma.CreatorCampaignUncheckedUpdateInput, tx: Pick<typeof prisma, "creatorCampaign"> = prisma) => tx.creatorCampaign.update({ where: { id }, data: { ...data, setupStep } });

  switch (step) {
    case "idea": {
      const v = parseStep("idea", input);
      const [linked, productIds] = await Promise.all([ownKnowledgeCampaign(actor.businessId, v.knowledgeCampaignId), ownProductIds(actor.businessId, v.productIds)]);
      const data: Prisma.CreatorCampaignUncheckedUpdateInput = { idea: v.idea || null, name: v.name || nameFromIdea(v.idea) || c.name, kind: v.kind, knowledgeCampaignId: linked?.id ?? null, productIds };
      let tasks: TaskInput[] = [];
      const tasksNow = await prisma.creatorTask.count({ where: { campaignId: id } });
      const steps = draft && opts.suggest ? emptyOpenSteps(c, tasksNow, setupStep) : [];
      if (steps.length && opts.suggest) {
        const limits = await campaignLimits(actor.businessId);
        const fill = prefill(c, tasksNow, await opts.suggest(), steps, { creatorsPerCampaign: limits.creatorsPerCampaign, tiktokReady: opts.tiktokReady === true });
        Object.assign(data, fill.data);
        tasks = fill.tasks;
      }
      await prisma.$transaction(async (tx) => {
        await update(data, tx);
        if (tasks.length) await tx.creatorTask.createMany({ data: tasks.map((t) => taskRow(id, t)) });
      });
      return;
    }
    case "goal": {
      const v = parseStep("goal", input);
      await update({ goal: v.goal });
      return;
    }
    case "creators": {
      const v = parseStep("creators", input);
      const { creatorsPerCampaign } = await campaignLimits(actor.businessId);
      if ((v.requirements.creatorsWanted ?? 0) > creatorsPerCampaign) throw new CreatorCampaignError("limit", `Your plan allows ${creatorsPerCampaign} creators in one campaign.`);
      await update({ requirements: json(v.requirements) });
      return;
    }
    case "where": {
      const v = parseStep("where", input);
      if (v.platforms.includes("tiktok") && !opts.tiktokReady && !c.platforms.includes("tiktok")) throw new CreatorCampaignError("invalid", "TikTok is coming soon: BuPulse cannot count its views yet.");
      const tasks = await prisma.creatorTask.findMany({ where: { campaignId: id }, select: { id: true, title: true, platforms: true, platformMode: true } });
      const keep = new Set<string>(v.platforms);
      if (!draft) {
        const orphan = tasks.find((t) => !t.platforms.some((p) => keep.has(p)));
        if (orphan) throw new CreatorCampaignError("invalid", `The task "${orphan.title}" uses only platforms you took off. Change or delete it first.`);
      }
      await prisma.$transaction(async (tx) => {
        await update({ platforms: v.platforms, platformMode: v.platformMode, formats: v.formats, mentions: v.mentions }, tx);
        for (const t of tasks) {
          let platforms = t.platforms.filter((p) => keep.has(p));
          // A draft's tasks follow the networks picked here (they were made from them).
          if (draft && platforms.length === 0) platforms = v.platforms;
          const platformMode = draft ? v.platformMode : t.platformMode;
          if (platforms.length !== t.platforms.length || platforms.some((p, i) => p !== t.platforms[i]) || platformMode !== t.platformMode) await tx.creatorTask.update({ where: { id: t.id }, data: { platforms, platformMode } });
        }
      });
      return;
    }
    case "when": {
      const v = parseStep("when", input);
      const datesChanged = v.startsOn !== ymdOf(c.startsOn) || v.endsOn !== ymdOf(c.endsOn);
      if (!draft) {
        if (datesChanged) throw new CreatorCampaignError("conflict", "The dates and the currency can be changed only while the campaign is a draft.");
        await update({ briefEvery: v.briefEvery });
        return;
      }
      const b = await company(actor.businessId);
      if (datesChanged && v.startsOn < dayIn(now, b.timezone)) throw new CreatorCampaignError("invalid", "The first day cannot be in the past.");
      const rows = (await prisma.creatorTask.findMany({ where: { campaignId: id }, orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }], select: { title: true, instructions: true, startsOn: true, endsOn: true } })).map((t) => ({ ...t, startsOn: ymdOf(t.startsOn), endsOn: ymdOf(t.endsOn) }));
      const platforms = c.platforms.filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
      const replan = rows.length > 0 && platforms.length > 0 && !tasksMatchSpans(rows, v.startsOn, v.endsOn, v.briefEvery);
      const budget = datesChanged ? await defaultBudget(id, now) : null;
      await prisma.$transaction(async (tx) => {
        await update({ startsOn: day(v.startsOn), endsOn: day(v.endsOn), briefEvery: v.briefEvery }, tx);
        if (datesChanged) {
          await tx.creatorPeriod.deleteMany({ where: { campaignId: id } });
          await tx.creatorPeriod.createMany({ data: periodsFor(v.startsOn, v.endsOn, b.timezone).map((p) => ({ campaignId: id, index: p.index, startsAt: p.startsAt, endsAt: p.endsAt, viewTargetPerCreator: c.viewTargetPerCreator, viewTargetCampaign: c.viewTargetCampaign, budget })) });
        }
        if (replan) {
          await tx.creatorTask.deleteMany({ where: { campaignId: id } });
          const planned = planTasks({ startsOn: v.startsOn, endsOn: v.endsOn, briefEvery: v.briefEvery, postsPerDay: v.postsPerDay, mediaKind: v.mediaKind, platforms, platformMode: c.platformMode === "ALL" ? "ALL" : "ANY", texts: taskTexts(rows) });
          await tx.creatorTask.createMany({ data: planned.map((t) => taskRow(id, t)) });
        } else if (rows.length) {
          await tx.creatorTask.updateMany({ where: { campaignId: id }, data: { postsPerDay: v.postsPerDay, mediaKind: v.mediaKind } });
        }
      });
      return;
    }
    case "content": {
      const v = parseStep("content", input);
      if (!draft && v.brief.length < 10) throw new CreatorCampaignError("invalid", "Write a short brief: what the posts should show.");
      for (const t of v.tasks) checkTask(c, t);
      if (draft) {
        await prisma.$transaction(async (tx) => {
          await update({ brief: v.brief }, tx);
          await tx.creatorTask.deleteMany({ where: { campaignId: id } });
          if (v.tasks.length) await tx.creatorTask.createMany({ data: v.tasks.map((t) => taskRow(id, t)) });
        });
        return;
      }
      // Live, paused: the task rules of the Tasks tab. A task creators handed in is changed, never deleted.
      const existing = await prisma.creatorTask.findMany({ where: { campaignId: id }, select: { id: true, title: true, _count: { select: { submissions: true } } } });
      const known = new Set(existing.map((t) => t.id));
      if (v.tasks.some((t) => t.id && !known.has(t.id))) throw new CreatorCampaignError("not_found", "A task was deleted meanwhile. Open the page again.");
      const sent = new Set(v.tasks.flatMap((t) => (t.id ? [t.id] : [])));
      const gone = existing.filter((t) => !sent.has(t.id));
      const handedIn = gone.find((t) => t._count.submissions > 0);
      if (handedIn) throw new CreatorCampaignError("conflict", `Creators already handed in "${handedIn.title}", so it cannot be deleted. Change its days or words instead.`);
      await prisma.$transaction(async (tx) => {
        await update({ brief: v.brief }, tx);
        if (gone.length) await tx.creatorTask.deleteMany({ where: { id: { in: gone.map((t) => t.id) }, campaignId: id } });
        for (const t of v.tasks) {
          const { id: taskId, ...fields } = t;
          if (taskId) await tx.creatorTask.update({ where: { id: taskId }, data: taskData(fields) });
        }
        const fresh = v.tasks.filter((t) => !t.id);
        if (fresh.length) await tx.creatorTask.createMany({ data: fresh.map((t) => taskRow(id, t)) });
      });
      return;
    }
    case "rules": {
      const v = parseStep("rules", input);
      await update({ dos: v.dos, donts: v.donts, rules: v.rules || null });
      return;
    }
    case "pay": {
      const v = parseStep("pay", input);
      if (!draft && v.currency !== c.currency) throw new CreatorCampaignError("conflict", "The dates and the currency can be changed only while the campaign is a draft.");
      const goals = { viewTargetPerCreator: v.viewTargetPerCreator ?? null, viewTargetCampaign: v.viewTargetCampaign ?? null, budget: v.budget ?? null };
      await prisma.$transaction(async (tx) => {
        await update({ currency: v.currency, payRules: json(v.payRules), viewTargetPerCreator: goals.viewTargetPerCreator, viewTargetCampaign: goals.viewTargetCampaign }, tx);
        await tx.creatorPeriod.updateMany({ where: { campaignId: id, status: "OPEN", ...(draft ? {} : { startsAt: { gt: now } }) }, data: goals });
      });
      return;
    }
    case "form": {
      const v = parseStep("form", input);
      await update({ applicationForm: json(v.applicationForm) });
      return;
    }
    case "files": {
      const v = parseStep("files", input);
      await update({ files: json({ ...readFiles(c.files), driveUrl: v.driveUrl || null, exampleLinks: v.exampleLinks }) });
      return;
    }
    case "look": {
      const v = parseStep("look", input);
      if (v.coverAssetId && !(await prisma.mediaAsset.findFirst({ where: { id: v.coverAssetId, businessId: actor.businessId }, select: { id: true } }))) {
        throw new CreatorCampaignError("invalid", "That cover is no longer in your Photos. Pick another one.");
      }
      await update({ look: json({ coverAssetId: v.coverAssetId ?? null }), listed: v.listed, acceptingApplications: v.acceptingApplications });
      return;
    }
    case "review":
      await update({});
      return;
  }
}

/** Review's "Save as draft": the campaign is set up (the list stops saying "Continue"); it goes live when the owner says. */
export async function finishSetup(actor: CampaignActor, id: string) {
  assertManager(actor);
  await campaignOf(actor, id);
  await prisma.creatorCampaign.update({ where: { id }, data: { setupStep: null } });
}

const FOLDERS = [
  ["imagesFolderId", "Images"],
  ["videosFolderId", "Videos"],
  ["documentsFolderId", "Documents"],
] as const;

/**
 * The campaign's three Photos folders, made once when the owner reaches Files: "<name> – Images", "– Videos" and
 * "– Documents" (" (2)" and on when a folder of that name exists). One made again if the owner deleted it in Photos.
 */
export async function ensureCampaignFolders(actor: CampaignActor, id: string): Promise<CampaignFiles> {
  assertManager(actor);
  const c = await campaignOf(actor, id);
  return prisma.$transaction(async (tx) => {
    await lock(tx, `folders:${id}`);
    const fresh = await tx.creatorCampaign.findUnique({ where: { id }, select: { files: true } });
    const files = readFiles(fresh?.files);
    const ids = FOLDERS.map(([key]) => files[key]).filter((v): v is string => Boolean(v));
    const have = new Set((await tx.mediaFolder.findMany({ where: { businessId: actor.businessId, id: { in: ids } }, select: { id: true } })).map((f) => f.id));
    const missing = FOLDERS.filter(([key]) => !files[key] || !have.has(files[key]!));
    if (!missing.length) return files;
    const taken = (await tx.mediaFolder.findMany({ where: { businessId: actor.businessId }, select: { name: true } })).map((f) => f.name);
    if (taken.length + missing.length > MEDIA_MAX_FOLDERS) throw new CreatorCampaignError("limit", `Photos holds up to ${MEDIA_MAX_FOLDERS} folders. Delete ${missing.length === 1 ? "one" : missing.length} in Photos to make room for this campaign's files.`);
    const next: CampaignFiles = { ...files };
    for (const [key, label] of missing) {
      const name = campaignFolderName(c.name, label, taken);
      taken.push(name);
      next[key] = (await tx.mediaFolder.create({ data: { businessId: actor.businessId, name }, select: { id: true } })).id;
    }
    await tx.creatorCampaign.update({ where: { id }, data: { files: json(next) } });
    return next;
  });
}
