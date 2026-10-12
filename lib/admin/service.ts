import "server-only";
import type { Prisma, PostStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { SEED_PLANS, type Plan, type UsageMetric } from "@/lib/plans";
import { getPlan, getPlans, priceIdFor } from "@/lib/plan-catalog";
import { listAdminPlans, previewPriceChange, setPlanLimits, updatePlan, type PlanInput } from "./plans-service";
import { isInterval, type PaidPlan } from "@/lib/billing/catalog";
import { applyProviderSubscription } from "@/lib/billing/apply";
import { paddle } from "@/lib/billing/paddle";
import { createRefund, describeRefundTarget } from "@/lib/billing/paddle-admin";
import { retryPost, PublishingError } from "@/lib/publishing/service";
import { monthlyCostSchema, type MonthlyCostInput } from "@/lib/analytics/costs";
import { writeAudit } from "./audit";
import { getSetting } from "./settings";
import * as companies from "./actions/companies";
import { isServiceEnabled } from "./switch";
import { clearFlagCache } from "./flags";
import {
  AdminError,
  APPROVAL_STATUSES,
  type AdminContext,
  type ApprovalKind,
  type ApprovalReceipt,
  type ApprovalStatus,
  type ApprovalView,
  type Page,
} from "./types";

export * from "./types";
export { createAdminKey, listAdminKeys, revokeAdminKey, rotateAdminKey } from "./keys";
export { isEnabled } from "./flags";

const DAY_MS = 24 * 60 * 60 * 1000;
export const APPROVAL_TTL_MS = 7 * DAY_MS;
const SUBSCRIPTION_STATUSES = ["PENDING_DEMO", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"] as const;
const POST_STATUSES = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "PUBLISHED", "NEEDS_ACTION", "FAILED", "CANCELLED"] as const;

// ---- small helpers ----------------------------------------------------------------------------------------

function limitOf(value: number | undefined, def = 25) {
  return Math.min(Math.max(Math.trunc(value ?? def) || def, 1), 100);
}

function page<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return { items, nextCursor: more ? items[items.length - 1].id : null };
}

