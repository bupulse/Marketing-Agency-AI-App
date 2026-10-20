// Daily posts made for you (docs/CONTENT.md "Daily posts"): every night, for each company whose plan has `dailyPosts`
// (Business and custom plans, and trials whose chosen plan has it), the day's posts are made with "Create today's
// content" (content flow v3, "AI makes it for me": angles rotation, Knowledge base, price rules, variety, recent
// openings, art director, Gallery first), so the owner finds them under Content in the morning. The cron
// (/api/cron/daily-posts) runs hourly; this file decides who is due, claims the day (DailyPostRun, unique per company and
// local day), spreads the month's allowances (budget.ts), rotates the subject and sends the morning notice.
import "server-only";
import { getSetting } from "@/lib/admin/settings";
import { isServiceEnabled, ServiceDisabledError, textAiService } from "@/lib/admin/switch";
import { AIBudgetExceededError, CompanyBudgetExceededError, companySpendThisMonth, effectiveBudgetUsd, imageUnitUsd, spentThisMonthUsd } from "@/lib/ai/budget";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { DayRunError, ALREADY_RUNNING, networkChoices, runDayContent } from "@/lib/content-flow/service";
import { dateDay, dayBounds, dayDate } from "@/lib/content-flow/day";
import { prisma } from "@/lib/db";
import { featureStatus } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { hasShortRequestLimit, timeBudget } from "@/lib/platform/limits";
import { postsPerAppLimit, videosLeftNow } from "@/lib/plans";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { addDays, dayKey } from "@/lib/publishing/time";
import { pushToLeadWatchers } from "@/lib/push/service";
import type { Network } from "@/lib/social/types";
import { alertRecipients } from "@/lib/team/recipients";
import { kigaliDayOf, kigaliMonthOf, kigaliMonthRange } from "@/lib/time/kigali";
import { getUsageSummary } from "@/lib/usage";
import { aiPhotosAvailable, videoAvailable } from "@/lib/visuals/service";
import { VOICE_FEATURE } from "@/lib/voice/service";
import { dayBudget, daysLeft, SKIP_NOTE, type SkipReason } from "./budget";
import { appRoom, chooseSubject, dueDay, noticeDue, type Subject } from "./plan";
import { dailyApps, readDailySettings } from "./settings";

/** A RUNNING run quiet for this long died (the AI calls take a minute or two); it is closed or retaken. */
export const STALE_RUN_MS = 15 * 60 * 1000;
/** A failed day is tried this many times in all (the cron is hourly, until midday locally). */
export const MAX_ATTEMPTS = 3;

export type DailyOutcome =
  | { status: "made"; posts: number; scheduled: number; reason: SkipReason | null }
  | { status: "skipped"; reason: SkipReason }
  /** Not this company, or not now: off, not in the plan, read-only, too late in the day, already done. */
  | { status: "not_due"; why: string }
  /** Try again later without writing anything (the plan cannot be checked, the AI is switched off). */
  | { status: "wait"; why: string }
  | { status: "failed"; note: string };

