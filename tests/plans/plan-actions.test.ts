import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, n: 0 }));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({
  paddleConnected: () => true,
  createPaddleProduct: async () => "pro_x",
  createPaddlePrice: async () => `pri_new_${++h.n}`,
  archivePaddlePrice: async () => {},
  updatePaddleProduct: async () => {},
  getPaddleSubscription: async () => ({}),
  swapSubscriptionPrice: async () => ({}),
}));
vi.mock("@/lib/admin/console", async () => {
  const { consoleContext, AdminError } = await import("@/lib/admin/types");
  return {
    adminAction: async () => consoleContext("198.51.100.1"),
    actionMessage: (e: unknown) => (e instanceof AdminError ? e.message : "Something went wrong."),
    finish: async () => {},
  };
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { savePlanAction } from "@/app/admin/(console)/plans/actions";
import { resetPlanCache } from "@/lib/plan-catalog";

const plan = (key: string) => h.db.planDefinition.rows.find((r) => r.key === key)!;

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const base: Record<string, string> = {
    mode: "edit", key: "STANDARD", name: "Standard", description: "d", sortOrder: "10", status: "active", monthly: "49", yearly: "490",
    limit_text: "100", limit_image: "50", limit_chat: "1000", limit_videoSeconds: "0", limit_voiceCharacters: "0", limit_seats: "3", features: "one\ntwo",
    version: plan("STANDARD").updatedAt.toISOString(),
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) f.set(k, v);
  return f;
}

beforeEach(() => {
  h.db = createFakeDb();
  h.n = 0;
  resetPlanCache();
  process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
  process.env.PADDLE_PRICE_STANDARD_YEAR = "pri_std_y";
});

describe("saving a plan from the form", () => {
  it("a price change answers with the review step and the exact cents it shows, and writes nothing", async () => {
    const out = await savePlanAction({}, form({ monthly: "59", yearly: "590" }));
    expect(out.confirm).toMatchObject({ monthlyCents: 5900, yearlyCents: 59000 });
    expect(plan("STANDARD").monthlyPriceCents).toBe(4900);
  });

  it("only the previewed price can be confirmed: a price edited after the review is refused", async () => {
    const refused = await savePlanAction({}, form({ monthly: "69", yearly: "590", confirmPrice: "1", previewMonthly: "5900", previewYearly: "59000" }));
    expect(refused.error).toMatch(/not the one you reviewed/);
    expect(plan("STANDARD").monthlyPriceCents).toBe(4900);
    const missing = await savePlanAction({}, form({ monthly: "59", yearly: "590", confirmPrice: "1" }));
    expect(missing.error).toMatch(/not the one you reviewed/);
  });

  it("the matching preview goes through (and the limits typed after the review are saved with it)", async () => {
    await expect(savePlanAction({}, form({ monthly: "59", yearly: "590", limit_text: "123", confirmPrice: "1", previewMonthly: "5900", previewYearly: "59000" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(plan("STANDARD")).toMatchObject({ monthlyPriceCents: 5900, yearlyPriceCents: 59000 });
    expect(plan("STANDARD").limits.text).toBe(123);
  });

  it("saves posts per app per day from the form, and refuses one outside 1 to 10", async () => {
    await expect(savePlanAction({}, form({ limit_postsPerAppPerDay: "2" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(plan("STANDARD").limits.postsPerAppPerDay).toBe(2);
    const out = await savePlanAction({}, form({ limit_postsPerAppPerDay: "11", version: plan("STANDARD").updatedAt.toISOString() }));
    expect(out).toMatchObject({ error: expect.stringContaining("Posts per app per day") });
  });

  it("a form opened before another admin saved is refused, and nothing is overwritten", async () => {
    const stale = form({ name: "Stale name" });
    plan("STANDARD").updatedAt = new Date("2026-10-10T00:00:00Z"); // another admin saved meanwhile
    resetPlanCache();
    const out = await savePlanAction({}, stale);
    expect(out.error).toMatch(/changed since you opened it/);
    expect(plan("STANDARD").name).toBe("Standard");
  });
});
