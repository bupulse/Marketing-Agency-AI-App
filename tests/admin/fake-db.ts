/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";
import { SEED_PLANS } from "@/lib/plans";

// A tiny in-memory stand-in for Prisma: just the calls lib/admin and lib/usage make. Equality filters plus
// not/lt/lte/gt/gte, unique-key checks that raise P2002 like the real database.

export type Row = Record<string, any>;
type Where = Record<string, any> | undefined;

let currentDb: { planPriceChange: { rows: Row[] } } | null = null;

function match(row: Row, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Where[]).some((w) => match(row, w));
    if (key === "month_category") return row.month === cond.month && row.category === cond.category;
    // Relation filter on a plan price change item: look the change up by its id.
    if (key === "change") {
      const change = currentDb?.planPriceChange.rows.find((r) => r.id === row.changeId);
      return !!change && match(change, cond as Where);
    }
    if (key === "AND") return (cond as Where[]).every((w) => match(row, w));
    const value = row[key] === undefined ? null : row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Record<string, any>;
      if ("equals" in c) {
        const same = typeof value === "string" && typeof c.equals === "string" && c.mode === "insensitive" ? value.toLowerCase() === c.equals.toLowerCase() : value === c.equals;
        if (!same) return false;
      }
      if ("not" in c && value === c.not) return false;
      if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
      if ("lt" in c && !(value < c.lt)) return false;
      if ("lte" in c && !(value <= c.lte)) return false;
      if ("gt" in c && !(value > c.gt)) return false;
      if ("gte" in c && !(value >= c.gte)) return false;
      if ("has" in c && !(value ?? []).includes(c.has)) return false;
      return true;
    }
    return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond;
  });
}