/** Takes the day for the company, or null when another call has it or it is done. A died run is closed or retaken. */
export async function claimDailyRun(businessId: string, day: Date, now: Date): Promise<{ id: string; attempts: number } | null> {
  try {
    return await prisma.dailyPostRun.create({ data: { businessId, day, angles: [] }, select: { id: true, attempts: true } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
  const run = await prisma.dailyPostRun.findUnique({ where: { businessId_day: { businessId, day } } });
  if (!run) return null;
  const stale = run.status === "RUNNING" && now.getTime() - run.updatedAt.getTime() > STALE_RUN_MS;
  if (stale) {
    // Posts it saved stay, and the day counts as made: making it again would double them.
    const saved = await prisma.post.count({ where: { businessId, source: "DAILY", createdAt: { gte: run.createdAt } } });
    if (saved > 0) {
      await prisma.dailyPostRun.updateMany({ where: { id: run.id, status: "RUNNING", updatedAt: run.updatedAt }, data: { status: "DONE", posts: saved, note: "Interrupted part-way: some posts may be missing." } });
      return null;
    }
  }
  if (!(stale || run.status === "FAILED") || run.attempts >= MAX_ATTEMPTS) return null;
  // Compare-and-set, so two calls cannot both take it.
  const { count } = await prisma.dailyPostRun.updateMany({
    where: { id: run.id, status: run.status, updatedAt: run.updatedAt },
    data: { status: "RUNNING", attempts: { increment: 1 }, createdAt: now, reason: null, note: null },
  });
  return count === 1 ? { id: run.id, attempts: run.attempts + 1 } : null;
}

/** May this company get daily posts now? "wait" means ask again later and write nothing. */
async function eligibility(businessId: string): Promise<"ok" | { wait: string } | { no: string }> {
  const status = await featureStatus(businessId, "dailyPosts");
  // A read-only account (waiting for its demo or an invoice, trial over, unpaid) answers not_in_plan for everything.
  if (status === "not_in_plan") return { no: "not in the plan or the account is read-only" };
  if (status !== "ok") return { wait: status };
  for (const needed of ["content", "calendar"] as const) {
    const s = await featureStatus(businessId, needed);
    if (s === "not_in_plan") return { no: `no ${needed}` };
    if (s !== "ok") return { wait: s };
  }
  if (!(await isServiceEnabled(textAiService()))) return { wait: "AI switched off" };
  return "ok";
}

/** Today's subjects: running campaigns, active products, then General. */
async function subjectsFor(businessId: string, day: string): Promise<Subject[]> {
  const date = dayDate(day);
  const [campaigns, products] = await Promise.all([
    prisma.campaign.findMany({
      where: { businessId, status: "ACTIVE", AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: date } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: date } }] }] },
      orderBy: { createdAt: "asc" },
      take: 30,
      select: { id: true },
    }),
    prisma.product.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 60, select: { id: true } }),
  ]);
  return [...campaigns.map((c) => ({ kind: "campaign" as const, id: c.id })), ...products.map((p) => ({ kind: "product" as const, id: p.id })), { kind: "general" as const }];
}

async function finish(runId: string, data: Prisma.DailyPostRunUpdateInput) {
  await prisma.dailyPostRun.update({ where: { id: runId }, data });
}

/**
 * Makes one company's posts for its local day, if it is due: at most one run per company and day (claimed), within the
 * day's share of the allowances. Never throws for a company problem: it is recorded on the run.
 */
