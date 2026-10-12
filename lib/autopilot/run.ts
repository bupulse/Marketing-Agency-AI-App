// Runs Autopilot for a business: plans the week, writes each post group (1 text credit each),
// draws its images, and saves the posts. Safe to call twice: one run per business and week.
import "server-only";
import { prisma } from "@/lib/db";
import { industryContext } from "@/lib/industry-context";
import { profileContext } from "@/lib/knowledge/context";
import { getTextProvider } from "@/lib/ai";
import { withLedger } from "@/lib/ai/ledger";
import { AIBudgetExceededError } from "@/lib/ai/budget";
import { isServiceEnabled, ServiceDisabledError, textAiService } from "@/lib/admin/switch";
import { FeatureRequiredError, featureStatus, hasFeature } from "@/lib/entitlements";
import { AIProviderError } from "@/lib/ai/types";
import { readKnowledge } from "@/lib/brand/schemas";
import { knowledgeFacts } from "@/lib/business-info/facts";
import { logError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { makeGroupImages, aspectFor } from "./images";
import { noopTrendSource, type TrendSource } from "./learning";
import { alertRecipients } from "@/lib/team/recipients";
import { sendReadyEmail } from "./notify";
import type { PlannedGroup } from "./planner";
import { planWeek } from "./plan";
import { configuredModel } from "@/lib/studio/service";
import { consumeUsage, refundUsage, UsageLimitError } from "@/lib/usage";
import { getProvider } from "@/lib/social/registry";
import { localDateISO, nextWeekStart, safeZone, weekdayOfISO, weekKey, weekStartFromKey } from "./timezone";
import { writeGroup, type WriteRequest, type WriterBrand } from "./writer";

export type RunStatus = "planned" | "already_planned" | "nothing_to_plan" | "no_credits" | "failed";

export interface RunResult {
  status: RunStatus;
  runId?: string;
  postCount: number;
  groupCount: number;
  /** A friendly note for the owner (credits ran out, a post was skipped, ...). */
  note?: string;
}

const STALE_RUN_MS = 15 * 60 * 1000;
const CONCURRENCY = 3;

/**
 * Takes the run for (business, week), or null when another one already did or finished it.
 * A RUNNING run that went quiet but saved posts is closed as DONE: planning it again would repeat the week.
 */
async function claimRun(businessId: string, key: Date, now: Date): Promise<{ id: string } | null> {
  try {
    return await prisma.autopilotRun.create({ data: { businessId, weekStart: key }, select: { id: true } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
  const run = await prisma.autopilotRun.findUnique({ where: { businessId_weekStart: { businessId, weekStart: key } } });
  if (!run) return null;
  const stale = run.status === "RUNNING" && now.getTime() - run.createdAt.getTime() > STALE_RUN_MS;
  if (stale) {
    const saved = await prisma.post.count({ where: { autopilotRunId: run.id } });
    if (saved > 0) {
      await prisma.autopilotRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: { status: "DONE", postCount: saved, error: "Autopilot was interrupted part-way, so some posts may be missing. The ones below are ready." },
      });
      return null;
    }
  }
  const retryable = run.status === "FAILED" || (run.status === "DONE" && run.postCount === 0) || stale;
  if (!retryable) return null;
  // Compare-and-swap, so two callers cannot both take it.
  const { count } = await prisma.autopilotRun.updateMany({
    where: { id: run.id, status: run.status, createdAt: run.createdAt },
    data: { status: "RUNNING", error: null, createdAt: now },
  });
  return count === 1 ? { id: run.id } : null;
}

function factsFor(group: PlannedGroup) {
  return {
    project: group.project && { type: group.project.type, title: group.project.title, price: group.project.price, features: group.project.features, notes: group.project.notes, context: group.project.context },
    faq: group.faq,
    holiday: group.holiday ? { name: group.holiday.name, date: group.holiday.date } : undefined,
    date: group.day,
  };
}

function weekLabel(weekStart: Date, tz: string, locale = "en") {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, day: "numeric", month: "long" }).format(weekStart);
}