function asDate(value: Date | string | undefined, field: string): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new AdminError("invalid", `${field} is not a valid date.`);
  return d;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new AdminError("invalid", `${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireConfirm(ctx: AdminContext, confirm: boolean | undefined, what: string) {
  if (ctx.viaApi && confirm !== true) throw new AdminError("confirm_required", `${what} is destructive. Send confirm: true to proceed.`);
}

// ---- reads: users and businesses ---------------------------------------------------------------------------

const userSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  suspendedAt: true,
  suspendedReason: true,
  deletionScheduledFor: true,
  subscription: { select: { plan: true, status: true, provider: true, interval: true, trialEndsAt: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } },
  business: { select: { id: true, name: true, industry: true, country: true, onboardedAt: true } },
  usage: { orderBy: { periodStart: "desc" }, take: 1, select: { periodStart: true, textGenerations: true, imageGenerations: true, videoSeconds: true, voiceCharacters: true, chatMessages: true, updatedAt: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function userView(u: UserRow) {
  const usage = u.usage[0];
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
    status: u.suspendedAt ? "suspended" : u.deletionScheduledFor ? "deleting" : "active",
    suspendedAt: u.suspendedAt,
    suspendedReason: u.suspendedReason,
    deletionScheduledFor: u.deletionScheduledFor,
    plan: u.subscription?.plan ?? null,
    subscriptionStatus: u.subscription?.status ?? null,
    provider: u.subscription?.provider ?? null,
    interval: u.subscription?.interval ?? null,
    trialEndsAt: u.subscription?.trialEndsAt ?? null,
    currentPeriodEnd: u.subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: u.subscription?.cancelAtPeriodEnd ?? false,
    business: u.business ? { id: u.business.id, name: u.business.name, industry: u.business.industry, country: u.business.country, onboarded: Boolean(u.business.onboardedAt) } : null,
    usage: usage
      ? { periodStart: usage.periodStart, text: usage.textGenerations, image: usage.imageGenerations, videoSeconds: usage.videoSeconds, voiceCharacters: usage.voiceCharacters, chat: usage.chatMessages }
      : null,
    /** The last time the user used a metered feature this period (null when never). */
    lastActivityAt: usage?.updatedAt ?? null,
  };
}

export type UserSummary = ReturnType<typeof userView>;

export async function listUsers(
  opts: { q?: string; plan?: string; status?: string; suspended?: boolean; cursor?: string; limit?: number } = {},
): Promise<Page<UserSummary>> {
  const limit = limitOf(opts.limit);
  const plan = opts.plan?.trim().slice(0, 64) || undefined; // a plan key; an unknown one simply matches nobody
  const status = oneOf(opts.status, SUBSCRIPTION_STATUSES, "status");
  const q = opts.q?.trim().slice(0, 100);
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { business: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    ...(plan || status ? { subscription: { ...(plan ? { plan } : {}), ...(status ? { status } : {}) } } : {}),
    ...(opts.suspended === true ? { suspendedAt: { not: null } } : opts.suspended === false ? { suspendedAt: null } : {}),
  };
  const rows = await prisma.user.findMany({
    where,
    select: userSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  return { items: p.items.map(userView), nextCursor: p.nextCursor };
}

export async function getUser(id: string) {
  const row = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!row) throw new AdminError("not_found", "No user with that id.");
  const businessId = row.business?.id;
  const [postCounts, leads, errors, approvals] = await Promise.all([
    businessId ? prisma.post.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }) : [],
    businessId ? prisma.lead.count({ where: { businessId } }) : 0,
    prisma.errorLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, createdAt: true, level: true, source: true, message: true } }),
    prisma.adminApproval.findMany({ where: { params: { path: ["userId"], equals: id } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, kind: true, status: true, createdAt: true } }),
  ]);
  let lastSignInAt: string | null = null;
  try {
    const { data } = await createAdminClient().auth.admin.getUserById(id);
    lastSignInAt = data.user?.last_sign_in_at ?? null;
  } catch {
    // Sign-in time is a nicety; the rest of the profile is still useful.
  }
  return {
    ...userView(row),
    lastSignInAt,
    posts: Object.fromEntries(postCounts.map((c) => [c.status, c._count._all])),
    leads,
    recentErrors: errors,
    recentApprovals: approvals,
  };
}

const businessSelect = {
  id: true,
  userId: true,
  name: true,
  industry: true,
  description: true,
  website: true,
  country: true,
  timezone: true,
  contentLanguage: true,
  onboardedAt: true,
  createdAt: true,
  user: { select: { email: true, suspendedAt: true, subscription: { select: { plan: true, status: true } } } },
  _count: { select: { projects: true, posts: true, leads: true, connections: true } },
} satisfies Prisma.BusinessSelect;

type BusinessRow = Prisma.BusinessGetPayload<{ select: typeof businessSelect }>;

function businessView(b: BusinessRow) {
  return {
    id: b.id,
    userId: b.userId,
    ownerEmail: b.user.email,
    name: b.name,
    industry: b.industry,
    description: b.description,
    website: b.website,
    country: b.country,
    timezone: b.timezone,
    contentLanguage: b.contentLanguage,
    onboarded: Boolean(b.onboardedAt),
    createdAt: b.createdAt,
    plan: b.user.subscription?.plan ?? null,
    subscriptionStatus: b.user.subscription?.status ?? null,
    suspended: Boolean(b.user.suspendedAt),
    counts: { projects: b._count.projects, posts: b._count.posts, leads: b._count.leads, connections: b._count.connections },
  };
}

export async function listBusinesses(opts: { q?: string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const q = opts.q?.trim().slice(0, 100);
  const rows = await prisma.business.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { industry: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }] } : {},
    select: businessSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  return { items: p.items.map(businessView), nextCursor: p.nextCursor };
}

export async function getBusiness(id: string) {
  const row = await prisma.business.findUnique({ where: { id }, select: businessSelect });
  if (!row) throw new AdminError("not_found", "No business with that id.");
  const [connections, postCounts] = await Promise.all([
    prisma.connection.findMany({ where: { businessId: id }, select: { id: true, provider: true, status: true, displayName: true } }).catch(() => []),
    prisma.post.groupBy({ by: ["status"], where: { businessId: id }, _count: { _all: true } }),
  ]);
  return { ...businessView(row), connections, posts: Object.fromEntries(postCounts.map((c) => [c.status, c._count._all])) };
}

// ---- reads: posts, errors, audit ---------------------------------------------------------------------------

export async function listPosts(opts: { status?: string; businessId?: string; userId?: string; network?: string; since?: Date | string; until?: Date | string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const status = oneOf(opts.status, POST_STATUSES, "status") as PostStatus | undefined;
  const since = asDate(opts.since, "since");
  const until = asDate(opts.until, "until");
  const rows = await prisma.post.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(opts.businessId ? { businessId: opts.businessId } : {}),
      ...(opts.userId ? { business: { userId: opts.userId } } : {}),
      ...(opts.network ? { network: opts.network } : {}),
      ...(since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}),
    },
    select: { id: true, businessId: true, network: true, status: true, format: true, source: true, text: true, scheduledAt: true, publishedAt: true, permalink: true, attempts: true, lastError: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const p = page(rows, limit);
  return { items: p.items.map((r) => ({ ...r, text: r.text.slice(0, 280) })), nextCursor: p.nextCursor };
}

export async function getErrors(opts: { level?: string; source?: string; userId?: string; since?: Date | string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const since = asDate(opts.since, "since");
  const level = oneOf(opts.level, ["error", "warn"] as const, "level");
  const rows = await prisma.errorLog.findMany({
    where: { ...(level ? { level } : {}), ...(opts.source ? { source: opts.source } : {}), ...(opts.userId ? { userId: opts.userId } : {}), ...(since ? { createdAt: { gte: since } } : {}) },
    select: { id: true, createdAt: true, level: true, source: true, message: true, userId: true, businessId: true, context: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  return page(rows, limit);
}

export async function getAuditLog(opts: { actor?: string; action?: string; target?: string; since?: Date | string; until?: Date | string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const since = asDate(opts.since, "since");
  const until = asDate(opts.until, "until");
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(opts.actor ? { actor: opts.actor } : {}),
      ...(opts.action ? { action: opts.action } : {}),
      ...(opts.target ? { target: opts.target } : {}),
      ...(since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  return page(rows, limit);
}

// ---- trial, suspension -------------------------------------------------------------------------------------

async function subscriptionOf(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub) throw new AdminError("not_found", "That user has no subscription.");
  return sub;
}

/** Adds days to a trial (from the later of now and the current end). Only for trial subscriptions. */
export async function extendTrial(ctx: AdminContext, input: { userId: string; days: number }) {
  const days = Math.trunc(Number(input.days));
  if (!Number.isFinite(days) || days < 1 || days > 90) throw new AdminError("invalid", "days must be a whole number from 1 to 90.");
  const sub = await subscriptionOf(input.userId);
  if (sub.plan !== "TRIAL") throw new AdminError("conflict", `This user is on the ${(await getPlan(sub.plan))?.name ?? sub.plan} plan, not a trial.`);
  const now = new Date();
  const base = sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
  const trialEndsAt = new Date(base.getTime() + days * DAY_MS);
  const before = { trialEndsAt: sub.trialEndsAt, status: sub.status };
  const status = sub.status === "EXPIRED" || sub.status === "CANCELED" ? "TRIALING" : sub.status;
  // A longer trial gets its two end-of-trial reminders again (lib/demo/trial-reminders.ts).
  const after = { trialEndsAt, status, trialReminder1SentAt: null, trialReminder2SentAt: null };
  await prisma.$transaction(async (tx) => {
    // Guarded on the value we read, so two extensions at once cannot silently overwrite each other.
    const { count } = await tx.subscription.updateMany({ where: { userId: input.userId, plan: "TRIAL", trialEndsAt: sub.trialEndsAt }, data: after });
    if (count !== 1) throw new AdminError("conflict", "The trial changed while extending it. Try again.");
    await writeAudit(tx, ctx, "extend_trial", `user:${input.userId}`, before, { ...after, days });
  });
  return { userId: input.userId, ...after };
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "admin@bupulse.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Ends every session of the user (refresh tokens cascade), so they cannot get a new access token. */
async function endSessions(userId: string): Promise<boolean> {
  try {
    await prisma.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${userId}::uuid`;
    return true;
  } catch (error) {
    await logError(error, { source: "admin:end-sessions", userId });
    return false;
  }
}