export async function runDailyPosts(businessId: string, now = new Date()): Promise<DailyOutcome> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, userId: true, timezone: true, dailyPostSettings: true, user: { select: { deletionScheduledFor: true, suspendedAt: true } } },
  });
  if (!business) return { status: "not_due", why: "no business" };
  if (business.user.deletionScheduledFor || business.user.suspendedAt) return { status: "not_due", why: "suspended or being deleted" };
  const settings = readDailySettings(business.dailyPostSettings);
  if (!settings.enabled) return { status: "not_due", why: "switched off" };
  const zone = business.timezone || "UTC";
  const day = dueDay(zone, now);
  if (!day) return { status: "not_due", why: "after midday" };
  const allowed = await eligibility(businessId);
  if (allowed !== "ok") return "wait" in allowed ? { status: "wait", why: allowed.wait } : { status: "not_due", why: allowed.no };

  const claim = await claimDailyRun(businessId, dayDate(day), now);
  if (!claim) return { status: "not_due", why: "already made" };
  const owner = { userId: business.userId, businessId, service: true };
  let subject: Subject | null = null;
  try {
    const [usage, choices, aiPhotos, videoInPlan, voice, spend, capUsd, spentUsd] = await Promise.all([
      getUsageSummary(owner.userId),
      networkChoices(businessId),
      settings.design === "ai" ? aiPhotosAvailable(owner) : Promise.resolve(false),
      videoAvailable(businessId),
      featureStatus(businessId, VOICE_FEATURE).catch(() => null),
      companySpendThisMonth(businessId, now),
      effectiveBudgetUsd(),
      spentThisMonthUsd(now),
    ]);
    const apps = dailyApps(settings, choices.filter((c) => c.connected).map((c) => c.network));
    // Every post the company has on each app today counts (by hand, Autopilot, "Create today's content"), so a day
    // Autopilot already filled gets nothing more on that app.
    const bounds = dayBounds(day, zone);
    const today = await prisma.post.groupBy({
      by: ["network"],
      where: { businessId, network: { in: apps }, status: { not: "CANCELLED" }, OR: [{ scheduledAt: bounds }, { publishedAt: bounds }, { scheduledAt: null, publishedAt: null, createdAt: bounds }] },
      _count: { _all: true },
    });
    const room = appRoom(apps, settings.perApp, postsPerAppLimit(usage.limits), Object.fromEntries(today.map((r) => [r.network, r._count._all])) as Partial<Record<Network, number>>);
    const left = (metric: "text" | "image" | "videos") => Math.max(0, (usage.limits[metric] ?? 0) - (usage.used[metric] ?? 0));
    const month = kigaliMonthRange(kigaliMonthOf(now));
    const budget = dayBudget({
      room,
      textLeft: left("text"),
      imagesLeft: aiPhotos ? left("image") : 0,
      videosLeftMonth: videoInPlan ? left("videos") : 0,
      videosLeftNow: videoInPlan ? videosLeftNow(usage) : 0,
      periodDays: daysLeft(now, usage.resetsAt),
      wantsAi: aiPhotos,
      voice: videoInPlan && voice === "ok",
      companyUsdLeft: spend.allowanceUsd - Math.min(spend.widgetUsd, spend.widgetCapUsd) - spend.ownerUsd,
      monthDays: daysLeft(now, month.end),
      platformCapUsd: capUsd,
      platformSpentUsd: spentUsd,
      imageUsd: imageUnitUsd(),
    });
    if (!budget.ok) {
      await finish(claim.id, { status: "SKIPPED", reason: budget.reason, note: SKIP_NOTE[budget.reason] });
      return { status: "skipped", reason: budget.reason };
    }

    // The subject rotates over the company's running campaigns, products and General, and yesterday's ideas are not
    // used again today.
    const history = await prisma.dailyPostRun.findMany({ where: { businessId, id: { not: claim.id }, subjectKind: { not: null } }, orderBy: { day: "desc" }, take: 60, select: { day: true, subjectKind: true, subjectId: true, angles: true } });
    subject = chooseSubject(await subjectsFor(businessId, day), history.map((h) => ({ kind: h.subjectKind, id: h.subjectId })));
    if (!subject) {
      await finish(claim.id, { status: "SKIPPED", reason: "nothing", note: SKIP_NOTE.nothing });
      return { status: "skipped", reason: "nothing" };
    }
    const yesterday = history.find((h) => dateDay(h.day) === addDays(day, -1));
    const networks = apps.filter((n) => (room[n] ?? 0) > 0);
    const result = await runDayContent(
      owner,
      {
        scope: subject,
        mode: "ai",
        design: budget.maxAiImages > 0 ? "ai" : "free",
        networks,
        perApp: Math.max(...networks.map((n) => room[n] ?? 0)),
        price: "auto",
        daily: { maxPosts: budget.maxPosts, room, maxAiImages: budget.maxAiImages, maxVideos: budget.maxVideos, avoidAngles: yesterday?.angles ?? [] },
        requestKey: `daily-${claim.id}-${claim.attempts}`,
      },
      now,
    );
    const note = [budget.smaller ? `Made smaller today: ${SKIP_NOTE[budget.smaller]}` : "", ...result.notes, ...result.skipped.map((s) => s.reason)].filter(Boolean).join(" ").slice(0, 1000) || null;
    await finish(claim.id, { status: "DONE", posts: result.posts, subjectKind: subject.kind, subjectId: "id" in subject ? subject.id : null, angles: result.angles, reason: budget.smaller, note });
    if (result.posts > 0 && noticeDue(day, zone, now)) await sendReadyNotice(claim.id, now).catch((e) => logError(e, { source: "daily-posts.notice", businessId, level: "warn" }));
    return { status: "made", posts: result.posts, scheduled: result.scheduled, reason: budget.smaller };
  } catch (error) {
    const subjectColumns = subject ? { subjectKind: subject.kind, subjectId: "id" in subject ? subject.id : null } : {};
    if (error instanceof AIBudgetExceededError) {
      const reason: SkipReason = error instanceof CompanyBudgetExceededError ? "ai_allowance" : "budget";
      await finish(claim.id, { status: "SKIPPED", reason, note: SKIP_NOTE[reason], ...subjectColumns }).catch(() => {});
      return { status: "skipped", reason };
    }
    // "Create today's content" is running for the company right now, or the AI is off for a moment: try again later.
    const transient = (error instanceof DayRunError && error.message === ALREADY_RUNNING) || error instanceof ServiceDisabledError;
    const note = error instanceof DayRunError ? error.message : "Daily posts ran into a problem; they are tried again later.";
    if (!transient && !(error instanceof DayRunError)) await logError(error, { source: "daily-posts.run", businessId });
    // The subject is recorded, so a retry takes the next one rather than failing on the same again.
    await finish(claim.id, { status: "FAILED", note, reason: "error", ...(transient ? {} : subjectColumns) }).catch(() => {});
    return { status: "failed", note };
  }
}