export interface RunOptions {
  weekStart?: Date;
  now?: Date;
  /** Background run with no signed-in user: Storage goes through the service key. */
  service?: boolean;
  trends?: TrendSource;
}

/** Runs Autopilot for the business the user owns. The only entry point for user actions. */
export async function runAutopilotForUser(userId: string, options: RunOptions = {}): Promise<RunResult> {
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  if (!business) return { status: "nothing_to_plan", postCount: 0, groupCount: 0, note: "We could not find your business." };
  return runAutopilot(business.id, options);
}

export async function runAutopilot(businessId: string, options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? new Date();
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { autopilot: true, industryRef: true, user: { select: { id: true, email: true, deletionScheduledFor: true, suspendedAt: true } } },
  });
  if (!business) return { status: "nothing_to_plan", postCount: 0, groupCount: 0, note: "We could not find your business." };

  // Accounts waiting to be deleted, or suspended by the admin, are left alone (before the week is claimed).
  if (business.user.deletionScheduledFor || business.user.suspendedAt) return { status: "nothing_to_plan", postCount: 0, groupCount: 0 };

  // Autopilot is a plan feature: a company without it is left alone (the cron skips it, the button explains). While
  // the plan cannot be checked, the same: nothing is claimed, so it plans normally once the catalog is back.
  const autopilot = await featureStatus(businessId, "autopilot");
  if (autopilot !== "ok") return { status: "nothing_to_plan", postCount: 0, groupCount: 0, note: new FeatureRequiredError("autopilot", autopilot).message };

  // AI switched off in the admin console: wait, without claiming the week, so it plans normally once it is back.
  if (!(await isServiceEnabled(textAiService()))) return { status: "nothing_to_plan", postCount: 0, groupCount: 0, note: "Autopilot is paused for a short while. Please try again later." };

  const tz = safeZone(business.timezone);
  const key = weekKey(options.weekStart ?? nextWeekStart(now, tz), tz);
  const weekStart = weekStartFromKey(key, tz);
  const empty = (status: RunStatus, note?: string, runId?: string): RunResult => ({ status, runId, postCount: 0, groupCount: 0, note });

  const claim = await claimRun(businessId, key, now);
  if (!claim) return empty("already_planned");
  const runId = claim.id;
  const saved = { posts: 0 };

  try {
    const plan = await planWeek(businessId, weekStart, now);
    if (!plan || plan.input.connections.length === 0) {
      await prisma.autopilotRun.delete({ where: { id: runId } });
      return empty("nothing_to_plan", "Connect an account and pick it in the Autopilot settings first.");
    }
    const { input } = plan;
    const userId = business.user.id;
    const autoPublish = input.config.autoPublish;
    const notes = [...plan.notes];
    const knowledge = readKnowledge(business.knowledge);
    const configured = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();
    const brand: WriterBrand = {
      businessName: business.name,
      industry: business.industry,
      industryContext: industryContext(business),
      profile: profileContext(business.profile),
      description: business.description,
      audience: business.audience,
      tone: business.tone,
      website: business.website,
      contentLanguage: business.contentLanguage,
      knowledge: knowledgeFacts(knowledge),
      ownerName: business.ceoName,
      country: business.country,
    };
    const trendSource = options.trends ?? noopTrendSource;

    // AI photos are their own plan feature; without it Autopilot draws the free templates only.
    const aiPhotos = await hasFeature(businessId, "aiPhotos");
    let aiStopped = false;
    const state: { stop: "credits" | "budget" | null } = { stop: null };
    let postCount = 0;
    let groupCount = 0;

    // Credits are reserved one at a time: the usage row is created on first use, and two parallel
    // first reservations would both try to create it.
    let reserving: Promise<unknown> = Promise.resolve();
    const reserve = () => {
      const next = reserving.then(() => consumeUsage(userId, "text"));
      reserving = next.catch(() => undefined);
      return next;
    };

    const doGroup = async (group: PlannedGroup) => {
      if (state.stop) return;
      let reservation: { periodStart: Date };
      try {
        reservation = await reserve();
      } catch (error) {
        if (error instanceof UsageLimitError) {
          state.stop = "credits";
          return;
        }
        await logError(error, { source: "autopilot.reserve", userId, businessId });
        notes.push(`One post (${group.idea.name}) could not be written this time.`);
        return;
      }
      let finished = false;
      try {
        const targets = group.networks.map((network) => ({ network, format: group.posts.find((p) => p.network === network)!.format }));
        const trends = (await trendSource.trends({ network: targets[0].network, country: business.country, industry: business.industry }).catch(() => [])).slice(0, 3);
        const request: WriteRequest = { brand, idea: group.idea, facts: { ...factsFor(group), trends }, targets };
        const written = await withLedger(
          { userId, businessId, feature: "autopilot" },
          { provider: configured, model: configuredModel(configured) },
          () => writeGroup(getTextProvider(), request),
          (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
        );

        const images = await makeGroupImages(group, written.image, { userId, businessId, businessName: business.name, language: business.contentLanguage, useAiImages: input.config.useAiImages && aiPhotos && !aiStopped, service: options.service ?? false }, { aiStopped });
        if (images.aiStopped) aiStopped = true;
        for (const note of images.notes) if (!notes.includes(note)) notes.push(note);

        const rows = group.posts.flatMap((planned) => {
          const version = written.versions.find((v) => v.network === planned.network);
          if (!version) return [];
          const design = images.designs[aspectFor(planned.network)];
          const extras = planned.format === "CAROUSEL" ? group.photos.slice(1).map((p) => p.path) : [];
          const mediaPaths = planned.format === "SCRIPT" || planned.format === "ARTICLE" ? [] : [...(design ? [design] : []), ...extras].slice(0, getProvider(planned.network).rules.maxImages || 10);
          const format = planned.format === "CAROUSEL" && mediaPaths.length < 2 ? "POST" : planned.format;
          // Networks that need a picture cannot publish without one: leave it as a draft to finish.
          const needsPicture = getProvider(planned.network).rules.requiresMedia && format !== "SCRIPT" && mediaPaths.length === 0;
          return [
            {
              businessId,
              connectionId: planned.connectionId,
              network: planned.network,
              groupId: group.groupId,
              productId: group.project && group.project.subject !== "campaign" ? group.project.id : null,
              campaignId: group.project?.subject === "campaign" ? group.project.id : null,
              status: needsPicture ? ("DRAFT" as const) : autoPublish ? ("SCHEDULED" as const) : ("PENDING_APPROVAL" as const),
              format,
              source: "AUTOPILOT" as const,
              title: version.title,
              text: version.text,
              hashtags: version.hashtags,
              mediaPaths,
              scheduledAt: planned.scheduledAt,
              autopilotRunId: runId,
              playbookId: group.idea.id,
              lastError: needsPicture ? "This post needs a picture. Add one to post it." : null,
            },
          ];
        });
        await prisma.post.createMany({ data: rows });
        postCount += rows.length;
        saved.posts = postCount;
        groupCount += 1;
        finished = true;
        await prisma.autopilotRun.update({ where: { id: runId }, data: { postCount } });
      } catch (error) {
        if (error instanceof AIBudgetExceededError || error instanceof ServiceDisabledError) {
          state.stop = "budget";
          return;
        }
        await logError(error, { source: "autopilot.group", userId, businessId, idea: group.idea.id, level: error instanceof AIProviderError ? "warn" : "error" });
        notes.push(`One post (${group.idea.name}) could not be written this time.`);
      } finally {
        // A credit is only kept for a group whose posts were saved.
        if (!finished) await refundUsage(userId, "text", reservation.periodStart).catch((e) => logError(e, { source: "autopilot.refund", userId, businessId }));
      }
    };

    // A few groups at a time; each charges and refunds its own credit.
    const queue = [...plan.groups];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let group = queue.shift(); group; group = queue.shift()) {
          if (state.stop) return;
          await doGroup(group);
        }
      }),
    );

    if (state.stop === "credits") {
      notes.unshift(
        groupCount === 0
          ? "Autopilot could not write this week's posts because your plan has no text credits left. It will try again when your credits renew, or pick a plan to keep going."
          : `Your plan ran out of text credits after ${groupCount} of ${plan.groups.length} post ideas. The rest were left out.`,
      );
    } else if (state.stop === "budget") {
      notes.unshift("Autopilot is paused for a short while. Please try again later.");
    }
    const note = notes.length > 0 ? notes.join(" ") : null;

    await prisma.autopilotRun.update({ where: { id: runId }, data: { status: "DONE", postCount, error: note } });

    if (postCount > 0 && !autoPublish && business.user.email) {
      for (const to of await alertRecipients(businessId, business.user.email)) {
        await sendReadyEmail({ to, businessName: business.name, postCount, groupCount, weekLabel: weekLabel(weekStart, tz) }).catch((e) => logError(e, { source: "autopilot.email", businessId, level: "warn" }));
      }
    }
    return { status: postCount === 0 && state.stop === "credits" ? "no_credits" : "planned", runId, postCount, groupCount, note: note ?? undefined };
  } catch (error) {
    await logError(error, { source: "autopilot.run", businessId });
    // Posts already saved stay, and the week counts as planned: running it again would repeat them.
    if (saved.posts > 0) {
      const note = "Autopilot ran into a problem part-way, so some posts are missing. The ones below are ready.";
      await prisma.autopilotRun.update({ where: { id: runId }, data: { status: "DONE", postCount: saved.posts, error: note } }).catch(() => {});
      return { status: "planned", runId, postCount: saved.posts, groupCount: 0, note };
    }
    await prisma.autopilotRun.update({ where: { id: runId }, data: { status: "FAILED", error: "Autopilot ran into a problem. Please try again." } }).catch(() => {});
    return empty("failed", "Autopilot ran into a problem. Please try again.", runId);
  }
}