async function setAuthBan(userId: string, banned: boolean): Promise<boolean> {
  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: banned ? "876000h" : "none" });
    if (error) throw error;
    return true;
  } catch (error) {
    await logError(error, { source: "admin:set-auth-ban", userId, banned });
    return false;
  }
}

/**
 * Blocks sign-in (Supabase ban) and all app use (every page, action, API call and the publisher check
 * User.suspendedAt). Data is kept. Needs `confirm: true` from the API.
 */
export async function suspendUser(ctx: AdminContext, input: { userId: string; reason?: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Suspending a user");
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, suspendedAt: true, suspendedReason: true } });
  if (!user) throw new AdminError("not_found", "No user with that id.");
  if (adminEmails().includes(user.email.toLowerCase())) throw new AdminError("forbidden", "The admin account cannot be suspended.");
  if (user.suspendedAt) throw new AdminError("conflict", "That user is already suspended.");
  const reason = input.reason?.trim().slice(0, 300) || null;
  const suspendedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({ where: { id: user.id, suspendedAt: null }, data: { suspendedAt, suspendedReason: reason } });
    if (count !== 1) throw new AdminError("conflict", "That user is already suspended.");
    await writeAudit(tx, ctx, "suspend_user", `user:${user.id}`, { suspendedAt: null }, { suspendedAt, reason });
  });
  const signInBlocked = await setAuthBan(user.id, true);
  // An access token already issued stays valid until it expires (Supabase default: 1 hour), but cannot be refreshed.
  const sessionsEnded = await endSessions(user.id);
  return { userId: user.id, suspendedAt, signInBlocked, sessionsEnded };
}

export async function restoreUser(ctx: AdminContext, input: { userId: string }) {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, suspendedAt: true, suspendedReason: true } });
  if (!user) throw new AdminError("not_found", "No user with that id.");
  if (!user.suspendedAt) throw new AdminError("conflict", "That user is not suspended.");
  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { id: user.id }, data: { suspendedAt: null, suspendedReason: null } });
    await writeAudit(tx, ctx, "restore_user", `user:${user.id}`, { suspendedAt: user.suspendedAt, reason: user.suspendedReason }, { suspendedAt: null });
  });
  const signInRestored = await setAuthBan(user.id, false);
  return { userId: user.id, suspendedAt: null, signInRestored };
}

// ---- feature flags and announcements -----------------------------------------------------------------------

const FLAG_KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

export async function listFeatureFlags() {
  return prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
}

/** Creates or updates a flag. userOverrides is merged: a value of null removes that user's override. */
export async function setFeatureFlag(
  ctx: AdminContext,
  input: { key: string; enabled?: boolean; rolloutPercent?: number; userOverrides?: Record<string, boolean | null>; description?: string },
) {
  if (!FLAG_KEY.test(input.key ?? "")) throw new AdminError("invalid", "Flag keys use lowercase letters, numbers, dots, dashes and underscores (max 64).");
  if (input.rolloutPercent !== undefined && (!Number.isInteger(input.rolloutPercent) || input.rolloutPercent < 0 || input.rolloutPercent > 100)) {
    throw new AdminError("invalid", "rolloutPercent must be a whole number from 0 to 100.");
  }
  if (input.enabled === undefined && input.rolloutPercent === undefined && !input.userOverrides && input.description === undefined) {
    throw new AdminError("invalid", "Nothing to change: send enabled, rolloutPercent, userOverrides or description.");
  }
  const existing = await prisma.featureFlag.findUnique({ where: { key: input.key } });
  const overrides: Record<string, boolean> = { ...((existing?.userOverrides as Record<string, boolean> | null) ?? {}) };
  for (const [userId, value] of Object.entries(input.userOverrides ?? {})) {
    if (value === null) delete overrides[userId];
    else if (typeof value === "boolean") overrides[userId] = value;
    else throw new AdminError("invalid", "userOverrides values must be true, false or null.");
  }
  const data = {
    enabled: input.enabled ?? existing?.enabled ?? false,
    rolloutPercent: input.rolloutPercent ?? existing?.rolloutPercent ?? 100,
    userOverrides: overrides,
    description: input.description ?? existing?.description ?? null,
  };
  const snapshot = (f: { enabled: boolean; rolloutPercent: number; userOverrides: unknown; description: string | null } | null) =>
    f ? { enabled: f.enabled, rolloutPercent: f.rolloutPercent, userOverrides: f.userOverrides, description: f.description } : null;
  const flag = await prisma.$transaction(async (tx) => {
    const saved = await tx.featureFlag.upsert({ where: { key: input.key }, create: { key: input.key, ...data }, update: data });
    await writeAudit(tx, ctx, "set_feature_flag", `flag:${input.key}`, snapshot(existing), snapshot(saved));
    return saved;
  });
  clearFlagCache();
  return flag;
}

export async function listAnnouncements() {
  return prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
}