/** "Your posts for today are ready: approve them", once per run, when posts still wait. Returns whether it went out. */
export async function sendReadyNotice(runId: string, now = new Date()): Promise<boolean> {
  const run = await prisma.dailyPostRun.findUnique({ where: { id: runId }, include: { business: { select: { id: true, name: true, timezone: true, user: { select: { email: true } } } } } });
  if (!run || run.notifiedAt || run.status !== "DONE") return false;
  const zone = run.business.timezone || "UTC";
  const day = dateDay(run.day);
  // A day gone by is not announced any more.
  if (dayKey(now, zone) !== day) {
    await prisma.dailyPostRun.updateMany({ where: { id: run.id, notifiedAt: null }, data: { notifiedAt: now } });
    return false;
  }
  if (!noticeDue(day, zone, now)) return false;
  const waiting = await prisma.post.count({ where: { businessId: run.businessId, source: "DAILY", status: "PENDING_APPROVAL", createdAt: dayBounds(day, zone) } });
  // Claimed by compare-and-set, so two calls never send twice; nothing waiting (all approved, or scheduled on their own), no email.
  const { count } = await prisma.dailyPostRun.updateMany({ where: { id: run.id, notifiedAt: null }, data: { notifiedAt: now } });
  if (count === 0 || waiting === 0) return false;
  const title = "Your posts for today are ready: approve them";
  const posts = waiting === 1 ? "1 post" : `${waiting} posts`;
  const body = `BuPulse made ${posts} for ${run.business.name} for today. Have a look, change anything you like, and approve them. Nothing is posted until you approve.`;
  const url = `${publicSiteUrl()}/dashboard/content`;
  const { html, text } = renderEmail({
    heading: title,
    intro: body,
    button: { label: "Review and approve", url },
    footer: `Daily posts are made for you every night. Change them or switch them off in Content, Settings: ${publicSiteUrl()}/dashboard/content/settings`,
  });
  let any = false;
  for (const to of await alertRecipients(run.businessId, run.business.user.email)) {
    if (await sendEmail({ to, subject: title, html, text }).catch(() => false)) any = true;
  }
  await pushToLeadWatchers(run.businessId, { title, body: body.slice(0, 180), url: "/dashboard/content", tag: `daily-${day}` }).catch(() => 0);
  return any;
}

/** Notices still due: runs of the last two days that made posts and were not announced yet. */
async function sendDueNotices(now: Date): Promise<number> {
  const since = dayDate(addDays(kigaliDayOf(now), -2));
  const runs = await prisma.dailyPostRun.findMany({ where: { status: "DONE", posts: { gt: 0 }, notifiedAt: null, day: { gte: since } }, orderBy: { day: "asc" }, take: 100, select: { id: true } });
  let sent = 0;
  for (const r of runs) {
    try {
      if (await sendReadyNotice(r.id, now)) sent += 1;
    } catch (error) {
      await logError(error, { source: "daily-posts.notice", level: "warn" });
    }
  }
  return sent;
}

export type DueResult = { paused: boolean; checked: number; made: number; skipped: number; failed: number; notices: number; nextCursor: string | null };

const PAGE = 100;
/** One call starts no new company after this long (each takes about a minute of AI calls). */
const CALL_BUDGET_MS = 40_000;

