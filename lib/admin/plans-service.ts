import "server-only";
import type { BillingInterval, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import {
  archivePaddlePrice,
  createPaddlePrice,
  createPaddleProduct,
  paddleConnected,
  updatePaddleProduct,
} from "@/lib/billing/paddle-catalog";
import { OPEN_ITEM_STATUSES, refreshChange } from "@/lib/billing/price-changes";
import {
  capabilitiesOf,
  clearPlanCache,
  currentPriceId,
  getPlans,
  subscriberPriceCents,
  viewOf,
  type PaddlePriceRecord,
  type PlanView,
} from "@/lib/plan-catalog";
import { validateFeatureSet, type FeatureKey } from "@/lib/features";
import { CAPABILITIES, PLAN_STATUSES, SEATS_MAX, SEATS_MIN, SEED_PLANS, TRIAL_PLAN_KEY, USAGE_METRICS, type Capability, type PlanLimits, type PlanStatus, type UsageMetric } from "@/lib/plans";
import { writeAudit } from "./audit";
import { AdminError, type AdminContext } from "./types";

// Plan management (/admin/plans and the Jarvis plan tools). Every change is audited with before and after. Paddle prices
// are created, never edited; a price change is created in Paddle first and only then written, together with the audit row
// and the subscriber moves, in one transaction. If Paddle fails nothing changes except a recorded sync error.

const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;
const MAX_LIMIT = 10_000_000;
const MAX_PRICE_CENTS = 10_000_000;
export const NOTICE_DAYS = 30;

export type PlanInput = {
  key?: string;
  name: string;
  description?: string;
  monthlyPriceCents?: number;
  yearlyPriceCents?: number;
  trialDays?: number | null;
  status?: PlanStatus;
  sortOrder?: number;
  highlight?: boolean;
  /** The usage limits and `seats` (users per company, 1 to 1000). */
  limits?: Partial<Record<UsageMetric | "seats", number>>;
  /** Marketing bullets on the pricing card. */
  highlights?: string[];
  /** Feature keys (lib/features.ts). Every prerequisite must be in the list; "coming soon" features are refused. */
  features?: string[];
  /** Alias from before the feature registry: apiAccess / ownComposio switch those two features. */
  capabilities?: Partial<Record<Capability, boolean>>;
};

type Snapshot = {
  name: string;
  description: string;
  status: PlanStatus;
  sortOrder: number;
  highlight: boolean;
  trialDays: number | null;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  limits: PlanLimits;
  highlights: string[];
  features: FeatureKey[];
};

const snap = (p: PlanView): Snapshot => ({
  name: p.name,
  description: p.description,
  status: p.status,
  sortOrder: p.sortOrder,
  highlight: p.highlight,
  trialDays: p.trialDays,
  monthlyPriceCents: p.monthlyPriceCents,
  yearlyPriceCents: p.yearlyPriceCents,
  limits: p.limits,
  highlights: p.highlights,
  features: p.features,
});

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** The four feature columns written together: the new pair and the legacy pair kept in step (see prisma/schema.prisma). */
const featureColumns = (s: Pick<Snapshot, "highlights" | "features">) => ({
  highlights: json(s.highlights),
  featureKeys: json(s.features),
  features: json(s.highlights),
  capabilities: json(capabilitiesOf(s.features)),
});

function int(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new AdminError("invalid", `${field} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

/** Validates and merges a (partial) input over the current snapshot. Pure. */
export function mergePlan(base: Snapshot, patch: Partial<PlanInput>, isTrial: boolean): Snapshot {
  const next: Snapshot = { ...base, limits: { ...base.limits }, highlights: [...base.highlights], features: [...base.features] };
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name || name.length > 60) throw new AdminError("invalid", "The name is required (max 60 characters).");
    next.name = name;
  }
  if (patch.description !== undefined) {
    const d = String(patch.description).trim();
    if (d.length > 300) throw new AdminError("invalid", "The description can be at most 300 characters.");
    next.description = d;
  }
  if (patch.status !== undefined) {
    if (!PLAN_STATUSES.includes(patch.status)) throw new AdminError("invalid", "status must be active, hidden or retired.");
    if (isTrial && patch.status !== "active") throw new AdminError("conflict", "The free trial cannot be hidden or retired; new sign-ups start on it.");
    next.status = patch.status;
  }
  if (patch.sortOrder !== undefined) next.sortOrder = int(patch.sortOrder, "The order", -1000, 1000);
  if (patch.highlight !== undefined) next.highlight = patch.highlight === true && !isTrial;
  if (patch.trialDays !== undefined && isTrial) next.trialDays = int(patch.trialDays, "The trial length (days)", 1, 365);
  if (!isTrial) {
    if (patch.monthlyPriceCents !== undefined) next.monthlyPriceCents = int(patch.monthlyPriceCents, "The monthly price", 1, MAX_PRICE_CENTS);
    if (patch.yearlyPriceCents !== undefined) next.yearlyPriceCents = int(patch.yearlyPriceCents, "The yearly price", 1, MAX_PRICE_CENTS);
  } else if (
    (patch.monthlyPriceCents !== undefined && patch.monthlyPriceCents !== 0) ||
    (patch.yearlyPriceCents !== undefined && patch.yearlyPriceCents !== 0)
  ) {
    throw new AdminError("conflict", "The free trial has no price.");
  }
  if (patch.limits !== undefined) {
    for (const [metric, value] of Object.entries(patch.limits)) {
      if (metric === "seats") {
        next.limits.seats = int(value, "Team seats", SEATS_MIN, SEATS_MAX);
        continue;
      }
      if (!(USAGE_METRICS as string[]).includes(metric)) throw new AdminError("invalid", `Unknown limit "${metric}". Use: seats, ${USAGE_METRICS.join(", ")}.`);
      next.limits[metric as UsageMetric] = int(value, `The ${metric} limit`, 0, MAX_LIMIT);
    }
  }
  if (patch.highlights !== undefined) {
    const list = patch.highlights.map((f) => String(f).trim()).filter(Boolean);
    if (list.length > 12) throw new AdminError("invalid", "A plan can list at most 12 highlights.");
    if (list.some((f) => f.length > 120)) throw new AdminError("invalid", "Each highlight can be at most 120 characters.");
    next.highlights = list;
  }
  let features: string[] | null = patch.features !== undefined ? patch.features.map((f) => String(f).trim()).filter(Boolean) : null;
  if (patch.capabilities !== undefined) {
    features ??= [...next.features];
    for (const [cap, value] of Object.entries(patch.capabilities)) {
      if (!(CAPABILITIES as readonly string[]).includes(cap)) throw new AdminError("invalid", `Unknown capability "${cap}".`);
      features = value === true ? [...new Set([...features, cap])] : features.filter((k) => k !== cap);
    }
  }
  if (features !== null) {
    // Prerequisites are not added quietly: the form ticks them itself, and the API is told what is missing.
    const checked = validateFeatureSet(features);
    if (!checked.ok) throw new AdminError("invalid", checked.message);
    next.features = checked.keys;
  }
  return next;
}

// ---- reads ---------------------------------------------------------------------------------------------------------------

export type AdminPlanRow = PlanView & {
  subscribers: number;
  payingSubscribers: number;
  mrrCents: number;
  paddleReady: boolean;
  latestChange: { id: string; direction: string; status: string; subscribers: number; notifiedCount: number; appliedCount: number; failedCount: number; createdAt: Date } | null;
};

export async function listAdminPlans(): Promise<{ plans: AdminPlanRow[]; paddleConnected: boolean }> {
  const plans = await getPlans({ force: true });
  const groups = await prisma.subscription.groupBy({ by: ["plan", "interval", "status"], _count: { _all: true } });
  const rows: AdminPlanRow[] = [];
  for (const plan of plans) {
    const mine = groups.filter((g) => g.plan === plan.key);
    const live = mine.filter((g) => ["ACTIVE", "PAST_DUE", "TRIALING"].includes(g.status));
    const paying = plan.isTrial ? [] : mine.filter((g) => g.status === "ACTIVE" || g.status === "PAST_DUE");
    const mrr = paying.reduce((s, g) => s + g._count._all * (g.interval === "YEAR" ? plan.yearlyPriceCents / 12 : plan.monthlyPriceCents), 0);
    const latest = await prisma.planPriceChange.findFirst({ where: { planKey: plan.key }, orderBy: { createdAt: "desc" } });
    rows.push({
      ...plan,
      subscribers: live.reduce((s, g) => s + g._count._all, 0),
      payingSubscribers: paying.reduce((s, g) => s + g._count._all, 0),
      mrrCents: Math.round(mrr),
      paddleReady: Boolean(currentPriceId("PADDLE", plan, "MONTH") && currentPriceId("PADDLE", plan, "YEAR")),
      latestChange: latest
        ? { id: latest.id, direction: latest.direction, status: latest.status, subscribers: latest.subscribers, notifiedCount: latest.notifiedCount, appliedCount: latest.appliedCount, failedCount: latest.failedCount, createdAt: latest.createdAt }
        : null,
    });
  }
  return { plans: rows, paddleConnected: paddleConnected() };
}

async function loadPlan(key: string): Promise<PlanView> {
  const row = await prisma.planDefinition.findUnique({ where: { key } });
  if (!row) throw new AdminError("not_found", "No plan with that key.");
  return viewOf(row as Record<string, unknown>);
}

export async function getAdminPlan(key: string) {
  const plan = await loadPlan(key);
  const changes = await prisma.planPriceChange.findMany({ where: { planKey: key }, orderBy: { createdAt: "desc" }, take: 10 });
  const failedItems = await prisma.planPriceChangeItem.findMany({ where: { change: { planKey: key }, status: "failed" }, take: 20, select: { id: true, changeId: true, userId: true, error: true } });
  // Which old prices somebody still pays or is waiting to leave (for the "still used" badge).
  const priceUse: Record<string, number> = {};
  for (const price of plan.paddlePrices) {
    if (price.id === plan.paddleMonthlyPriceId || price.id === plan.paddleYearlyPriceId) continue;
    const [subs, items] = await Promise.all([
      prisma.subscription.count({ where: { providerPriceId: price.id } }),
      prisma.planPriceChangeItem.count({ where: { oldPriceId: price.id, status: { in: OPEN_ITEM_STATUSES } } }),
    ]);
    priceUse[price.id] = subs + items;
  }
  const struggling = await prisma.planPriceChangeItem.count({ where: { change: { planKey: key }, status: "pending", attempts: { gt: 0 } } });
  return { plan, changes, failedItems, priceUse, struggling, paddleConnected: paddleConnected() };
}

// ---- price change preview -------------------------------------------------------------------------------------------------

export type PriceChangePreview = {
  changed: boolean;
  direction: "increase" | "decrease" | "mixed" | "none";
  affected: number;
  lines: string[];
  noticeDays: number;
};

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

async function liveSubscribers(planKey: string) {
  return prisma.subscription.findMany({
    where: { plan: planKey, provider: "PADDLE", providerSubscriptionId: { not: null }, status: { in: ["ACTIVE", "PAST_DUE"] }, cancelAtPeriodEnd: false },
    select: { userId: true, providerSubscriptionId: true, providerPriceId: true, interval: true },
  });
}

/** What a price change would do, in plain words: "3 clients will move from $49 to $59 on their next renewal after a 30-day notice". */
export async function previewPriceChange(key: string, next: { monthlyPriceCents: number; yearlyPriceCents: number }): Promise<PriceChangePreview> {
  const plan = await loadPlan(key);
  const subs = await liveSubscribers(key);
  const lines: string[] = [];
  let affected = 0;
  let up = 0;
  let down = 0;
  for (const interval of ["MONTH", "YEAR"] as const) {
    const to = interval === "YEAR" ? next.yearlyPriceCents : next.monthlyPriceCents;
    const from = interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
    if (to === from) continue;
    const per = interval === "YEAR" ? "year" : "month";
    // Subscribers still on an older price count by what they pay now.
    const groups = new Map<number, number>();
    for (const s of subs.filter((x) => x.interval === interval)) {
      const paying = subscriberPriceCents(plan, s.providerPriceId, interval);
      if (paying !== to) groups.set(paying, (groups.get(paying) ?? 0) + 1);
    }
    for (const [paying, count] of groups) {
      affected += count;
      const clients = `${count} ${count === 1 ? "client" : "clients"}`;
      if (to > paying) {
        up += count;
        lines.push(`${clients} will move from ${dollars(paying)} to ${dollars(to)} per ${per} on their next renewal after a ${NOTICE_DAYS}-day notice. Each gets an email first; a renewal less than ${NOTICE_DAYS} days away waits for the one after.`);
      } else {
        down += count;
        lines.push(`${clients} will move from ${dollars(paying)} to ${dollars(to)} per ${per} at their next renewal (no waiting).`);
      }
    }
    if (groups.size === 0) lines.push(`New ${per}ly sign-ups pay ${dollars(to)} (was ${dollars(from)}); no existing client is affected.`);
    else lines.push(`New ${per}ly sign-ups pay ${dollars(to)} from now on.`);
  }
  const changed = next.monthlyPriceCents !== plan.monthlyPriceCents || next.yearlyPriceCents !== plan.yearlyPriceCents;
  const direction = !changed ? "none" : up > 0 && down > 0 ? "mixed" : down > 0 && up === 0 ? "decrease" : up > 0 ? "increase" : next.monthlyPriceCents + next.yearlyPriceCents >= plan.monthlyPriceCents + plan.yearlyPriceCents ? "increase" : "decrease";
  return { changed, direction, affected, lines, noticeDays: NOTICE_DAYS };
}

// ---- Paddle ----------------------------------------------------------------------------------------------------------------

async function recordSyncFailure(key: string, message: string) {
  await prisma.planDefinition.update({ where: { key }, data: { syncState: "failed", syncError: message.slice(0, 500) } }).catch(() => undefined);
  clearPlanCache();
}

/**
 * Creates the missing parts of a plan in Paddle: the product, then a monthly and a yearly price. Each part is saved as soon as
 * Paddle returns it, so a failure half-way leaves a plan that knows exactly what exists, and "Retry" only creates the rest.
 * Plans that already have price ids in the environment (the original three) adopt them instead of creating new ones.
 */
export async function syncPlanToPaddle(ctx: AdminContext, key: string): Promise<{ plan: PlanView; created: string[] }> {
  if (!paddleConnected()) throw new AdminError("unavailable", "Paddle is not connected (PADDLE_API_KEY is not set), so there is nothing to sync yet.");
  let plan = await loadPlan(key);
  if (plan.isTrial) throw new AdminError("conflict", "The free trial is not sold, so it has nothing in Paddle.");
  const created: string[] = [];
  const history = [...plan.paddlePrices];
  try {
    let productId = plan.paddleProductId;
    if (!productId) {
      productId = await createPaddleProduct({ name: plan.name, description: plan.description, planKey: plan.key });
      created.push(`product ${productId}`);
      await prisma.planDefinition.update({ where: { key }, data: { paddleProductId: productId } });
    }
    for (const interval of ["MONTH", "YEAR"] as const) {
      const have = currentPriceId("PADDLE", plan, interval);
      const field = interval === "YEAR" ? "paddleYearlyPriceId" : "paddleMonthlyPriceId";
      const amountCents = interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
      let id = have;
      if (!id) {
        id = await createPaddlePrice({ productId, planKey: plan.key, planName: plan.name, interval, amountCents, currency: plan.currency });
        created.push(`${interval.toLowerCase()} price ${id}`);
      }
      if (!history.some((p) => p.id === id)) history.push({ id, interval, amountCents, createdAt: new Date().toISOString() });
      await prisma.planDefinition.update({ where: { key }, data: { [field]: id, paddlePrices: json(history) } });
      plan = { ...plan, [field]: id } as PlanView;
    }
    const before = plan;
    await prisma.$transaction(async (tx) => {
      await tx.planDefinition.update({ where: { key }, data: { syncState: "synced", syncError: null } });
      await writeAudit(tx, ctx, "sync_plan_paddle", `plan:${key}`, { syncState: before.syncState, syncError: before.syncError }, { syncState: "synced", created });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError(error, { source: "admin.plan-sync", plan: key });
    await recordSyncFailure(key, message);
    await writeAudit(prisma, ctx, "sync_plan_paddle_failed", `plan:${key}`, null, { error: message.slice(0, 300), created }).catch(() => undefined);
    throw new AdminError("unavailable", `Paddle did not accept it: ${message}. The plan is saved as a draft; use "Sync with Paddle" to retry.`);
  }
  clearPlanCache();
  return { plan: await loadPlan(key), created };
}

// ---- create ----------------------------------------------------------------------------------------------------------------

export async function createPlan(ctx: AdminContext, input: PlanInput): Promise<{ plan: PlanView; paddle: "synced" | "not_connected" | "failed"; paddleError?: string }> {
  const key = (input.key ?? "").trim();
  if (!KEY_RE.test(key)) throw new AdminError("invalid", "The key is a short identifier: 2-32 letters, digits, - or _, starting with a letter.");
  const clash = (await prisma.planDefinition.findMany({ select: { key: true } })).some((p) => p.key.toLowerCase() === key.toLowerCase());
  if (clash) throw new AdminError("conflict", "A plan with that key already exists.");
  const blank: Snapshot = {
    name: "",
    description: "",
    status: "hidden",
    sortOrder: 100,
    highlight: false,
    trialDays: null,
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    limits: { text: 0, image: 0, videoSeconds: 0, voiceCharacters: 0, chat: 0, seats: 1 },
    highlights: [],
    features: [],
  };
  const wanted = mergePlan(blank, { ...input, trialDays: undefined }, false);
  if (!wanted.name) throw new AdminError("invalid", "The name is required.");
  if (wanted.monthlyPriceCents < 1 || wanted.yearlyPriceCents < 1) throw new AdminError("invalid", "Set a monthly and a yearly price.");
  const connected = paddleConnected();
  // A plan is only offered for sale once Paddle has its prices; until then it is a hidden draft (also without Paddle).
  const startStatus: PlanStatus = wanted.status === "active" ? "hidden" : wanted.status;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.planDefinition.create({
      data: {
        key,
        name: wanted.name,
        description: wanted.description,
        isTrial: false,
        status: startStatus,
        sortOrder: wanted.sortOrder,
        highlight: wanted.highlight,
        monthlyPriceCents: wanted.monthlyPriceCents,
        yearlyPriceCents: wanted.yearlyPriceCents,
        currency: "USD",
        limits: json(wanted.limits),
        ...featureColumns(wanted),
        paddlePrices: json([]),
        syncState: "not_synced",
      },
    });
    await writeAudit(tx, ctx, "create_plan", `plan:${key}`, null, { ...wanted, status: wanted.status });
    return viewOf(row as Record<string, unknown>);
  });
  clearPlanCache();
  if (!connected) return { plan: created, paddle: "not_connected" };
  try {
    await syncPlanToPaddle(ctx, key);
  } catch (error) {
    return { plan: await loadPlan(key), paddle: "failed", paddleError: error instanceof AdminError ? error.message : "Paddle sync failed." };
  }
  if (wanted.status === "active") {
    await prisma.$transaction(async (tx) => {
      await tx.planDefinition.update({ where: { key }, data: { status: "active" } });
      await writeAudit(tx, ctx, "update_plan", `plan:${key}`, { status: "hidden" }, { status: "active" });
    });
    clearPlanCache();
  }
  return { plan: await loadPlan(key), paddle: "synced" };
}

// ---- update ----------------------------------------------------------------------------------------------------------------

function diffSnap(a: Snapshot, b: Snapshot) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of Object.keys(a) as (keyof Snapshot)[]) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      before[k] = a[k];
      after[k] = b[k];
    }
  }
  return { before, after };
}

export type UpdateResult = {
  plan: PlanView;
  changed: string[];
  priceChange: { id: string; direction: string; subscribers: number } | null;
  warnings: string[];
};

/**
 * Edits a plan. A price change creates new Paddle prices first (nothing is written if that fails), then in one transaction
 * updates the plan, schedules every existing subscriber's move and writes the audit row. `confirmPriceChange` must be true
 * for a price change (the console shows the preview first). Retiring or hiding a plan keeps its subscribers on it.
 */
export async function updatePlan(ctx: AdminContext, key: string, patch: Partial<PlanInput>, opts: { confirmPriceChange?: boolean; expectedVersion?: string } = {}): Promise<UpdateResult> {
  const plan = await loadPlan(key);
  // The form carries the version it was loaded with; a different one means somebody else saved in between.
  if (opts.expectedVersion !== undefined && plan.updatedAt && plan.updatedAt.toISOString() !== opts.expectedVersion) {
    throw new AdminError("conflict", "This plan changed since you opened it. Reload the page and make your change again.");
  }
  const before = snap(plan);
  const next = mergePlan(before, patch, plan.isTrial);
  const { before: dBefore, after: dAfter } = diffSnap(before, next);
  const changed = Object.keys(dAfter);
  if (changed.length === 0) return { plan, changed, priceChange: null, warnings: [] };
  const priceChanged = "monthlyPriceCents" in dAfter || "yearlyPriceCents" in dAfter;
  const warnings: string[] = [];

  const connected = paddleConnected();
  const hasPaddleIds = Boolean(currentPriceId("PADDLE", plan, "MONTH") || currentPriceId("PADDLE", plan, "YEAR"));
  // Putting a plan on sale needs its Paddle prices. Other edits of a plan that is already active are not blocked by this.
  if (next.status === "active" && plan.status !== "active" && !plan.isTrial && !(currentPriceId("PADDLE", plan, "MONTH") && currentPriceId("PADDLE", plan, "YEAR"))) {
    throw new AdminError("conflict", connected ? "This plan has no Paddle prices yet. Use \"Sync with Paddle\" first, then make it active." : "This plan has no Paddle prices yet and Paddle is not connected, so it cannot go on sale. It stays a hidden draft.");
  }

  const created: PaddlePriceRecord[] = [];
  let productId = plan.paddleProductId;
  const history = [...plan.paddlePrices];
  let monthlyId = plan.paddleMonthlyPriceId;
  let yearlyId = plan.paddleYearlyPriceId;

  if (priceChanged) {
    if (!opts.confirmPriceChange) {
      const preview = await previewPriceChange(key, next);
      throw new AdminError("confirm_required", `A price change needs your confirmation. ${preview.lines.join(" ")}`);
    }
    if (!connected && hasPaddleIds) {
      throw new AdminError("unavailable", "Paddle is not connected, so a price change cannot be made: the price clients are charged would differ from the one shown. Set PADDLE_API_KEY first.");
    }
    if (connected) {
      try {
        if (!productId) {
          productId = await createPaddleProduct({ name: next.name, description: next.description, planKey: key });
        }
        // Old env-only prices become part of the history before the new ones replace them, so old subscriptions still map here.
        for (const interval of ["MONTH", "YEAR"] as const) {
          const oldId = currentPriceId("PADDLE", plan, interval);
          if (oldId && !history.some((p) => p.id === oldId)) {
            history.push({ id: oldId, interval, amountCents: interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents, createdAt: new Date(0).toISOString() });
          }
        }
        for (const interval of ["MONTH", "YEAR"] as const) {
          const to = interval === "YEAR" ? next.yearlyPriceCents : next.monthlyPriceCents;
          const from = interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
          const have = interval === "YEAR" ? yearlyId : monthlyId;
          if (to === from && have) continue;
          const id = await createPaddlePrice({ productId, planKey: key, planName: next.name, interval, amountCents: to, currency: plan.currency });
          const record: PaddlePriceRecord = { id, interval, amountCents: to, createdAt: new Date().toISOString() };
          created.push(record);
          history.push(record);
          if (interval === "YEAR") yearlyId = id;
          else monthlyId = id;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logError(error, { source: "admin.plan-price", plan: key });
        // Nothing was written to the plan. Prices already created in Paddle are archived so none are left half-used.
        for (const c of created) await archivePaddlePrice(c.id).catch(() => undefined);
        await recordSyncFailure(key, `Price change failed: ${message}`);
        await writeAudit(prisma, ctx, "update_plan_failed", `plan:${key}`, dBefore, { attempted: dAfter, error: message.slice(0, 300) }).catch(() => undefined);
        throw new AdminError("unavailable", `Paddle did not accept the new price: ${message}. Nothing was changed.`);
      }
    }
  }

  let priceChange: UpdateResult["priceChange"] = null;
  let oldChangeIds: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      // Guarded on the version we read, so two admins editing at once cannot silently overwrite each other.
      const data: Prisma.PlanDefinitionUncheckedUpdateManyInput = {
        name: next.name,
        description: next.description,
        status: next.status,
        sortOrder: next.sortOrder,
        highlight: next.highlight,
        trialDays: next.trialDays,
        monthlyPriceCents: next.monthlyPriceCents,
        yearlyPriceCents: next.yearlyPriceCents,
        limits: json(next.limits),
        ...featureColumns(next),
        ...(priceChanged && connected
          ? { paddleProductId: productId, paddleMonthlyPriceId: monthlyId, paddleYearlyPriceId: yearlyId, paddlePrices: json(history), syncState: "synced", syncError: null }
          : {}),
      };
      const { count } = await tx.planDefinition.updateMany({ where: { key, ...(plan.updatedAt ? { updatedAt: plan.updatedAt } : {}) }, data });
      if (count !== 1) throw new AdminError("conflict", "The plan changed while you were editing it. Reload and try again.");

      let changeId: string | null = null;
      if (priceChanged) {
        const subs = await tx.subscription.findMany({
          where: { plan: key, provider: "PADDLE", providerSubscriptionId: { not: null }, status: { in: ["ACTIVE", "PAST_DUE"] }, cancelAtPeriodEnd: false },
          select: { userId: true, providerSubscriptionId: true, providerPriceId: true, interval: true },
        });
        const oldView: PlanView = { ...plan, paddlePrices: history };
        const items = subs.flatMap((s) => {
          if (!s.providerSubscriptionId || !s.providerPriceId) return [];
          const to = s.interval === "YEAR" ? next.yearlyPriceCents : next.monthlyPriceCents;
          const paying = subscriberPriceCents(oldView, s.providerPriceId, s.interval);
          const newPriceId = s.interval === "YEAR" ? yearlyId : monthlyId;
          if (paying === to || !newPriceId || newPriceId === s.providerPriceId) return [];
          return [{ userId: s.userId, providerSubscriptionId: s.providerSubscriptionId, interval: s.interval as BillingInterval, oldPriceId: s.providerPriceId, newPriceId, oldCents: paying, newCents: to }];
        });
        const up = items.filter((i) => i.newCents > i.oldCents).length;
        const down = items.length - up;
        const planUp = next.monthlyPriceCents + next.yearlyPriceCents > plan.monthlyPriceCents + plan.yearlyPriceCents;
        const direction = items.length === 0 ? (planUp ? "increase" : "decrease") : up > 0 && down > 0 ? "mixed" : up > 0 ? "increase" : "decrease";

        // Moves already waiting for this plan. One whose target price is unchanged (the other interval's price was edited)
        // keeps its notice and its date: it moves into the new change as it is. Only moves whose target changed are replaced.
        const waiting = await tx.planPriceChange.findMany({ where: { planKey: key, status: "scheduled" }, select: { id: true } });
        const open = await tx.planPriceChangeItem.findMany({ where: { status: { in: OPEN_ITEM_STATUSES }, changeId: { in: waiting.map((w) => w.id) } } });
        const carry = new Map<string, (typeof open)[number]>();
        for (const o of open) {
          const same = items.find((i) => i.userId === o.userId && i.newPriceId === o.newPriceId && i.oldPriceId === o.oldPriceId);
          if (same) carry.set(o.userId, o);
        }
        const replaced = open.filter((o) => carry.get(o.userId) !== o);
        if (replaced.length > 0) await tx.planPriceChangeItem.updateMany({ where: { id: { in: replaced.map((o) => o.id) } }, data: { status: "skipped", error: "Replaced by a newer price change." } });
        for (const w of waiting) await tx.planPriceChange.update({ where: { id: w.id }, data: { status: "cancelled", completedAt: new Date() } });
        oldChangeIds = waiting.map((w) => w.id);

        const change = await tx.planPriceChange.create({
          data: {
            planKey: key,
            direction,
            oldMonthlyCents: plan.monthlyPriceCents,
            newMonthlyCents: next.monthlyPriceCents,
            oldYearlyCents: plan.yearlyPriceCents,
            newYearlyCents: next.yearlyPriceCents,
            oldMonthlyPriceId: plan.paddleMonthlyPriceId,
            oldYearlyPriceId: plan.paddleYearlyPriceId,
            newMonthlyPriceId: monthlyId,
            newYearlyPriceId: yearlyId,
            status: items.length === 0 ? "completed" : "scheduled",
            completedAt: items.length === 0 ? new Date() : null,
            subscribers: items.length,
            createdBy: ctx.actor,
          },
        });
        changeId = change.id;
        const fresh = items.filter((i) => !carry.has(i.userId));
        if (fresh.length > 0) await tx.planPriceChangeItem.createMany({ data: fresh.map((i) => ({ ...i, changeId: change.id })) });
        for (const o of carry.values()) await tx.planPriceChangeItem.update({ where: { id: o.id }, data: { changeId: change.id } });
        priceChange = { id: change.id, direction, subscribers: items.length };
      }
      await writeAudit(tx, ctx, "update_plan", `plan:${key}`, dBefore, { ...dAfter, ...(changeId ? { priceChangeId: changeId, subscribersToMove: priceChange?.subscribers } : {}) });
    });
  } catch (error) {
    // The plan was not updated: archive the prices created for it and record why.
    for (const c of created) await archivePaddlePrice(c.id).catch(() => undefined);
    if (created.length > 0) await recordSyncFailure(key, `Price change failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
  clearPlanCache();
  const made = priceChange as UpdateResult["priceChange"];
  if (made) for (const id of [made.id, ...oldChangeIds]) await refreshChange(id, new Date()).catch(() => undefined);

  if ((("name" in dAfter) || ("description" in dAfter)) && productId && connected && !priceChanged) {
    try {
      await updatePaddleProduct(productId, { name: next.name, description: next.description });
    } catch (error) {
      await logError(error, { source: "admin.plan-product", plan: key });
      warnings.push("The plan was saved, but the product name in Paddle could not be updated.");
    }
  }
  return { plan: await loadPlan(key), changed, priceChange, warnings };
}

/** Stops a price change that is still waiting: nobody else is notified or moved. Clients already moved stay moved. */
export async function cancelPriceChange(ctx: AdminContext, id: string) {
  const change = await prisma.planPriceChange.findUnique({ where: { id } });
  if (!change) throw new AdminError("not_found", "No price change with that id.");
  if (change.status !== "scheduled") throw new AdminError("conflict", `This price change is already ${change.status}.`);
  await prisma.$transaction(async (tx) => {
    await tx.planPriceChangeItem.updateMany({ where: { changeId: id, status: { in: OPEN_ITEM_STATUSES } }, data: { status: "skipped", error: "Cancelled by an admin." } });
    await tx.planPriceChange.update({ where: { id }, data: { status: "cancelled", completedAt: new Date() } });
    await writeAudit(tx, ctx, "cancel_price_change", `plan:${change.planKey}`, { status: "scheduled", changeId: id }, { status: "cancelled" });
  });
  await refreshChange(id, new Date()).catch(() => undefined);
  return { id, status: "cancelled" };
}

/** Puts the clients of a price change that failed (Paddle refused, or a notice whose sending was cut short) back in the queue. */
export async function retryFailedPriceItems(ctx: AdminContext, id: string) {
  const change = await prisma.planPriceChange.findUnique({ where: { id } });
  if (!change) throw new AdminError("not_found", "No price change with that id.");
  if (change.status === "cancelled") throw new AdminError("conflict", "This price change was stopped.");
  // A client who already has their notice goes back to waiting for the swap; one whose notice never went out is notified again.
  const swaps = await prisma.planPriceChangeItem.updateMany({ where: { changeId: id, status: "failed", noticeSentAt: { not: null } }, data: { status: "notified", attempts: 0, error: null } });
  const notices = await prisma.planPriceChangeItem.updateMany({ where: { changeId: id, status: "failed", noticeSentAt: null }, data: { status: "pending", effectiveAt: null, attempts: 0, error: null } });
  const count = swaps.count + notices.count;
  if (count === 0) throw new AdminError("conflict", "Nobody is waiting for a retry in this price change.");
  await prisma.$transaction(async (tx) => {
    await tx.planPriceChange.update({ where: { id }, data: { status: "scheduled", completedAt: null } });
    await writeAudit(tx, ctx, "retry_price_change", `plan:${change.planKey}`, { changeId: id, failed: count }, { changeId: id, requeued: count });
  });
  await refreshChange(id, new Date()).catch(() => undefined);
  return { id, requeued: count };
}

// ---- limits only (the update_plan_limits tool) -----------------------------------------------------------------------------------

/** Sets a plan's limits. A metric set to null goes back to the value the plan was seeded with (0 for plans created later). */
export async function setPlanLimits(ctx: AdminContext, input: { plan: string; limits: Partial<Record<UsageMetric | "seats", number | null>> }) {
  const plan = await loadPlan(input.plan);
  const entries = Object.entries(input.limits ?? {});
  if (entries.length === 0) throw new AdminError("invalid", "limits must set at least one metric.");
  const patch: Partial<Record<UsageMetric | "seats", number>> = {};
  for (const [metric, value] of entries) {
    if (metric === "seats") {
      if (value === null) patch.seats = SEED_PLANS[plan.key]?.limits.seats ?? SEATS_MIN;
      else if (!Number.isInteger(value) || value < SEATS_MIN || value > SEATS_MAX) throw new AdminError("invalid", `seats must be a whole number from ${SEATS_MIN} to ${SEATS_MAX}, or null to reset.`);
      else patch.seats = value;
      continue;
    }
    if (!(USAGE_METRICS as string[]).includes(metric)) throw new AdminError("invalid", `Unknown metric "${metric}". Use: ${USAGE_METRICS.join(", ")}.`);
    if (value === null) patch[metric as UsageMetric] = SEED_PLANS[plan.key]?.limits[metric as UsageMetric] ?? 0;
    else if (!Number.isInteger(value) || value < 0 || value > MAX_LIMIT) throw new AdminError("invalid", `${metric} must be a whole number from 0 to 10000000, or null to reset.`);
    else patch[metric as UsageMetric] = value;
  }
  const limits = { ...plan.limits, ...patch };
  await prisma.$transaction(async (tx) => {
    await tx.planDefinition.update({ where: { key: plan.key }, data: { limits: json(limits) } });
    await writeAudit(tx, ctx, "update_plan_limits", `plan:${plan.key}`, plan.limits, limits);
  });
  clearPlanCache();
  return { plan: plan.key, effective: limits };
}

export { TRIAL_PLAN_KEY };