export async function sendAnnouncement(
  ctx: AdminContext,
  input: { title: string; body: string; audience?: "all" | "plan"; plans?: string[]; startsAt?: Date | string; endsAt?: Date | string; dismissible?: boolean },
) {
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (!title || title.length > 120) throw new AdminError("invalid", "title is required (max 120 characters).");
  if (!body || body.length > 2000) throw new AdminError("invalid", "body is required (max 2000 characters).");
  const audience = oneOf(input.audience ?? "all", ["all", "plan"] as const, "audience")!;
  const known = (await getPlans()).map((p) => p.key);
  const plans = (input.plans ?? []).map((p) => oneOf(p, known, "plans")!) as Plan[];
  if (audience === "plan" && plans.length === 0) throw new AdminError("invalid", 'audience "plan" needs a non-empty plans list.');
  const startsAt = asDate(input.startsAt, "startsAt") ?? new Date();
  const endsAt = asDate(input.endsAt, "endsAt") ?? null;
  if (endsAt && endsAt <= startsAt) throw new AdminError("invalid", "endsAt must be after startsAt.");
  const data = { title, body, audience, plans: audience === "plan" ? plans : [], startsAt, endsAt, dismissible: input.dismissible ?? true, createdBy: ctx.actor };
  return prisma.$transaction(async (tx) => {
    const row = await tx.announcement.create({ data });
    await writeAudit(tx, ctx, "send_announcement", `announcement:${row.id}`, null, data);
    return row;
  });
}

export async function endAnnouncement(ctx: AdminContext, id: string) {
  const row = await prisma.announcement.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No announcement with that id.");
  const endsAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.announcement.update({ where: { id }, data: { endsAt } });
    await writeAudit(tx, ctx, "end_announcement", `announcement:${id}`, { endsAt: row.endsAt }, { endsAt });
  });
}

/** Announcements to show this user now (for the dashboard). `plan` is looked up when not given. */
export async function getActiveAnnouncements(user: { id: string; plan?: Plan | null }, now = new Date()) {
  const plan = user.plan ?? (await prisma.subscription.findUnique({ where: { userId: user.id }, select: { plan: true } }))?.plan ?? null;
  const rows = await prisma.announcement.findMany({
    where: {
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      AND: [{ OR: [{ audience: "all" }, ...(plan ? [{ audience: "plan", plans: { has: plan } }] : [])] }],
    },
    orderBy: { startsAt: "desc" },
    take: 5,
    select: { id: true, title: true, body: true, dismissible: true, startsAt: true, endsAt: true },
  });
  return rows;
}

// ---- plan limits -------------------------------------------------------------------------------------------

export async function getPlanLimitsView() {
  const plans = await getPlans({ force: true });
  return Object.fromEntries(
    plans.map((p) => {
      const defaults = SEED_PLANS[p.key]?.limits ?? { text: 0, image: 0, videoSeconds: 0, voiceCharacters: 0, chat: 0 };
      // "overrides" = the metrics that differ from what the plan was seeded with.
      const overrides = Object.fromEntries(Object.entries(p.limits).filter(([m, v]) => defaults[m as UsageMetric] !== v));
      return [p.key, { defaults, overrides, effective: p.limits }];
    }),
  );
}

/** Sets a plan's limits (they live on the plan; /admin/plans edits the same numbers). A metric set to null goes back to its seed value. */
export async function updatePlanLimits(ctx: AdminContext, input: { plan: string; limits: Partial<Record<UsageMetric | "seats", number | null>>; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Changing plan limits");
  if (!input.plan) throw new AdminError("invalid", "plan is required.");
  const { plan, effective } = await setPlanLimits(ctx, { plan: input.plan, limits: input.limits });
  const defaults = SEED_PLANS[plan]?.limits ?? { text: 0, image: 0, videoSeconds: 0, voiceCharacters: 0, chat: 0 };
  return { plan, effective, overrides: Object.fromEntries(Object.entries(effective).filter(([m, v]) => defaults[m as UsageMetric] !== v)) };
}

// ---- posts -------------------------------------------------------------------------------------------------

/**
 * Puts a FAILED post back in the publishing queue through the engine's own retry (attempts reset, scheduled now).
 * NEEDS_ACTION posts are never touched: the network may already have the post, so a resend could double-post.
 */
export async function rerunFailedPost(ctx: AdminContext, input: { postId: string }) {
  const post = await prisma.post.findUnique({ where: { id: input.postId }, select: { id: true, businessId: true, status: true, attempts: true, lastError: true, scheduledAt: true, business: { select: { userId: true } } } });
  if (!post) throw new AdminError("not_found", "No post with that id.");
  if (post.status === "NEEDS_ACTION") throw new AdminError("conflict", "This post may already be live on the network (status NEEDS_ACTION), so it is never re-sent. Ask the owner to check the network and mark it posted.");
  if (post.status !== "FAILED") throw new AdminError("conflict", `Only FAILED posts can be rerun; this one is ${post.status}.`);
  try {
    await retryPost({ businessId: post.businessId, userId: post.business.userId }, post.id);
  } catch (error) {
    if (error instanceof PublishingError) throw new AdminError(error.code === "not_found" ? "not_found" : "conflict", error.message);
    throw error;
  }
  const after = await prisma.post.findUnique({ where: { id: post.id }, select: { status: true, attempts: true, lastError: true, scheduledAt: true } });
  await writeAudit(prisma, ctx, "rerun_failed_post", `post:${post.id}`, { status: post.status, attempts: post.attempts, lastError: post.lastError }, after);
  return { postId: post.id, status: after?.status ?? "SCHEDULED", scheduledAt: after?.scheduledAt ?? null };
}

// ---- money actions: approvals ------------------------------------------------------------------------------

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

function approvalView(a: Prisma.AdminApprovalGetPayload<object>): ApprovalView {
  return {
    id: a.id,
    kind: a.kind as ApprovalKind,
    params: a.params as Record<string, unknown>,
    status: a.status as ApprovalStatus,
    requestedBy: a.requestedBy,
    idempotencyKey: a.idempotencyKey,
    result: a.result,
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Money actions need Paddle switched on (the console switch); webhooks are unaffected. */
async function requirePaddleOn() {
  if (!(await isServiceEnabled("paddle"))) throw new AdminError("unavailable", "Paddle is switched off in Services, so money actions are paused. Switch it on first.");
}

const WAITING = "Waiting for the owner to approve it in the admin console. Nothing has been done yet.";

/**
 * Creates a pending approval. A repeated idempotency key returns the same approval (matching request) or a conflict
 * (different request) without building the params again, so a replay never calls Paddle. Nothing money-related happens
 * here: only approveAction runs it.
 */
async function createApproval(
  ctx: AdminContext,
  kind: ApprovalKind,
  request: Record<string, unknown>,
  build: () => Promise<Record<string, unknown>>,
  idempotencyKey: string | undefined,
): Promise<ApprovalReceipt> {
  if (!idempotencyKey) {
    if (ctx.viaApi) throw new AdminError("idempotency_required", "Money actions need an idempotencyKey (8-128 letters, numbers, . _ : -). Reuse the same key when retrying.");
    idempotencyKey = `console-${crypto.randomUUID()}`;
  }
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new AdminError("invalid", "idempotencyKey must be 8-128 characters: letters, numbers, . _ : -");
  const receipt = (a: { id: string; status: string }, replayed: boolean): ApprovalReceipt => ({
    id: a.id,
    status: a.status as ApprovalStatus,
    kind,
    replayed,
    message: a.status === "pending" ? WAITING : `This request is already ${a.status}.`,
  });
  // `request` is what the caller sent; it is stored inside params so a replay compares like with like.
  const replay = (row: Prisma.AdminApprovalGetPayload<object>) => {
    const stored = (row.params as { request?: unknown } | null)?.request;
    if (row.kind !== kind || stable(stored) !== stable(request)) throw new AdminError("conflict", "That idempotencyKey was already used for a different request.");
    return receipt(row, true);
  };
  const existing = await prisma.adminApproval.findUnique({ where: { idempotencyKey } });
  if (existing) return replay(existing);
  const params = { ...(await build()), request };
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.adminApproval.create({ data: { kind, params: params as Prisma.InputJsonObject, requestedBy: ctx.actor, idempotencyKey } });
      await writeAudit(tx, ctx, `request_${kind}`, `approval:${created.id}`, null, { params, status: "pending", idempotencyKey });
      return created;
    });
    return receipt(row, false);
  } catch (error) {
    // A parallel request with the same key won the unique index: return its row.
    if ((error as { code?: string }).code === "P2002") {
      const winner = await prisma.adminApproval.findUnique({ where: { idempotencyKey } });
      if (winner) return replay(winner);
    }
    throw error;
  }
}