export interface DueResult {
  checked: number;
  planned: number;
  skipped: number;
  failed: number;
  /** Pass this back as `cursor` to continue; null when every enabled business was reached. */
  nextCursor: string | null;
}

const PAGE = 100;

/**
 * Plans next week for businesses that still need it, from the Friday of their own week. Businesses are
 * visited in id order after `cursor`, a few planned per call, so a loop of calls reaches every one.
 */
export async function runDueBusinesses(options: { now?: Date; limit?: number; cursor?: string | null } = {}): Promise<DueResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 2;
  const result: DueResult = { checked: 0, planned: 0, skipped: 0, failed: 0, nextCursor: null };
  let cursor = options.cursor ?? null;
  for (;;) {
    const page = await prisma.autopilotSettings.findMany({
      where: {
        enabled: true,
        NOT: { connectionIds: { isEmpty: true } },
        business: { user: { deletionScheduledFor: null, suspendedAt: null } },
        ...(cursor ? { businessId: { gt: cursor } } : {}),
      },
      select: { businessId: true, business: { select: { timezone: true } } },
      orderBy: { businessId: "asc" },
      take: PAGE,
    });
    if (page.length === 0) return result;
    for (const { businessId, business } of page) {
      cursor = businessId;
      result.checked += 1;
      const tz = safeZone(business.timezone);
      // Plan from Friday (local) on; earlier in the week it is too soon.
      if (weekdayOfISO(localDateISO(now, tz)) < 4) {
        result.skipped += 1;
        continue;
      }
      const outcome = await runAutopilot(businessId, { now, service: true });
      if (outcome.status === "planned") result.planned += 1;
      else if (outcome.status === "failed") result.failed += 1;
      else result.skipped += 1;
      if (result.planned + result.failed >= limit) {
        result.nextCursor = cursor;
        return result;
      }
    }
    if (page.length < PAGE) return result;
  }
}