/**
 * The cron's body: companies in id order after `cursor`, a few made per call (2, or 1 on Netlify's 60 s limit), and
 * a cursor back while some remain. Paused for everyone in Admin -> Settings: nothing is made (notices still go).
 */
export async function runDueDailyPosts(options: { now?: Date; cursor?: string | null; limit?: number; budgetMs?: number } = {}): Promise<DueResult> {
  const now = options.now ?? new Date();
  const started = Date.now();
  const budget = options.budgetMs ?? timeBudget(CALL_BUDGET_MS, 10_000);
  const limit = options.limit ?? (hasShortRequestLimit() ? 1 : 2);
  const result: DueResult = { paused: false, checked: 0, made: 0, skipped: 0, failed: 0, notices: 0, nextCursor: null };
  if (!options.cursor) result.notices = await sendDueNotices(now).catch(() => 0);
  if (!(await getSetting("dailyPosts"))) return { ...result, paused: true };
  let cursor = options.cursor ?? null;
  let runs = 0;
  for (;;) {
    const page = await prisma.business.findMany({
      where: {
        user: { deletionScheduledFor: null, suspendedAt: null, subscription: { status: { in: ["TRIALING", "ACTIVE"] } } },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: PAGE,
      select: { id: true, timezone: true, dailyPostSettings: true, dailyPostRuns: { orderBy: { day: "desc" }, take: 1, select: { day: true, status: true, attempts: true, updatedAt: true } } },
    });
    for (const b of page) {
      // Out of time or enough made: hand back the cursor before this one.
      if (runs >= limit || Date.now() - started > budget) return { ...result, nextCursor: cursor };
      cursor = b.id;
      if (!readDailySettings(b.dailyPostSettings).enabled) continue;
      const day = dueDay(b.timezone || "UTC", now);
      if (!day) continue;
      const last = b.dailyPostRuns[0];
      if (last && dateDay(last.day) === day) {
        const stale = last.status === "RUNNING" && now.getTime() - last.updatedAt.getTime() > STALE_RUN_MS;
        if (!(stale || last.status === "FAILED") || last.attempts >= MAX_ATTEMPTS) continue;
      }
      result.checked += 1;
      const outcome = await runDailyPosts(b.id, now).catch(async (error) => {
        await logError(error, { source: "daily-posts.due", businessId: b.id });
        return { status: "failed", note: "" } as DailyOutcome;
      });
      if (outcome.status === "made") result.made += 1;
      else if (outcome.status === "skipped") result.skipped += 1;
      else if (outcome.status === "failed") result.failed += 1;
      if (outcome.status === "made" || outcome.status === "failed") runs += 1;
    }
    if (page.length < PAGE) return result;
  }
}

export type DailyToday = { day: string; paused: boolean; companies: number; posts: number; skipped: Partial<Record<SkipReason, number>>; failed: number; running: number };

/** Admin: today's daily posts (Kigali day): companies that got them, how many posts, the days skipped and why. */
export async function dailyPostsToday(now = new Date()): Promise<DailyToday> {
  const day = kigaliDayOf(now);
  const [rows, on] = await Promise.all([
    prisma.dailyPostRun.groupBy({ by: ["status", "reason"], where: { day: dayDate(day) }, _count: { _all: true }, _sum: { posts: true } }),
    getSetting("dailyPosts"),
  ]);
  const out: DailyToday = { day, paused: !on, companies: 0, posts: 0, skipped: {}, failed: 0, running: 0 };
  for (const r of rows) {
    if (r.status === "DONE") {
      out.companies += r._count._all;
      out.posts += r._sum.posts ?? 0;
    } else if (r.status === "SKIPPED") {
      const reason = (r.reason ?? "nothing") as SkipReason;
      out.skipped[reason] = (out.skipped[reason] ?? 0) + r._count._all;
    } else if (r.status === "FAILED") out.failed += r._count._all;
    else out.running += r._count._all;
  }
  return out;
}

/** The bell: today's daily posts that still wait for the owner (business-local day). */
export async function dailyPostsWaiting(businessId: string, zone: string, now = new Date()): Promise<number> {
  return prisma.post.count({ where: { businessId, source: "DAILY", status: "PENDING_APPROVAL", createdAt: dayBounds(dayKey(now, zone), zone) } });
}