/**
 * Prepares a refund. The payment is resolved NOW (the given transaction, or the user's newest completed one) and its id,
 * currency, total and the refund amount are stored, so the owner approves exactly what they see and approving refunds
 * that transaction and no other. Full unless `amountMinor` (smallest currency unit, e.g. cents) is given.
 */
export async function requestRefund(ctx: AdminContext, input: { userId: string; transactionId?: string; lineItemId?: string; amountMinor?: number; reason: string; idempotencyKey?: string }) {
  const reason = input.reason?.trim().slice(0, 300);
  if (!reason) throw new AdminError("invalid", "reason is required.");
  if (input.amountMinor !== undefined && (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0)) throw new AdminError("invalid", "amountMinor must be a positive whole number (e.g. cents).");
  const sub = await subscriptionOf(input.userId);
  if (sub.provider !== "PADDLE" || !sub.providerCustomerId) throw new AdminError("conflict", "That user has never paid through Paddle, so there is nothing to refund.");
  await requirePaddleOn();
  const customerId = sub.providerCustomerId;
  const request = { userId: input.userId, transactionId: input.transactionId ?? null, lineItemId: input.lineItemId ?? null, amountMinor: input.amountMinor ?? null, reason };
  return createApproval(ctx, "issue_refund", request, async () => {
    let target;
    try {
      target = await describeRefundTarget({ customerId, transactionId: input.transactionId });
    } catch (error) {
      throw new AdminError("conflict", `Could not find a payment to refund: ${error instanceof Error ? error.message : String(error)}`);
    }
    let lineItemId: string | null = null;
    if (input.amountMinor !== undefined) {
      // A partial refund applies to one line item: the one asked for, or the only one. The amount is checked against it.
      const line = input.lineItemId ? target.lines.find((l) => l.id === input.lineItemId) : target.lines.length === 1 ? target.lines[0] : undefined;
      if (!line) {
        throw new AdminError("invalid", input.lineItemId ? "lineItemId is not on that transaction." : `That payment has ${target.lines.length} line items; pass lineItemId (${target.lines.map((l) => l.id).join(", ")}).`);
      }
      if (input.amountMinor > line.totalMinor) throw new AdminError("invalid", `amountMinor (${input.amountMinor}) is more than that line item's total (${line.totalMinor} ${target.currency}).`);
      lineItemId = line.id;
    } else if (input.lineItemId) {
      throw new AdminError("invalid", "lineItemId only applies to a partial refund (with amountMinor).");
    }
    return {
      userId: input.userId,
      transactionId: target.transactionId,
      currency: target.currency,
      transactionTotalMinor: target.totalMinor,
      transactionBilledAt: target.billedAt,
      lineItemId,
      amountMinor: input.amountMinor ?? null,
      refundAmountMinor: input.amountMinor ?? target.totalMinor,
      refundType: input.amountMinor === undefined ? "full" : "partial",
      reason,
    };
  }, input.idempotencyKey);
}