function table(rows: Row[], opts: { pk: string; unique?: string[]; uniqueCombo?: string[]; defaults?: () => Row }) {
  const uniqueKeys = [opts.pk, ...(opts.unique ?? [])];
  let seq = 0;
  const copy = (r: Row | undefined | null) => (r ? { ...r } : null);
  const find = (where: Record<string, any>) => rows.find((r) => match(r, where)) ?? null;
  const api = {
    rows,
    findUnique: vi.fn(async ({ where }: { where: Record<string, any> }) => copy(find(where))),
    findFirst: vi.fn(async ({ where }: { where?: Where } = {}) => copy(rows.find((r) => match(r, where)))),
    findMany: vi.fn(async ({ where, take }: { where?: Where; take?: number } = {}) => rows.filter((r) => match(r, where)).slice(0, take).map((r) => ({ ...r }))),
    count: vi.fn(async ({ where }: { where?: Where } = {}) => rows.filter((r) => match(r, where)).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      for (const k of uniqueKeys) {
        if (data[k] !== undefined && rows.some((r) => r[k] === data[k])) throw Object.assign(new Error(`Unique constraint failed on ${k}`), { code: "P2002" });
      }
      const row: Row = { ...(opts.defaults?.() ?? {}), createdAt: new Date(), ...data };
      if (row[opts.pk] === undefined) row[opts.pk] = `${opts.pk}_${++seq}`;
      rows.push(row);
      return row;
    }),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
      if (data.length > 0 && !("periodStart" in data[0])) {
        let count = 0;
        for (const d of data) {
          // A composite unique key (RenewalNotice): with skipDuplicates the row is skipped, like ON CONFLICT DO NOTHING.
          const combo = opts.uniqueCombo;
          if (combo && rows.some((r) => combo.every((k) => (r[k] instanceof Date ? r[k].getTime() === d[k]?.getTime() : r[k] === d[k])))) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error(`Unique constraint failed on ${combo.join(",")}`), { code: "P2002" });
          }
          rows.push({ ...(opts.defaults?.() ?? {}), createdAt: new Date(), ...d, [opts.pk]: d[opts.pk] ?? `${opts.pk}_${++seq}` });
          count++;
        }
        return { count };
      }
      for (const d of data) if (!rows.some((r) => r.userId === d.userId && r.periodStart?.getTime() === d.periodStart?.getTime())) rows.push({ textGenerations: 0, imageGenerations: 0, videoSeconds: 0, voiceCharacters: 0, chatMessages: 0, ...d });
      return { count: data.length };
    }),
    updateMany: vi.fn(async ({ where, data }: { where?: Where; data: Row }) => {
      const hit = rows.filter((r) => match(r, where));
      for (const r of hit) for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in v ? (r[k] ?? 0) + v.increment : v;
      return { count: hit.length };
    }),
    update: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Row }) => {
      const row = find(where);
      if (!row) throw new Error("Record not found");
      Object.assign(row, data);
      return row;
    }),
    upsert: vi.fn(async ({ where, create, update }: { where: Record<string, any>; create: Row; update: Row }) => {
      const row = find(where);
      if (row) return Object.assign(row, update);
      return api.create({ data: create });
    }),
    deleteMany: vi.fn(async ({ where }: { where?: Where } = {}) => {
      const keep = rows.filter((r) => !match(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
    groupBy: vi.fn(async () => []),
    aggregate: vi.fn(async ({ where }: { where?: Where } = {}) => {
      const hit = rows.filter((r) => match(r, where));
      return { _sum: { costUsd: hit.reduce((n, r) => n + Number(r.costUsd ?? 0), 0) }, _count: { _all: hit.length } };
    }),
  };
  return api;
}

export function seedPlanRows(): Row[] {
  return Object.entries(SEED_PLANS).map(([key, c]) => ({
    id: `plan_${key.toLowerCase()}`,
    key,
    name: c.name,
    description: c.description,
    isTrial: c.isTrial,
    trialDays: c.trialDays,
    status: "active",
    sortOrder: c.sortOrder,
    highlight: c.highlight,
    monthlyPriceCents: c.priceUsdMonthly * 100,
    yearlyPriceCents: c.priceUsdYearly * 100,
    currency: "USD",
    limits: { ...c.limits },
    features: [...c.features],
    capabilities: { ...c.capabilities },
    paddleProductId: null,
    paddleMonthlyPriceId: null,
    paddleYearlyPriceId: null,
    paddlePrices: [],
    syncState: "not_synced",
    syncError: null,
    createdAt: new Date("2026-10-09T00:00:00Z"),
    updatedAt: new Date("2026-10-09T00:00:00Z"),
  }));
}

export function createFakeDb() {
  const db = {
    user: table([], { pk: "id", unique: ["email"] }),
    subscription: table([], { pk: "id", unique: ["userId"] }),
    business: table([], { pk: "id" }),
    post: table([], { pk: "id" }),
    lead: table([], { pk: "id" }),
    errorLog: table([], { pk: "id" }),
    usageRecord: table([], { pk: "id" }),
    auditLog: table([], { pk: "id" }),
    adminApproval: table([], { pk: "id", unique: ["idempotencyKey"], defaults: () => ({ status: "pending", result: null, decidedBy: null, decidedAt: null }) }),
    adminApiKey: table([], { pk: "id", unique: ["hash"] }),
    featureFlag: table([], { pk: "key" }),
    announcement: table([], { pk: "id" }),
    aiCall: table([], { pk: "id" }),
    billingEvent: table([], { pk: "id" }),
    mediaAsset: table([], { pk: "id" }),
    canvaConnection: table([], { pk: "id" }),
    cloudflareConnection: table([], { pk: "id" }),
    storeConnection: table([], { pk: "id" }),
    serviceUsage: table([], { pk: "service" }),
    serviceSwitch: table([], { pk: "service" }),
    serviceCheck: table([], { pk: "service" }),
    adminSetting: table([], { pk: "key" }),
    monthlyCost: table([], { pk: "id" }),
    // The three plans the migration seeds, exactly (so limits, trial length and capabilities behave as in production).
    planDefinition: table(seedPlanRows(), { pk: "key", unique: ["key"] }),
    planPriceChange: table([], { pk: "id", defaults: () => ({ status: "scheduled", notifiedCount: 0, appliedCount: 0, failedCount: 0, completedAt: null }) }),
    planPriceChangeItem: table([], { pk: "id", defaults: () => ({ status: "pending", noticeSentAt: null, effectiveAt: null, appliedAt: null, error: null, updatedAt: new Date() }) }),
    // Manual Mobile Money payments (lib/billing/momo.ts) and their renewal reminders.
    manualPayment: table([], { pk: "id", unique: ["reference"], defaults: () => ({ currency: "RWF", status: "pending", payerPhone: null, network: null, transactionId: null, rejectReason: null, submittedAt: null, decidedAt: null, decidedBy: null, periodStart: null, periodEnd: null, updatedAt: new Date() }) }),
    renewalNotice: table([], { pk: "id", uniqueCombo: ["userId", "periodEnd", "kind"], defaults: () => ({ sentAt: new Date() }) }),
    analyticsEvent: table([], { pk: "id" }),
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ locked: true }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  currentDb = db as never;
  return db;
}
export type FakeDb = ReturnType<typeof createFakeDb>;
