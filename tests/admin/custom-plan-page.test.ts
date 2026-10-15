import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";

// /admin/plans/[key] for a company's custom plan (found on CUSTOM-453VWMIBFL, LEAF Business GROUP LTD: ACTIVE,
// MANUAL_MOMO, 98,000 RWF a month). It said "0 clients" (the count came from the plan builder's list, which leaves custom
// plans out) and "$980 / month" with "Price (US dollars) 980" (RWF shown as dollars). Saving the form must never change
// a custom plan's price, currency or Paddle prices.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  createProduct: vi.fn(),
  createPrice: vi.fn(),
  updateProduct: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({
  paddleConnected: () => true,
  createPaddleProduct: h.createProduct,
  createPaddlePrice: h.createPrice,
  archivePaddlePrice: vi.fn(),
  updatePaddleProduct: h.updateProduct,
  getPaddleSubscription: vi.fn(),
  swapSubscriptionPrice: vi.fn(),
}));
vi.mock("@/lib/admin/console", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/console")>()), adminAction: vi.fn(async () => consoleContext("198.51.100.1")) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

import { getAdminPlan, listAdminPlans, planCounts, updatePlan, CUSTOM_PRICE_MESSAGE } from "@/lib/admin/plans-service";
import { savePlanAction } from "@/app/admin/(console)/(money)/plans/actions";
import { PlanForm } from "@/components/admin/plan-form";
import { resetPlanCache } from "@/lib/plan-catalog";
import { AdminError, consoleContext } from "@/lib/admin/types";

const KEY = "CUSTOM-453VWMIBFL";
const CONSOLE = consoleContext("198.51.100.1");
const UPDATED = new Date("2026-10-14T09:00:00Z");

function seedCustom() {
  const base = h.db.planDefinition.rows.find((r) => r.key === "STANDARD")!;
  h.db.planDefinition.rows.push({
    ...base,
    id: "plan_custom",
    key: KEY,
    name: "LEAF Business GROUP LTD custom",
    status: "hidden",
    isTrial: false,
    isCustom: true,
    businessId: "biz_leaf",
    monthlyPriceCents: 98000,
    yearlyPriceCents: 980000,
    currency: "RWF",
    limits: { ...(base.limits as object), text: 300 },
    paddleProductId: "pro_leaf",
    paddleMonthlyPriceId: null,
    paddleYearlyPriceId: null,
    paddlePrices: [],
    updatedAt: UPDATED,
  });
  h.db.subscription.rows.push(
    { id: "s_leaf", userId: "u_leaf", plan: KEY, status: "ACTIVE", provider: "MANUAL_MOMO", interval: "MONTH", cancelAtPeriodEnd: false },
    { id: "s_old", userId: "u_old", plan: KEY, status: "CANCELED", provider: "MANUAL_MOMO", interval: "MONTH", cancelAtPeriodEnd: false },
    { id: "s_std", userId: "u_std", plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", interval: "MONTH", cancelAtPeriodEnd: false },
  );
}

/** prisma groupBy over the fake rows (the fake db has none). */
function groupBy({ by, where }: { by: string[]; where?: { plan?: string } }) {
  const groups = new Map<string, Record<string, unknown> & { _count: { _all: number } }>();
  for (const r of h.db.subscription.rows.filter((r) => !where?.plan || r.plan === where.plan)) {
    const id = by.map((k) => String(r[k])).join("|");
    const g = groups.get(id) ?? { ...Object.fromEntries(by.map((k) => [k, r[k]])), _count: { _all: 0 } };
    g._count._all++;
    groups.set(id, g);
  }
  return Promise.resolve([...groups.values()]);
}

beforeEach(() => {
  h.db = createFakeDb();
  (h.db.subscription as unknown as { groupBy: unknown }).groupBy = vi.fn(groupBy);
  vi.clearAllMocks();
  resetPlanCache();
  h.createPrice.mockResolvedValue("pri_should_not_exist");
  seedCustom();
});

describe("the client count of a custom plan", () => {
  it("counts the companies on it, though the plan builder's list leaves custom plans out", async () => {
    expect((await listAdminPlans()).plans.some((p) => p.key === KEY)).toBe(false);
    const detail = await getAdminPlan(KEY);
    expect(detail.counts).toEqual({ subscribers: 1, payingSubscribers: 1, mrrCents: 98000 });
    expect(detail.plan.currency).toBe("RWF");
  });

  it("planCounts: live (active, past due, trialing), paying and MRR in the plan's own currency", () => {
    const plan = { key: "P", isTrial: false, monthlyPriceCents: 98000, yearlyPriceCents: 980000 };
    const g = (status: string, interval: string, n: number) => ({ plan: "P", interval, status, _count: { _all: n } });
    expect(planCounts(plan, [g("ACTIVE", "MONTH", 2), g("ACTIVE", "YEAR", 1), g("PAST_DUE", "MONTH", 1), g("CANCELED", "MONTH", 5), { ...g("ACTIVE", "MONTH", 9), plan: "Q" }])).toEqual({
      subscribers: 4,
      payingSubscribers: 4,
      mrrCents: 98000 * 3 + Math.round(980000 / 12),
    });
  });
});

describe("saving a custom plan's form", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    const base: Record<string, string> = { mode: "edit", key: KEY, version: UPDATED.toISOString(), name: "LEAF Business GROUP LTD custom", description: "", sortOrder: "0", status: "hidden", highlights: "" };
    for (const m of ["text", "image", "chat", "videos", "voiceCharacters", "seats"]) base[`limit_${m}`] = "1";
    for (const [k, v] of Object.entries({ ...base, ...fields })) f.set(k, v);
    return f;
  };
  const row = () => h.db.planDefinition.rows.find((r) => r.key === KEY)!;

  it("a limit change leaves the price, the currency and Paddle untouched, whatever the price fields say", async () => {
    // The old form posted the RWF amount as "980" dollars; an admin might even type "98,000".
    await expect(savePlanAction({}, form({ limit_text: "500", monthly: "98,000", yearly: "980,000" }))).rejects.toThrow(/REDIRECT \/admin\/plans\/CUSTOM-453VWMIBFL\?notice=Plan%20saved/);
    expect(row()).toMatchObject({ monthlyPriceCents: 98000, yearlyPriceCents: 980000, currency: "RWF", paddleMonthlyPriceId: null, paddleYearlyPriceId: null, paddlePrices: [] });
    expect((row().limits as { text: number }).text).toBe(500);
    expect(h.createPrice).not.toHaveBeenCalled();
    expect(h.createProduct).not.toHaveBeenCalled();
  });

  it("the service refuses a price change on a custom plan (Jarvis and approvals go through it too)", async () => {
    const e = await updatePlan(CONSOLE, KEY, { monthlyPriceCents: 1 }, { confirmPriceChange: true }).catch((x: AdminError) => x);
    expect(e).toBeInstanceOf(AdminError);
    expect((e as AdminError).code).toBe("conflict");
    expect((e as AdminError).message).toBe(CUSTOM_PRICE_MESSAGE);
    expect(row()).toMatchObject({ monthlyPriceCents: 98000, currency: "RWF" });
    expect(h.createPrice).not.toHaveBeenCalled();
  });

  it("a plan builder plan still takes a price in dollars", async () => {
    const out = await savePlanAction({}, form({ key: "STANDARD", version: new Date("2026-10-09T00:00:00Z").toISOString(), status: "active", monthly: "59", yearly: "590" }));
    expect(out.confirm?.monthlyCents).toBe(5900);
  });
});

