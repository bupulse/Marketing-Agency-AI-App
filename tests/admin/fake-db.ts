/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";
import { SEED_PLANS } from "@/lib/plans";

// A tiny in-memory stand-in for Prisma: just the calls lib/admin and lib/usage make. Equality filters plus
// not/lt/lte/gt/gte, unique-key checks that raise P2002 like the real database.

export type Row = Record<string, any>;
type Where = Record<string, any> | undefined;

let currentDb: { planPriceChange: { rows: Row[] }; business: { rows: Row[] }; user: { rows: Row[] } } | null = null;

/**
 * The two relations the server code reads through `select` / `include`: a row's business (by businessId) and its
 * account user (by userId), looked up in the other tables when the test did not attach them by hand. Nested selects
 * are served by whatever the related row carries (tests attach `user.subscription`, `business.user` as needed).
 */
function attach(row: Row | null, args?: { select?: Record<string, any>; include?: Record<string, any> }): Row | null {
  if (!row || !currentDb) return row;
  const rel = args?.select ?? args?.include;
  if (!rel) return row;
  if (rel.business && row.business === undefined && row.businessId !== undefined) row.business = currentDb.business.rows.find((b) => b.id === row.businessId) ?? null;
  if (rel.user && row.user === undefined && row.userId !== undefined) row.user = currentDb.user.rows.find((u) => u.id === row.userId) ?? null;
  // `_count: { select: { businesses: true } }` on an industry: how many Business rows point at it.
  if (rel._count?.select?.businesses && row._count === undefined) row._count = { businesses: currentDb.business.rows.filter((b) => b.industryId === row.id).length };
  return row;
}

function match(row: Row, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Where[]).some((w) => match(row, w));
    if (key === "month_category") return row.month === cond.month && row.category === cond.category;
    if (key === "provider_eventId") return row.provider === cond.provider && row.eventId === cond.eventId;
    if (key === "planKey_regionKey") return row.planKey === cond.planKey && row.regionKey === cond.regionKey;
    if (key === "addonKey_regionKey") return row.addonKey === cond.addonKey && row.regionKey === cond.regionKey;
    // Relation filter on a business: its account user's subscription (lib/demo and lib/admin/demos).
    if (key === "business" && cond && typeof cond === "object") return !!row.business && match(row.business, cond as Where);
    if (key === "user" && cond && typeof cond === "object") return !!row.user && match(row.user, cond as Where);
    if (key === "subscription" && cond && typeof cond === "object") return !!row.subscription && match(row.subscription, cond as Where);
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
      if ("contains" in c) {
        if (typeof value !== "string") return false;
        const hit = c.mode === "insensitive" ? value.toLowerCase().includes(String(c.contains).toLowerCase()) : value.includes(String(c.contains));
        if (!hit) return false;
      }
      return true;
    }
    return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond;
  });
}

/** A partial unique index: `key` is unique among the rows for which `when` holds (e.g. one draft invoice per company). */
type PartialUnique = { key: string; when: (row: Row) => boolean };