/** Changing to STANDARD or PRO moves money, so it becomes an approval. TRIAL is not a money action and is applied now. */
export async function requestChangePlan(ctx: AdminContext, input: { userId: string; plan: string; interval?: string; idempotencyKey?: string; confirm?: boolean }) {
  const plan = typeof input.plan === "string" ? input.plan.trim() : "";
  if (!plan) throw new AdminError("invalid", "plan is required.");
  const target = await getPlan(plan);
  if (!target) throw new AdminError("invalid", "That plan does not exist. Check the plan keys at /admin/plans.");
  const sub = await subscriptionOf(input.userId);
  if (target.isTrial) {
    requireConfirm(ctx, input.confirm, "Moving a user back to the free trial");
    if (sub.providerSubscriptionId && (sub.status === "ACTIVE" || sub.status === "PAST_DUE" || sub.status === "TRIALING") && sub.plan !== "TRIAL") {
      throw new AdminError("conflict", "That user has a live paid subscription. Cancel it in Paddle first; BuPulse never ends a paid subscription from here.");
    }
    const before = { plan: sub.plan, status: sub.status, trialEndsAt: sub.trialEndsAt };
    // The trial length is the admin setting (Admin -> Settings), not the TRIAL plan's trialDays (docs/REGIONS.md).
    const trialDays = await getSetting("trialDays");
    const trialEndsAt = new Date(Date.now() + trialDays * DAY_MS);
    const after = { plan: target.key, status: "TRIALING" as const, trialEndsAt, trialReminder1SentAt: null, trialReminder2SentAt: null };
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { userId: input.userId }, data: after });
      await writeAudit(tx, ctx, "change_plan", `user:${input.userId}`, before, after);
    });
    return { id: null, status: "applied", kind: "change_plan" as const, replayed: false, message: `The user is back on a ${trialDays}-day free trial. No money was involved.` };
  }
  if (target.status === "retired") throw new AdminError("conflict", `The ${target.name} plan is retired and cannot be given to anyone new.`);
  await requirePaddleOn();
  const interval = input.interval ?? sub.interval;
  if (!isInterval(interval)) throw new AdminError("invalid", "interval must be MONTH or YEAR.");
  if (!sub.providerSubscriptionId || sub.provider !== "PADDLE") {
    throw new AdminError("conflict", "That user has no paid subscription to change. They have to check out themselves first (BuPulse cannot take a card on their behalf).");
  }
  if (!(await priceIdFor("PADDLE", plan, interval))) throw new AdminError("unavailable", `Paddle price for ${plan}/${interval} is not configured.`);
  const params = { userId: input.userId, plan, interval, currentPlan: sub.plan, currentInterval: sub.interval };
  return createApproval(ctx, "change_plan", { userId: input.userId, plan, interval }, async () => params, input.idempotencyKey);
}

/**
 * An email change through the API is only a request: the owner approves it in the console, where it runs as the console
 * action (old address notified, sessions ended). Details are checked and locked now, so the owner approves what they see.
 */
export async function requestChangeUserEmail(ctx: AdminContext, input: { userId: string; newEmail: string; sendReset?: boolean; idempotencyKey?: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Asking to change a sign-in email");
  const plan = await companies.prepareEmailChange(input);
  const request = { userId: input.userId, newEmail: plan.newEmail, sendReset: Boolean(input.sendReset) };
  return createApproval(ctx, "change_user_email", request, async () => ({ ...request, currentEmail: plan.currentEmail, company: plan.company }), input.idempotencyKey);
}

/** Making someone the owner of a company (the previous owner becomes Admin) is an approval from the API too. */
export async function requestMakeCompanyOwner(ctx: AdminContext, input: { userId: string; idempotencyKey?: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Asking to hand over a company's ownership");
  const plan = await companies.prepareMakeOwner(input);
  return createApproval(ctx, "make_company_owner", { userId: input.userId }, async () => ({ userId: input.userId, email: plan.email, company: plan.company, currentOwner: plan.currentOwner }), input.idempotencyKey);
}

/**
 * A plan price change moves money for every client on the plan, so from the API it only creates an approval; the owner
 * approves it in the console. The new prices are locked in the request, with the prices they replace.
 */
export async function requestPlanPriceChange(ctx: AdminContext, input: { plan: string; monthlyPriceCents?: number; yearlyPriceCents?: number; idempotencyKey?: string }) {
  const plan = await getPlan(input.plan);
  if (!plan) throw new AdminError("not_found", "No plan with that key.");
  if (plan.isTrial) throw new AdminError("conflict", "The free trial has no price.");
  const monthlyPriceCents = input.monthlyPriceCents ?? plan.monthlyPriceCents;
  const yearlyPriceCents = input.yearlyPriceCents ?? plan.yearlyPriceCents;
  for (const [label, v] of [["monthlyPriceCents", monthlyPriceCents], ["yearlyPriceCents", yearlyPriceCents]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 10_000_000) throw new AdminError("invalid", `${label} must be a whole number of cents from 1 to 10000000.`);
  }
  if (monthlyPriceCents === plan.monthlyPriceCents && yearlyPriceCents === plan.yearlyPriceCents) throw new AdminError("invalid", "Those are the prices the plan already has.");
  const preview = await previewPriceChange(plan.key, { monthlyPriceCents, yearlyPriceCents });
  const params = { plan: plan.key, planName: plan.name, oldMonthlyCents: plan.monthlyPriceCents, oldYearlyCents: plan.yearlyPriceCents, monthlyPriceCents, yearlyPriceCents, direction: preview.direction, affected: preview.affected, lines: preview.lines };
  return createApproval(ctx, "plan_price_change", { plan: plan.key, monthlyPriceCents, yearlyPriceCents }, async () => params, input.idempotencyKey);
}

/** The plans for Jarvis (list_plans): what clients can buy, with clients and MRR. */
export async function listPlansForTools() {
  const { plans, paddleConnected } = await listAdminPlans();
  return {
    paddleConnected,
    plans: plans.map((p) => ({
      key: p.key, name: p.name, description: p.description, status: p.status, isTrial: p.isTrial, trialDays: p.trialDays, sortOrder: p.sortOrder, highlight: p.highlight,
      monthlyPriceCents: p.monthlyPriceCents, yearlyPriceCents: p.yearlyPriceCents, currency: p.currency, limits: p.limits, highlights: p.highlights, features: p.features,
      clients: p.subscribers, payingClients: p.payingSubscribers, mrrCents: p.mrrCents, paddleSync: p.syncState, paddleSyncError: p.syncError,
    })),
  };
}

/**
 * update_plan: everything except the price is applied now (audited). A price change is a money action: it only creates an
 * approval request, which the owner approves in the console; the response then carries the approval receipt.
 */
export async function updatePlanFromTool(
  ctx: AdminContext,
  input: Partial<PlanInput> & { plan: string; confirm?: boolean; idempotencyKey?: string },
) {
  requireConfirm(ctx, input.confirm, "Changing a plan");
  const { plan: key, confirm: _confirm, idempotencyKey, monthlyPriceCents, yearlyPriceCents, ...rest } = input;
  void _confirm;
  const wantsPrice = monthlyPriceCents !== undefined || yearlyPriceCents !== undefined;
  const current = await getPlan(key);
  if (!current) throw new AdminError("not_found", "No plan with that key. Use list_plans.");
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<PlanInput>;
  const applied = Object.keys(patch).length > 0 ? await updatePlan(ctx, key, patch) : null;
  const approval = wantsPrice ? await requestPlanPriceChange(ctx, { plan: key, monthlyPriceCents, yearlyPriceCents, idempotencyKey }) : null;
  return { applied: applied ? { changed: applied.changed, warnings: applied.warnings } : null, priceChangeApproval: approval };
}

export async function listApprovals(opts: { status?: string; limit?: number } = {}) {
  const status = oneOf(opts.status, APPROVAL_STATUSES, "status");
  const rows = await prisma.adminApproval.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: limitOf(opts.limit, 50) });
  return rows.map(approvalView);
}