describe("the form shows a custom plan's price in its own currency, read-only", () => {
  const initial = { key: KEY, name: "LEAF custom", description: "", isTrial: false, isCustom: true, currency: "RWF", trialDays: null, status: "hidden" as const, sortOrder: 0, highlight: false, monthlyPriceCents: 98000, yearlyPriceCents: 980000, limits: { text: 300, image: 100, chat: 500, videos: 0, voiceCharacters: 0, seats: 3 } as never, highlights: [], features: [] };

  it("98,000 RWF, no dollar price fields, and how to change it", () => {
    const html = renderToStaticMarkup(createElement(PlanForm, { mode: "edit", initial, paddleConnected: true, subscribers: 1 }));
    expect(html).toContain("98,000 RWF");
    expect(html).toContain("980,000 RWF");
    expect(html).not.toContain("$980");
    expect(html).not.toContain("Price (US dollars)");
    expect(html).not.toMatch(/name="monthly"|name="yearly"/);
    expect(html).toContain("To change it, make a new offer from the company&#x27;s page");
  });

  it("a plan builder plan keeps its dollar fields", () => {
    const html = renderToStaticMarkup(createElement(PlanForm, { mode: "edit", initial: { ...initial, isCustom: false, currency: "USD", monthlyPriceCents: 4900, yearlyPriceCents: 49000 }, paddleConnected: true, subscribers: 0 }));
    expect(html).toContain("Price (US dollars)");
    expect(html).toMatch(/name="monthly"[^>]*value="49"/);
    expect(html).toContain("$49");
  });
});