function table(rows: Row[], opts: { pk: string; unique?: string[]; uniqueCombo?: string[]; uniqueWhere?: PartialUnique[]; defaults?: () => Row }) {
  const uniqueKeys = [opts.pk, ...(opts.unique ?? [])];
  let seq = 0;
  const copy = (r: Row | undefined | null) => (r ? { ...r } : null);
  const find = (where: Record<string, any>) => rows.find((r) => match(r, where)) ?? null;
  const api = {
    rows,
    findUnique: vi.fn(async (args: { where: Record<string, any>; select?: Record<string, any>; include?: Record<string, any> }) => attach(copy(find(args.where)), args)),
    findFirst: vi.fn(async (args: { where?: Where; select?: Record<string, any>; include?: Record<string, any> } = {}) => attach(copy(rows.find((r) => match(r, args.where))), args)),
    findMany: vi.fn(async (args: { where?: Where; take?: number; select?: Record<string, any>; include?: Record<string, any> } = {}) => rows.filter((r) => match(r, args.where)).slice(0, args.take).map((r) => attach({ ...r }, args) as Row)),
    count: vi.fn(async ({ where }: { where?: Where } = {}) => rows.filter((r) => match(r, where)).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      for (const k of uniqueKeys) {
        if (data[k] !== undefined && rows.some((r) => r[k] === data[k])) throw Object.assign(new Error(`Unique constraint failed on ${k}`), { code: "P2002" });
      }
      const row: Row = { ...(opts.defaults?.() ?? {}), createdAt: new Date(), ...data };
      for (const u of opts.uniqueWhere ?? []) {
        if (u.when(row) && rows.some((r) => u.when(r) && r[u.key] === row[u.key])) throw Object.assign(new Error(`Unique constraint failed on ${u.key}`), { code: "P2002" });
      }
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
    delete: vi.fn(async ({ where }: { where: Record<string, any> }) => {
      const row = find(where);
      if (!row) throw Object.assign(new Error("Record to delete does not exist."), { code: "P2025" });
      rows.splice(rows.indexOf(row), 1);
      return row;
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
    highlights: [...c.highlights],
    featureKeys: [...c.features],
    // The legacy pair, as the plan_features migration leaves them.
    features: [...c.highlights],
    capabilities: { apiAccess: c.features.includes("apiAccess"), ownComposio: c.features.includes("ownComposio") },
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
  const sequences = { invoice: 0 };
  const db = {
    sequences,
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
    // The reference is unique for plain payments; an invoice's attempts share its number, and an invoice has at most one
    // live (pending or confirmed) payment: the partial unique indexes of migration 20261013090000_invoices.
    manualPayment: table([], {
      pk: "id",
      uniqueWhere: [
        { key: "reference", when: (r) => !String(r.reference ?? "").startsWith("BP-INV-") },
        { key: "invoiceId", when: (r) => r.invoiceId != null && (r.status === "pending" || r.status === "confirmed") },
        // One pending payment per company, and one live payment per offer (20261014100000_custom_plan_offers).
        { key: "userId", when: (r) => r.status === "pending" },
        { key: "offerId", when: (r) => r.offerId != null && (r.status === "pending" || r.status === "confirmed") },
      ],
      defaults: () => ({ currency: "RWF", status: "pending", invoiceId: null, offerId: null, payerPhone: null, network: null, transactionId: null, proofPath: null, proofBytes: null, proofType: null, rejectReason: null, submittedAt: null, decidedAt: null, decidedBy: null, periodStart: null, periodEnd: null, updatedAt: new Date() }),
    }),
    // Invoices (lib/invoices): unique number, one draft per company.
    invoice: table([], {
      pk: "id",
      unique: ["number"],
      uniqueWhere: [{ key: "businessId", when: (r) => r.status === "draft" }],
      defaults: () => ({ status: "draft", taxRatePercent: null, taxMinor: 0, notes: null, billingEmail: null, planKey: null, interval: null, billTo: null, seller: null, pdfPath: null, sentAt: null, sentTo: [], reminderSentAt: null, paidAt: null, paidBy: null, voidedAt: null, voidReason: null, updatedAt: new Date() }),
    }),
    // Custom plans (lib/offers): add-on prices, offers (one sent or accepted per company), requests.
    addonPrice: table([], { pk: "id", defaults: () => ({ updatedBy: null, updatedAt: new Date() }) }),
    planOffer: table([], {
      pk: "id",
      uniqueWhere: [
        { key: "businessId", when: (r) => r.status === "sent" || r.status === "accepted" },
        { key: "customPlanKey", when: (r) => r.customPlanKey != null },
      ],
      defaults: () => ({ status: "draft", options: {}, requestId: null, adjustReason: null, note: null, validUntil: null, sentAt: null, acceptedAt: null, payMethod: null, customPlanKey: null, invoiceId: null, reminder3SentAt: null, reminder7SentAt: null, paidAt: null, paidBy: null, withdrawnAt: null, withdrawReason: null, updatedAt: new Date() }),
    }),
    customPlanRequest: table([], { pk: "id", defaults: () => ({ status: "new", source: "billing", handledBy: null, demoBookingId: null, budget: null, phone: null, updatedAt: new Date() }) }),
    renewalNotice: table([], { pk: "id", uniqueCombo: ["userId", "periodEnd", "kind"], defaults: () => ({ sentAt: new Date() }) }),
    analyticsEvent: table([], { pk: "id" }),
    // Regions, regional prices and demo bookings (R1). Empty by default: lib/region falls back to the seeds.
    pricingRegion: table([], { pk: "key" }),
    planRegionPrice: table([], { pk: "id", defaults: () => ({ cardMonthlyUsdCents: null, cardYearlyUsdCents: null, paddleMonthlyPriceId: null, paddleYearlyPriceId: null, updatedAt: new Date() }) }),
    adminAvailability: table([], { pk: "id" }),
    demoBooking: table([], { pk: "id", unique: ["icsToken"], defaults: () => ({ status: "booked", notes: null, meetingLink: null, sequence: 0, icsToken: `ics_${Math.random().toString(36).slice(2, 14)}`, updatedAt: new Date() }) }),
    membership: table([], { pk: "id", unique: ["userId"] }),
    // Industries as data (sign-up sectors) and the dismissed "New from sign-ups" suggestions.
    industry: table([], { pk: "id", unique: ["slug"], defaults: () => ({ hashtags: [], postIdeas: "", seasons: "", avoid: "", active: true, sortOrder: 0, updatedAt: new Date() }) }),
    dismissedIndustrySuggestion: table([], { pk: "key" }),
    $executeRaw: vi.fn(async () => 1),
    // Advisory locks answer "locked"; the invoice number sequence hands out 1, 2, 3... like nextval, atomically even
    // when calls interleave (the increment happens before the first await).
    $queryRaw: vi.fn(async (strings: TemplateStringsArray | string[]) => {
      if (Array.isArray(strings) && strings.join("").includes("Invoice_number_seq")) {
        const n = BigInt(++sequences.invoice);
        await Promise.resolve();
        return [{ n }];
      }
      return [{ locked: true }];
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  currentDb = db as never;
  return db;
}
export type FakeDb = ReturnType<typeof createFakeDb>;