export async function countPendingApprovals() {
  return prisma.adminApproval.count({ where: { status: "pending" } });
}

export async function getApproval(id: string) {
  const row = await prisma.adminApproval.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No approval with that id.");
  return approvalView(row);
}

/**
 * True when we cannot tell whether Paddle acted: a network failure, a timeout or a 5xx. A definite 4xx answer, or one of
 * our own checks failing before anything was sent, is not uncertain.
 */
export function isUncertainProviderError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch failed
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  return error instanceof Error && /^Paddle API (5\d\d|408) /.test(error.message);
}

/** Runs the provider call. `onProviderDone` records the answer in its own write before any local step runs. */
async function executeApproval(kind: string, params: Record<string, unknown>, onProviderDone: (result: Record<string, unknown>) => Promise<void>, ctx: AdminContext): Promise<Record<string, unknown>> {
  if (kind === "plan_price_change") {
    // Not about one user. Only runs if the plan still has the prices the owner saw when approving.
    const plan = await getPlan(String(params.plan));
    if (!plan) throw new Error("That plan no longer exists.");
    if (plan.monthlyPriceCents !== params.oldMonthlyCents || plan.yearlyPriceCents !== params.oldYearlyCents) throw new Error("The plan's prices changed since this request was made. Ask for the change again.");
    const done = await updatePlan(ctx, plan.key, { monthlyPriceCents: Number(params.monthlyPriceCents), yearlyPriceCents: Number(params.yearlyPriceCents) }, { confirmPriceChange: true });
    const result = { plan: plan.key, priceChangeId: done.priceChange?.id ?? null, clientsToMove: done.priceChange?.subscribers ?? 0 };
    await onProviderDone(result);
    return result;
  }
  if (kind === "change_user_email" || kind === "make_company_owner") {
    // Not money: runs as the console action, with the approving admin as the actor (audited, old address notified).
    const result = kind === "change_user_email"
      ? { ...(await companies.changeUserEmail(ctx, { userId: String(params.userId), newEmail: String(params.newEmail), sendReset: params.sendReset === true })) }
      : { ...(await companies.changeCompanyUserRole(ctx, { userId: String(params.userId), role: "OWNER" })) };
    return result;
  }
  const userId = String(params.userId);
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub) throw new Error("That user has no subscription any more.");
  if (kind === "issue_refund") {
    if (!sub.providerCustomerId) throw new Error("That user has no Paddle customer.");
    // Exactly the transaction the owner saw when approving; there is deliberately no "latest" fallback here.
    if (typeof params.transactionId !== "string") throw new Error("This request has no transaction recorded; ask for the refund again.");
    const result = { ...(await createRefund({ customerId: sub.providerCustomerId, transactionId: params.transactionId, amountMinor: (params.amountMinor as number | null) ?? null, lineItemId: (params.lineItemId as string | null) ?? null, reason: String(params.reason) })) };
    await onProviderDone(result);
    return result;
  }
  if (kind === "change_plan") {
    const plan = params.plan as PaidPlan;
    const interval = params.interval as "MONTH" | "YEAR";
    const priceId = await priceIdFor("PADDLE", plan, interval);
    if (!priceId || !sub.providerSubscriptionId) throw new Error("The subscription or the Paddle price is missing.");
    const changed = await paddle.changePlan(sub.providerSubscriptionId, priceId);
    const done = { plan, interval, providerSubscriptionId: sub.providerSubscriptionId };
    await onProviderDone(done);
    const outcome = await applyProviderSubscription("PADDLE", changed);
    return { ...done, applied: outcome };
  }
  throw new Error(`Unknown approval kind: ${kind}`);
}

const CHECK_PADDLE = "Check Paddle before doing anything else. Do not request this again until you know what happened.";

/**
 * The owner clicked Approve. Console only. Claims the approval with one conditional update (pending -> approved),
 * so it runs at most once even with double clicks or parallel requests. Outcomes:
 * - executed: done.
 * - failed: Paddle definitely refused, or a check failed before anything was sent. Safe to request again.
 * - needs_check: Paddle may have acted (it answered, then a local step failed; or the call timed out / hit a 5xx).
 *   Never retried automatically; verify in Paddle.
 * A crash after the claim leaves "approved", which is also never retried.
 */
export async function approveAction(ctx: AdminContext, id: string): Promise<ApprovalView> {
  if (ctx.viaApi || ctx.actor !== "admin") throw new AdminError("forbidden", "Only the owner can approve a money action, in the admin console.");
  const row = await prisma.adminApproval.findUnique({ where: { id } });
  // Only the money kinds need Paddle; checked before claiming, so the request stays pending and can be approved later.
  if (!row || (row.kind !== "change_user_email" && row.kind !== "make_company_owner")) await requirePaddleOn();
  if (!row) throw new AdminError("not_found", "No approval with that id.");
  const decidedAt = new Date();
  // Pending AND not expired, in the same conditional update that claims it.
  const claim = await prisma.adminApproval.updateMany({ where: { id, status: "pending", createdAt: { gt: new Date(decidedAt.getTime() - APPROVAL_TTL_MS) } }, data: { status: "approved", decidedBy: ctx.actor, decidedAt } });
  if (claim.count !== 1) {
    const now = await prisma.adminApproval.findUnique({ where: { id }, select: { status: true } });
    if (now?.status === "pending") {
      await prisma.adminApproval.updateMany({ where: { id, status: "pending" }, data: { status: "rejected", decidedBy: ctx.actor, decidedAt, result: { reason: "expired" } } });
      throw new AdminError("conflict", "This request is older than 7 days and has expired. Ask for it again.");
    }
    throw new AdminError("conflict", `This request is already ${now?.status ?? "decided"}.`);
  }
  let status: ApprovalStatus = "executed";
  let result: Record<string, unknown>;
  let providerResult: Record<string, unknown> | null = null;
  try {
    result = await executeApproval(row.kind, row.params as Record<string, unknown>, async (r) => {
      providerResult = r;
      // Its own write, before anything else can fail: the money fact is on record even if the next step throws.
      await prisma.adminApproval.update({ where: { id }, data: { result: { stage: "provider_done", ...r } as Prisma.InputJsonObject } });
    }, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError(error, { source: "admin:approve", approvalId: id, kind: row.kind });
    if (providerResult) {
      status = "needs_check";
      result = { stage: "provider_done", ...(providerResult as Record<string, unknown>), warning: `Paddle did this, but BuPulse could not finish recording it. ${CHECK_PADDLE}`, error: message };
    } else if (isUncertainProviderError(error)) {
      status = "needs_check";
      result = { warning: `Paddle did not answer clearly, so it may or may not have done this. ${CHECK_PADDLE}`, error: message };
    } else {
      status = "failed";
      result = { error: message };
    }
  }
  const done = await prisma.adminApproval.update({ where: { id }, data: { status, result: result as Prisma.InputJsonObject } });
  await writeAudit(prisma, ctx, `approve_${row.kind}`, `approval:${id}`, { status: "pending", params: row.params }, { status, result });
  return approvalView(done);
}

export async function rejectAction(ctx: AdminContext, id: string): Promise<ApprovalView> {
  if (ctx.viaApi || ctx.actor !== "admin") throw new AdminError("forbidden", "Only the owner can reject a request, in the admin console.");
  const { count } = await prisma.adminApproval.updateMany({ where: { id, status: "pending" }, data: { status: "rejected", decidedBy: ctx.actor, decidedAt: new Date() } });
  const row = await prisma.adminApproval.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No approval with that id.");
  if (count !== 1) throw new AdminError("conflict", `This request is already ${row.status}.`);
  await writeAudit(prisma, ctx, `reject_${row.kind}`, `approval:${id}`, { status: "pending", params: row.params }, { status: "rejected" });
  return approvalView(row);
}

// ---- monthly costs (owner-entered, feed the profit numbers) -------------------------------------------------

const COST_NOTE_MAX = 120;
const costSnapshot = (r: { amountCents: number; note: string | null } | null) => (r ? { amountCents: r.amountCents, note: r.note } : null);

/** Adds or replaces the cost for a month and category, audited with the old and new values in one transaction. */
export async function setMonthlyCost(ctx: AdminContext, input: MonthlyCostInput) {
  const parsed = monthlyCostSchema.safeParse(input);
  if (!parsed.success) throw new AdminError("invalid", parsed.error.issues[0]?.message ?? "Invalid cost.");
  const v = parsed.data;
  if (v.note && v.note.length > COST_NOTE_MAX) throw new AdminError("invalid", `The note can be at most ${COST_NOTE_MAX} characters.`);
  const note = v.note || null;
  return prisma.$transaction(async (tx) => {
    const key = { month_category: { month: v.month, category: v.category } };
    const before = await tx.monthlyCost.findUnique({ where: key });
    const saved = await tx.monthlyCost.upsert({
      where: key,
      create: { month: v.month, category: v.category, amountCents: v.amountCents, note },
      update: { amountCents: v.amountCents, note },
    });
    await writeAudit(tx, ctx, "set_monthly_cost", `cost:${v.month}:${v.category}`, costSnapshot(before), costSnapshot(saved));
    return { month: saved.month, category: saved.category, amountCents: saved.amountCents, note: saved.note };
  });
}

export async function deleteMonthlyCost(ctx: AdminContext, input: { month: string; category: string }) {
  const month = input.month;
  const category = input.category?.trim().toLowerCase() ?? "";
  if (!month || !category) throw new AdminError("invalid", "month and category are required.");
  return prisma.$transaction(async (tx) => {
    const before = await tx.monthlyCost.findUnique({ where: { month_category: { month, category } } });
    if (!before) throw new AdminError("not_found", "No cost entered for that month and category.");
    await tx.monthlyCost.deleteMany({ where: { month, category } });
    await writeAudit(tx, ctx, "delete_monthly_cost", `cost:${month}:${category}`, costSnapshot(before), null);
    return { month, category, deleted: true };
  });
}
