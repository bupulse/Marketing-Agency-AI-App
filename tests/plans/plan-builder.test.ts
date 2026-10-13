import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  connected: true,
  createProduct: vi.fn(),
  createPrice: vi.fn(),
  archivePrice: vi.fn(),
  updateProduct: vi.fn(),
  getSub: vi.fn(),
  swap: vi.fn(),
  email: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({
  paddleConnected: () => h.connected,
  createPaddleProduct: h.createProduct,
  createPaddlePrice: h.createPrice,
  archivePaddlePrice: h.archivePrice,
  updatePaddleProduct: h.updateProduct,
  getPaddleSubscription: h.getSub,
  swapSubscriptionPrice: h.swap,
}));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.email }));
vi.mock("@/lib/billing/apply", async (orig) => ({ ...(await orig<typeof import("@/lib/billing/apply")>()), applyProviderSubscription: h.apply }));

import { createPlan, previewPriceChange, updatePlan, cancelPriceChange, syncPlanToPaddle } from "@/lib/admin/plans-service";
import { businessHasApiAccess } from "@/lib/api/auth";
import { firstRenewalOnOrAfter, processPriceChanges } from "@/lib/billing/price-changes";
import { getSellablePlans, getPlans, planForPriceId, priceIdFor, resetPlanCache } from "@/lib/plan-catalog";
import { SEED_PLANS } from "@/lib/plans";
import { AdminError, apiContext, consoleContext } from "@/lib/admin/types";
import * as svc from "@/lib/admin/service";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5");
const DAY = 86_400_000;
const NOW = new Date("2026-10-09T10:00:00Z");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const audits = () => h.db.auditLog.rows;
const plan = (key: string) => h.db.planDefinition.rows.find((r) => r.key === key)!;

let n = 0;
function seedSub(over: Record<string, unknown>) {
  n++;
  const userId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  h.db.user.rows.push({ id: userId, email: `client${n}@example.com`, name: `Client ${n}` });
  h.db.subscription.rows.push({
    id: `s${n}`, userId, plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerCustomerId: `ctm_${n}`, providerSubscriptionId: `sub_${n}`,
    providerPriceId: "pri_std_m", interval: "MONTH", cancelAtPeriodEnd: false, currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY), ...over,
  });
  return { userId, subId: `sub_${n}` };
}

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  h.getSub.mockReset();
  h.archivePrice.mockReset();
  resetPlanCache();
  n = 0;
  h.connected = true;
  process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
  process.env.PADDLE_PRICE_STANDARD_YEAR = "pri_std_y";
  process.env.PADDLE_PRICE_PRO_MONTH = "pri_pro_m";
  process.env.PADDLE_PRICE_PRO_YEAR = "pri_pro_y";
  let p = 0;
  h.createProduct.mockResolvedValue("pro_new");
  h.createPrice.mockImplementation(async (i: { interval: string }) => `pri_new_${i.interval === "YEAR" ? "y" : "m"}${++p}`);
  h.archivePrice.mockResolvedValue(undefined);
  h.email.mockResolvedValue(true);
  // What the webhook would do after a swap: the subscription row shows the new price.
  h.apply.mockImplementation(async (_provider: string, mapped: { providerSubscriptionId: string; providerPriceId: string }) => {
    const row = h.db.subscription.rows.find((r) => r.providerSubscriptionId === mapped.providerSubscriptionId);
    if (row) row.providerPriceId = mapped.providerPriceId;
    return "applied";
  });
  h.swap.mockImplementation(async (subId: string, price: string) => ({ id: subId, status: "active", customer_id: "ctm_x", items: [{ price: { id: price } }] }));
});

// 20261016090000_people_images: the image limit is AI images now, and the cards say so.
const AI_IMAGE_COPY: Record<string, string> = { "50 brand designs a month": "30 AI images a month", "150 brand designs a month": "100 AI images a month" };

describe("the migration seeds exactly today's plans", () => {
  const sql = readFileSync("prisma/migrations/20261009095000_plan_builder/migration.sql", "utf8");
  const row = (key: string) => {
    const m = new RegExp(`\\('plan_[a-z]+', '${key}', '([^']*)', '([^']*)', (true|false), (\\d+|NULL), 'active', (\\d+), (true|false), (\\d+), (\\d+), 'USD',\\s*'(\\{[^']*\\})',\\s*'(\\[[^']*\\])',\\s*'(\\{[^']*\\})'`).exec(sql);
    expect(m, `seed row ${key}`).not.toBeNull();
    const [, name, description, isTrial, trialDays, sortOrder, highlight, monthly, yearly, limits, features, caps] = m!;
    return { name, description, isTrial: isTrial === "true", trialDays: trialDays === "NULL" ? null : Number(trialDays), sortOrder: Number(sortOrder), highlight: highlight === "true", monthly: Number(monthly), yearly: Number(yearly), limits: JSON.parse(limits), features: JSON.parse(features), caps: JSON.parse(caps) };
  };

  it("matches the old hard-coded limits, prices, trial length and features", () => {
    expect(row("TRIAL")).toMatchObject({ name: "Free trial", isTrial: true, trialDays: 7, monthly: 0, yearly: 0, limits: { text: 10, image: 5, videoSeconds: 0, voiceCharacters: 0, chat: 50 } });
    expect(row("STANDARD")).toMatchObject({ monthly: 4900, yearly: 49000, limits: { text: 100, image: 50, videoSeconds: 0, voiceCharacters: 0, chat: 1000 }, highlight: false });
    expect(row("PRO")).toMatchObject({ monthly: 9900, yearly: 99000, limits: { text: 300, image: 150, videoSeconds: 120, voiceCharacters: 20000, chat: 5000 }, highlight: true });
  });

  it("is identical to the code fallback (SEED_PLANS) and to the pricing page copy", () => {
    for (const [key, c] of Object.entries(SEED_PLANS)) {
      const r = row(key);
      // The pricing copy changed later with the AI image limits (20261016090000_people_images).
      r.features = r.features.map((f: string) => AI_IMAGE_COPY[f] ?? f);
      expect(r).toMatchObject({ name: c.name, description: c.description, isTrial: c.isTrial, trialDays: c.trialDays, sortOrder: c.sortOrder, highlight: c.highlight, monthly: c.priceUsdMonthly * 100, yearly: c.priceUsdYearly * 100, limits: Object.fromEntries(Object.entries(c.limits).filter(([k]) => k !== "seats" && k !== "videoSeconds" && k !== "image")), features: c.highlights, caps: { apiAccess: c.features.includes("apiAccess"), ownComposio: c.features.includes("ownComposio") } });
      // seats arrive with their own migration (the plan_seats one); here only the original five limits are compared
      expect(Object.keys(r.limits).sort()).toEqual(["chat", "image", "text", "videoSeconds", "voiceCharacters"]);
    }
    // Video seconds changed later (20261015090000_content_visuals): trial 30, Pro and Business 240, the rest as seeded.
    const video = readFileSync("prisma/migrations/20261015090000_content_visuals/migration.sql", "utf8");
    expect(video).toContain(`jsonb_set("limits", '{videoSeconds}', '${SEED_PLANS.PRO.limits.videoSeconds}'::jsonb)\nWHERE "key" IN ('BUSINESS', 'PRO')`);
    expect(video).toContain(`jsonb_set("limits", '{videoSeconds}', '${SEED_PLANS.TRIAL.limits.videoSeconds}'::jsonb)\nWHERE "isTrial" = true`);
    expect(row("STANDARD").limits.videoSeconds).toBe(SEED_PLANS.STANDARD.limits.videoSeconds);
    const people = readFileSync("prisma/migrations/20261016090000_people_images/migration.sql", "utf8");
    expect(people).toMatch(/'\{image\}', '30'::jsonb\) WHERE "key" IN \('STARTER', 'STANDARD'\)/);
    expect(people).toMatch(/'\{image\}', '100'::jsonb\) WHERE "key" IN \('BUSINESS', 'PRO'\)/);
    expect(people).toMatch(/'\{image\}', '5'::jsonb\) WHERE "isTrial" = true/);
    expect([SEED_PLANS.TRIAL.limits.image, SEED_PLANS.STANDARD.limits.image, SEED_PLANS.PRO.limits.image]).toEqual([5, 30, 100]);
    for (const [from, to] of Object.entries(AI_IMAGE_COPY)) expect(people).toContain(`'${from}', '${to}'`);
    expect(SEED_PLANS.STANDARD.highlights).toEqual(["100 AI text generations a month", "30 AI images a month", "Post to 5 social networks", "Lead-capturing chat widget", "Content calendar and scheduling"]);
  });

  it("keeps existing subscriptions: the column becomes the same words as text, with a foreign key, and the overrides are folded in", () => {
    expect(sql).toContain('ALTER COLUMN "plan" TYPE TEXT USING "plan"::text');
    expect(sql).toContain('FOREIGN KEY ("plan") REFERENCES "PlanDefinition"("key")');
    expect(sql).toContain('d."limits" || o."limits"');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toMatch(/REVOKE ALL ON TABLE "PlanDefinition", "PlanPriceChange", "PlanPriceChangeItem" FROM PUBLIC, anon, authenticated/);
  });

  it("the loader serves the seed plans when the table is empty or unreadable", async () => {
    h.db.planDefinition.rows.length = 0;
    const plans = await getPlans({ force: true });
    expect(plans.map((p) => p.key)).toEqual(["TRIAL", "STANDARD", "PRO"]);
    expect(plans.find((p) => p.key === "PRO")!.limits.chat).toBe(5000);
  });
});

describe("capabilities match the old Pro-only checks", () => {
  const biz = (planKey: string, status: string, suspendedAt: Date | null = null) => {
    h.db.business.rows.length = 0;
    h.db.business.rows.push({ id: "b1", user: { suspendedAt, subscription: { plan: planKey, status } } });
  };
  it("API access: Pro only, only while active or trialing, never when suspended", async () => {
    biz("PRO", "ACTIVE");
    expect(await businessHasApiAccess("b1")).toBe(true);
    for (const [p, s] of [["STANDARD", "ACTIVE"], ["TRIAL", "TRIALING"], ["PRO", "PAST_DUE"], ["PRO", "CANCELED"]] as const) {
      biz(p, s);
      expect(await businessHasApiAccess("b1"), `${p} ${s}`).toBe(false);
    }
    biz("PRO", "ACTIVE", new Date());
    expect(await businessHasApiAccess("b1")).toBe(false);
  });

  it("a new plan with the capability gets API access, and turning it off removes it", async () => {
    await createPlan(CONSOLE, { key: "agency", name: "Agency", monthlyPriceCents: 19900, yearlyPriceCents: 199000, status: "active", capabilities: { apiAccess: true } });
    biz("agency", "ACTIVE");
    expect(await businessHasApiAccess("b1")).toBe(true);
    await updatePlan(CONSOLE, "agency", { capabilities: { apiAccess: false } });
    biz("agency", "ACTIVE");
    expect(await businessHasApiAccess("b1")).toBe(false);
  });
});

describe("Paddle price ids map back to a plan, old ones too", () => {
  it("maps env ids today, and DB ids plus the whole history after a price change", async () => {
    expect(await planForPriceId("PADDLE", "pri_std_m")).toEqual({ plan: "STANDARD", interval: "MONTH" });
    expect(await planForPriceId("PADDLE", "pri_pro_y")).toEqual({ plan: "PRO", interval: "YEAR" });
    expect(await planForPriceId("PADDLE", "pri_nope")).toBeNull();
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 59000 }, { confirmPriceChange: true });
    expect(await priceIdFor("PADDLE", "STANDARD", "MONTH")).toMatch(/^pri_new_m/);
    expect(await planForPriceId("PADDLE", "pri_std_m")).toEqual({ plan: "STANDARD", interval: "MONTH" }); // old, from history
    expect(await planForPriceId("PADDLE", "pri_std_y")).toEqual({ plan: "STANDARD", interval: "YEAR" });
    const newM = (await priceIdFor("PADDLE", "STANDARD", "MONTH"))!;
    expect(await planForPriceId("PADDLE", newM)).toEqual({ plan: "STANDARD", interval: "MONTH" });
  });

  it("the webhook path writes the plan key of an old price id", async () => {
    const { applyProviderSubscription } = await vi.importActual<typeof import("@/lib/billing/apply")>("@/lib/billing/apply");
    await updatePlan(CONSOLE, "PRO", { monthlyPriceCents: 10900, yearlyPriceCents: 109000 }, { confirmPriceChange: true });
    const { userId } = seedSub({ plan: "PRO", providerPriceId: "pri_pro_m", providerSubscriptionId: "sub_old" });
    const outcome = await applyProviderSubscription("PADDLE", { providerSubscriptionId: "sub_old", providerCustomerId: "ctm_1", providerPriceId: "pri_pro_m", userId, userIdSignature: null, status: "ACTIVE", currentPeriodStart: NOW, currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY), cancelAtPeriodEnd: false, updatedAt: null });
    expect(outcome).toBe("applied");
    expect(h.db.subscription.rows.find((r) => r.userId === userId)).toMatchObject({ plan: "PRO", interval: "MONTH" });
  });
});

describe("creating a plan", () => {
  it("creates the Paddle product and both prices, goes live, and is audited", async () => {
    const out = await createPlan(CONSOLE, { key: "starter", name: "Starter", description: "Small", monthlyPriceCents: 1900, yearlyPriceCents: 19000, status: "active", limits: { text: 20 }, highlights: ["20 posts"] });
    expect(out.paddle).toBe("synced");
    expect(out.plan).toMatchObject({ key: "starter", status: "active", syncState: "synced", paddleProductId: "pro_new" });
    expect(out.plan.paddleMonthlyPriceId).toMatch(/^pri_new_m/);
    expect(out.plan.paddlePrices).toHaveLength(2);
    expect(out.plan.limits).toMatchObject({ text: 20, image: 0 });
    expect(audits().map((a) => a.action)).toEqual(["create_plan", "sync_plan_paddle", "update_plan"]);
    expect((await getSellablePlans()).map((p) => p.key)).toEqual(["STANDARD", "PRO", "starter"]);
  });

  it("without Paddle keys it still saves a draft and says so", async () => {
    h.connected = false;
    const out = await createPlan(CONSOLE, { key: "draft1", name: "Draft", monthlyPriceCents: 1000, yearlyPriceCents: 10000, status: "active" });
    expect(out.paddle).toBe("not_connected");
    expect(out.plan).toMatchObject({ status: "hidden", syncState: "not_synced", paddleProductId: null }); // never on sale without Paddle prices
    expect(h.createProduct).not.toHaveBeenCalled();
    expect(await code(syncPlanToPaddle(CONSOLE, "draft1"))).toBe("unavailable");
  });

  it("a Paddle failure leaves a hidden draft that knows what exists, and Retry creates only the rest", async () => {
    h.createPrice.mockReset();
    h.createPrice.mockResolvedValueOnce("pri_ok_m").mockRejectedValueOnce(new Error("Paddle API 400 on /prices: invalid_field boom"));
    const out = await createPlan(CONSOLE, { key: "half", name: "Half", monthlyPriceCents: 1000, yearlyPriceCents: 10000, status: "active" });
    expect(out.paddle).toBe("failed");
    expect(plan("half")).toMatchObject({ status: "hidden", syncState: "failed", paddleProductId: "pro_new", paddleMonthlyPriceId: "pri_ok_m" });
    expect(plan("half").paddleYearlyPriceId ?? null).toBeNull();
    expect(plan("half").syncError).toMatch(/boom/);
    expect(audits().some((a) => a.action === "sync_plan_paddle_failed")).toBe(true);
    h.createPrice.mockReset();
    h.createPrice.mockResolvedValue("pri_ok_y");
    const retried = await syncPlanToPaddle(CONSOLE, "half");
    expect(h.createProduct).toHaveBeenCalledTimes(1); // not again
    expect(h.createPrice).toHaveBeenCalledTimes(1); // only the missing yearly price
    expect(retried.plan).toMatchObject({ syncState: "synced", paddleYearlyPriceId: "pri_ok_y", paddleMonthlyPriceId: "pri_ok_m", syncError: null });
  });

  it("rejects bad keys, duplicates and unusable input", async () => {
    expect(await code(createPlan(CONSOLE, { key: "x", name: "X", monthlyPriceCents: 1, yearlyPriceCents: 1 }))).toBe("invalid");
    expect(await code(createPlan(CONSOLE, { key: "standard", name: "Dup", monthlyPriceCents: 100, yearlyPriceCents: 1000 }))).toBe("conflict");
    expect(await code(createPlan(CONSOLE, { key: "free-ish", name: "Free", monthlyPriceCents: 0, yearlyPriceCents: 0 }))).toBe("invalid");
    expect(await code(createPlan(CONSOLE, { key: "ok-plan", name: "Ok", monthlyPriceCents: 100, yearlyPriceCents: 1000, limits: { text: -1 } }))).toBe("invalid");
    expect(await code(createPlan(CONSOLE, { key: "ok-plan", name: "Ok", monthlyPriceCents: 100, yearlyPriceCents: 1000, highlights: Array(13).fill("x") }))).toBe("invalid");
  });
});

describe("a price increase", () => {
  async function raise() {
    const a = seedSub({ interval: "MONTH", providerPriceId: "pri_std_m", currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY) }); // renews in 10 days: too soon
    const b = seedSub({ interval: "YEAR", providerPriceId: "pri_std_y", currentPeriodEnd: new Date(NOW.getTime() + 200 * DAY) });
    const c = seedSub({ interval: "MONTH", providerPriceId: "pri_std_m", currentPeriodEnd: new Date(NOW.getTime() + 45 * DAY) });
    seedSub({ cancelAtPeriodEnd: true }); // leaving anyway: not moved
    seedSub({ plan: "PRO", providerPriceId: "pri_pro_m" }); // another plan: untouched
    const result = await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 59000 }, { confirmPriceChange: true });
    return { a, b, c, result };
  }

  it("asks for confirmation and says who is affected, in plain words", async () => {
    seedSub({});
    seedSub({ interval: "MONTH" });
    const preview = await previewPriceChange("STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 49000 });
    expect(preview).toMatchObject({ changed: true, direction: "increase", affected: 2 });
    expect(preview.lines[0]).toBe("2 clients will move from $49 to $59 per month on their next renewal after a 30-day notice. Each gets an email first; a renewal less than 30 days away waits for the one after.");
    expect(await code(updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900 }))).toBe("confirm_required");
    expect(plan("STANDARD").monthlyPriceCents).toBe(4900); // nothing written
    expect(h.createPrice).not.toHaveBeenCalled();
  });

  it("creates new Paddle prices, points the plan at them, keeps the old ids and schedules every subscriber", async () => {
    const { result } = await raise();
    expect(result.priceChange).toMatchObject({ direction: "increase", subscribers: 3 });
    expect(plan("STANDARD")).toMatchObject({ monthlyPriceCents: 5900, yearlyPriceCents: 59000, syncState: "synced" });
    expect(plan("STANDARD").paddleMonthlyPriceId).toMatch(/^pri_new_m/);
    expect(plan("STANDARD").paddlePrices.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["pri_std_m", "pri_std_y", plan("STANDARD").paddleMonthlyPriceId, plan("STANDARD").paddleYearlyPriceId]));
    const items = h.db.planPriceChangeItem.rows;
    expect(items).toHaveLength(3);
    expect(items.map((i) => [i.oldCents, i.newCents]).sort()).toEqual([[4900, 5900], [4900, 5900], [49000, 59000]].sort());
    const audit = audits().find((x) => x.action === "update_plan")!;
    expect(audit.before).toMatchObject({ monthlyPriceCents: 4900, yearlyPriceCents: 49000 });
    expect(audit.after).toMatchObject({ monthlyPriceCents: 5900, yearlyPriceCents: 59000, subscribersToMove: 3 });
  });

  it("emails each client, and no new price starts less than 30 days after the notice", async () => {
    const { a, b, c } = await raise();
    const run = await processPriceChanges({ now: NOW });
    expect(run).toMatchObject({ processed: 3, notified: 3, applied: 0 });
    expect(h.email).toHaveBeenCalledTimes(3);
    expect(h.email.mock.calls[0][0]).toMatchObject({ to: "client1@example.com" });
    expect(h.email.mock.calls[0][0].subject).toMatch(/price changes on/);
    expect(h.email.mock.calls[0][0].text).toMatch(/\$49 per month/);
    expect(h.email.mock.calls[0][0].text).toMatch(/\$59 per month/);
    const by = (userId: string) => h.db.planPriceChangeItem.rows.find((i) => i.userId === userId)!;
    for (const x of [a, b, c]) {
      expect(by(x.userId).status).toBe("notified");
      expect(by(x.userId).effectiveAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 30 * DAY);
    }
    // renewal in 10 days is too soon: moved to the renewal after next (10 days + 1 month)
    expect(by(a.userId).effectiveAt.toISOString().slice(0, 10)).toBe("2026-11-19");
    expect(by(c.userId).effectiveAt.getTime()).toBe(NOW.getTime() + 45 * DAY); // 45 days is far enough
    expect(by(b.userId).effectiveAt.getTime()).toBe(NOW.getTime() + 200 * DAY);
    expect(h.db.planPriceChange.rows[0]).toMatchObject({ notifiedCount: 3, appliedCount: 0, status: "scheduled" });
    expect(h.swap).not.toHaveBeenCalled(); // nothing changes before the renewal window
  });

  it("an email that fails is retried later and the client is never moved without a notice", async () => {
    const { a } = await raise();
    h.email.mockResolvedValue(false);
    const first = await processPriceChanges({ now: NOW });
    expect(first.waiting).toBe(3);
    expect(h.db.planPriceChangeItem.rows.every((i) => i.status === "pending")).toBe(true);
    h.email.mockResolvedValue(true);
    expect((await processPriceChanges({ now: new Date(NOW.getTime() + DAY) })).notified).toBe(3);
    expect(h.db.planPriceChangeItem.rows.find((i) => i.userId === a.userId)!.noticeSentAt).toEqual(new Date(NOW.getTime() + DAY));
  });

  it("swaps to the new price shortly before the renewal with no charge now, then completes", async () => {
    const { a, b, c } = await raise();
    await processPriceChanges({ now: NOW });
    const item = (id: string) => h.db.planPriceChangeItem.rows.find((i) => i.userId === id)!;
    const newM = plan("STANDARD").paddleMonthlyPriceId;
    h.getSub.mockImplementation(async (subId: string) => {
      const it = h.db.planPriceChangeItem.rows.find((i) => i.providerSubscriptionId === subId)!;
      return { status: "active", priceId: it.oldPriceId, nextBilledAt: it.effectiveAt, periodEnd: it.effectiveAt, cancelScheduled: false };
    });
    // 1 day before client a's renewal (the earliest): only a is in the window
    const day = new Date(item(a.userId).effectiveAt.getTime() - DAY);
    const run = await processPriceChanges({ now: day });
    expect(run).toMatchObject({ applied: 1, waiting: 2 });
    expect(h.swap).toHaveBeenCalledWith(a.subId, newM);
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(item(a.userId)).toMatchObject({ status: "applied" });
    expect((await processPriceChanges({ now: new Date(item(c.userId).effectiveAt.getTime() - DAY) })).applied).toBe(1);
    expect(item(c.userId)).toMatchObject({ status: "applied" });
    // the other two later
    const last = await processPriceChanges({ now: new Date(item(b.userId).effectiveAt.getTime() - DAY) });
    expect(last.applied).toBe(1);
    expect(h.db.planPriceChange.rows[0]).toMatchObject({ status: "completed", appliedCount: 3, notifiedCount: 3, failedCount: 0 });
    expect(h.swap).toHaveBeenCalledWith(b.subId, plan("STANDARD").paddleYearlyPriceId);
  });

  it("waits if Paddle's next bill is earlier than 30 days after the notice, and skips a client who left", async () => {
    const { a, c } = await raise();
    await processPriceChanges({ now: NOW });
    const itemC = h.db.planPriceChangeItem.rows.find((i) => i.userId === c.userId)!;
    h.getSub.mockResolvedValue({ status: "active", priceId: "pri_std_m", nextBilledAt: new Date(NOW.getTime() + 20 * DAY), periodEnd: null, cancelScheduled: false });
    const early = await processPriceChanges({ now: new Date(NOW.getTime() + 19 * DAY) });
    expect(h.swap).not.toHaveBeenCalled();
    expect(early.applied).toBe(0);
    expect(itemC.effectiveAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 30 * DAY);
    // a leaves
    h.db.subscription.rows.find((r) => r.userId === a.userId)!.cancelAtPeriodEnd = true;
    await processPriceChanges({ now: new Date(NOW.getTime() + 20 * DAY) });
    expect(h.db.planPriceChangeItem.rows.find((i) => i.userId === a.userId)).toMatchObject({ status: "skipped" });
  });

  it("a Paddle refusal marks one client failed and shows it; a network error is retried", async () => {
    const { c } = await raise();
    await processPriceChanges({ now: NOW });
    const it = h.db.planPriceChangeItem.rows.find((i) => i.userId === c.userId)!;
    h.getSub.mockImplementation(async (subId: string) => {
      const x = h.db.planPriceChangeItem.rows.find((i) => i.providerSubscriptionId === subId)!;
      return { status: "active", priceId: x.oldPriceId, nextBilledAt: x.effectiveAt, periodEnd: null, cancelScheduled: false };
    });
    // only client c is in the window
    const day = new Date(it.effectiveAt.getTime() - DAY);
    h.db.planPriceChangeItem.rows.filter((i) => i !== it).forEach((i) => (i.effectiveAt = new Date(it.effectiveAt.getTime() + 100 * DAY)));
    h.swap.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await processPriceChanges({ now: day })).waiting).toBeGreaterThanOrEqual(1);
    expect(it.status).toBe("notified");
    expect(it.error).toMatch(/fetch failed/);
    h.swap.mockRejectedValueOnce(new Error("Paddle API 422 on /subscriptions/x: subscription_locked nope"));
    const run = await processPriceChanges({ now: day });
    expect(run.failed).toBe(1);
    expect(it).toMatchObject({ status: "failed" });
    expect(it.error).toMatch(/subscription_locked/);
    expect(h.db.planPriceChange.rows[0].failedCount).toBe(1);
  });

  it("works in batches with a cursor", async () => {
    await raise();
    const first = await processPriceChanges({ now: NOW, batchSize: 2 });
    expect(first.processed).toBe(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await processPriceChanges({ now: NOW, batchSize: 2, cursor: first.nextCursor });
    expect(second.processed).toBe(1);
    expect(second.nextCursor).toBeNull();
    expect(h.email).toHaveBeenCalledTimes(3);
  });

  it("a newer change replaces a waiting one, and an admin can stop one", async () => {
    await raise();
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 6900, yearlyPriceCents: 69000 }, { confirmPriceChange: true });
    const [first, second] = h.db.planPriceChange.rows;
    expect(first.status).toBe("cancelled");
    expect(second.status).toBe("scheduled");
    expect(h.db.planPriceChangeItem.rows.filter((i) => i.changeId === first.id).every((i) => i.status === "skipped")).toBe(true);
    await cancelPriceChange(CONSOLE, second.id);
    expect(second.status).toBe("cancelled");
    expect(audits().map((a) => a.action)).toContain("cancel_price_change");
    expect(await code(cancelPriceChange(CONSOLE, second.id))).toBe("conflict");
  });

  it("firstRenewalOnOrAfter steps by the billing interval", () => {
    const r = new Date("2026-10-19T00:00:00Z");
    expect(firstRenewalOnOrAfter(r, "MONTH", new Date("2026-11-08T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-19");
    expect(firstRenewalOnOrAfter(r, "MONTH", new Date("2026-10-01T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(firstRenewalOnOrAfter(r, "YEAR", new Date("2026-11-08T00:00:00Z")).toISOString().slice(0, 10)).toBe("2027-10-19");
  });
});

describe("a price decrease", () => {
  it("moves clients at their next renewal without a notice or a 30-day wait", async () => {
    const soon = seedSub({ currentPeriodEnd: new Date(NOW.getTime() + DAY) });
    const later = seedSub({ currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY) });
    const result = await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 3900 }, { confirmPriceChange: true });
    expect(result.priceChange).toMatchObject({ direction: "decrease", subscribers: 2 });
    h.getSub.mockImplementation(async (subId: string) => ({ status: "active", priceId: "pri_std_m", nextBilledAt: new Date(NOW.getTime() + (subId === soon.subId ? 1 : 20) * DAY), periodEnd: null, cancelScheduled: false }));
    const run = await processPriceChanges({ now: NOW });
    expect(h.email).not.toHaveBeenCalled();
    expect(run).toMatchObject({ applied: 1, waiting: 1 });
    expect(h.swap).toHaveBeenCalledWith(soon.subId, plan("STANDARD").paddleMonthlyPriceId);
    // (the webhook, mocked here, would now show the client on the new price)
    h.db.subscription.rows.find((r) => r.userId === soon.userId)!.providerPriceId = plan("STANDARD").paddleMonthlyPriceId;
    // 19 days later the other renewal is a day away
    const done = await processPriceChanges({ now: new Date(NOW.getTime() + 19 * DAY) });
    expect(done.applied).toBe(1);
    expect(h.swap).toHaveBeenCalledWith(later.subId, plan("STANDARD").paddleMonthlyPriceId);
    expect(h.db.planPriceChange.rows[0]).toMatchObject({ status: "completed", appliedCount: 2, notifiedCount: 0 });
  });
});

describe("old prices are archived when nobody uses them", () => {
  it("archives an old price once no subscription and no waiting move uses it", async () => {
    const x = seedSub({});
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 3900 }, { confirmPriceChange: true });
    h.getSub.mockResolvedValue({ status: "active", priceId: "pri_std_m", nextBilledAt: new Date(NOW.getTime() + DAY), periodEnd: null, cancelScheduled: false });
    // While the client is on the old monthly price nothing archives it; the old yearly price has no user at all.
    h.apply.mockResolvedValueOnce("applied");
    const run = await processPriceChanges({ now: NOW });
    expect(run.applied).toBe(1);
    expect(h.archivePrice.mock.calls).toEqual([["pri_std_y"]]);
    expect(h.db.subscription.rows.find((r) => r.userId === x.userId)!.providerPriceId).toBe("pri_std_m"); // the webhook has not rewritten it yet
    h.db.subscription.rows.find((r) => r.userId === x.userId)!.providerPriceId = plan("STANDARD").paddleMonthlyPriceId;
    h.archivePrice.mockClear();
    const again = await processPriceChanges({ now: NOW });
    expect(again.archivedPrices).toBe(1);
    expect(h.archivePrice).toHaveBeenCalledWith("pri_std_m");
    expect(plan("STANDARD").paddlePrices.find((p: { id: string }) => p.id === "pri_std_m").archivedAt).toBeTruthy();
  });
});

describe("a Paddle failure half-way changes nothing", () => {
  it("creates nothing in the plan, archives what Paddle made, records the error, and writes an audit row", async () => {
    seedSub({});
    h.createPrice.mockReset();
    h.createPrice.mockResolvedValueOnce("pri_made_m").mockRejectedValueOnce(new Error("Paddle API 503 on /prices: x"));
    const err = await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 59000, name: "Standard Plus" }, { confirmPriceChange: true }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.message).toMatch(/Nothing was changed/);
    expect(plan("STANDARD")).toMatchObject({ name: "Standard", monthlyPriceCents: 4900, yearlyPriceCents: 49000, paddleMonthlyPriceId: null, syncState: "failed" });
    expect(plan("STANDARD").syncError).toMatch(/Price change failed/);
    expect(h.archivePrice).toHaveBeenCalledWith("pri_made_m");
    expect(h.db.planPriceChange.rows).toHaveLength(0);
    expect(h.db.planPriceChangeItem.rows).toHaveLength(0);
    expect(audits().map((a) => a.action)).toEqual(["update_plan_failed"]);
    expect(await priceIdFor("PADDLE", "STANDARD", "MONTH")).toBe("pri_std_m"); // checkout still uses the old price
  });

  it("refuses a price change of a selling plan while Paddle is not connected", async () => {
    h.connected = false;
    expect(await code(updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900 }, { confirmPriceChange: true }))).toBe("unavailable");
    expect(plan("STANDARD").monthlyPriceCents).toBe(4900);
    // but other edits work offline
    await updatePlan(CONSOLE, "STANDARD", { description: "New words" });
    expect(plan("STANDARD").description).toBe("New words");
  });

  it("a price change on a draft without Paddle ids is just saved", async () => {
    h.connected = false;
    await createPlan(CONSOLE, { key: "d2", name: "D2", monthlyPriceCents: 1000, yearlyPriceCents: 10000 });
    const r = await updatePlan(CONSOLE, "d2", { monthlyPriceCents: 1500 }, { confirmPriceChange: true });
    expect(r.priceChange).toMatchObject({ subscribers: 0 });
    expect(plan("d2").monthlyPriceCents).toBe(1500);
  });
});

describe("retiring, hiding and the trial", () => {
  it("a retired plan leaves the sell list, keeps its clients and its limits, and cannot be given to anyone new", async () => {
    const x = seedSub({ plan: "STANDARD" });
    await updatePlan(CONSOLE, "STANDARD", { status: "retired" });
    expect((await getSellablePlans()).map((p) => p.key)).toEqual(["PRO"]);
    expect(h.db.subscription.rows.find((r) => r.userId === x.userId)!.plan).toBe("STANDARD");
    expect((await getPlans()).find((p) => p.key === "STANDARD")!.limits.text).toBe(100);
    expect(await code(svc.requestChangePlan(API, { userId: "11111111-1111-4111-8111-111111111111", plan: "STANDARD", idempotencyKey: "retired-plan-1" }))).toBe("not_found");
    h.db.subscription.rows.push({ id: "sx", userId: "11111111-1111-4111-8111-111111111111", plan: "PRO", status: "ACTIVE", provider: "PADDLE", providerSubscriptionId: "sub_z", interval: "MONTH" });
    expect(await code(svc.requestChangePlan(API, { userId: "11111111-1111-4111-8111-111111111111", plan: "STANDARD", idempotencyKey: "retired-plan-2" }))).toBe("conflict");
    const a = audits().find((e) => e.action === "update_plan")!;
    expect(a.before).toEqual({ status: "active" });
    expect(a.after).toEqual({ status: "retired" });
  });

  it("hidden plans are not for sale either, and activating needs Paddle prices when Paddle is connected", async () => {
    h.connected = false;
    await createPlan(CONSOLE, { key: "hid", name: "Hid", monthlyPriceCents: 1000, yearlyPriceCents: 10000, status: "hidden" });
    expect((await getSellablePlans()).map((p) => p.key)).not.toContain("hid");
    h.connected = true;
    expect(await code(updatePlan(CONSOLE, "hid", { status: "active" }))).toBe("conflict");
    await syncPlanToPaddle(CONSOLE, "hid");
    await updatePlan(CONSOLE, "hid", { status: "active" });
    expect((await getSellablePlans()).map((p) => p.key)).toContain("hid");
  });

  it("the trial can be edited (length, limits) but not retired, hidden or priced", async () => {
    await updatePlan(CONSOLE, "TRIAL", { trialDays: 14, limits: { text: 12 } });
    expect(plan("TRIAL")).toMatchObject({ trialDays: 14 });
    expect(plan("TRIAL").limits).toMatchObject({ text: 12, image: 5, chat: 50 });
    expect(await code(updatePlan(CONSOLE, "TRIAL", { status: "retired" }))).toBe("conflict");
    expect(await code(updatePlan(CONSOLE, "TRIAL", { status: "hidden" }))).toBe("conflict");
    expect(await code(updatePlan(CONSOLE, "TRIAL", { monthlyPriceCents: 100 }))).toBe("conflict");
    expect(await code(updatePlan(CONSOLE, "TRIAL", { trialDays: 0 }))).toBe("invalid");
  });
});

describe("audit rows", () => {
  it("every change writes one row with before and after, including for the API actor", async () => {
    await updatePlan(API, "PRO", { name: "Pro Max", highlights: ["a", "b"] });
    const a = audits()[0];
    expect(a).toMatchObject({ action: "update_plan", target: "plan:PRO", actor: API.actor });
    expect(a.before).toMatchObject({ name: "Pro", highlights: SEED_PLANS.PRO.highlights });
    expect(a.after).toEqual({ name: "Pro Max", highlights: ["a", "b"] });
    await updatePlan(API, "PRO", { name: "Pro Max" }); // no change, no row
    expect(audits()).toHaveLength(1);
    await svc.updatePlanLimits(API, { plan: "PRO", limits: { chat: 1 }, confirm: true });
    expect(audits()[1]).toMatchObject({ action: "update_plan_limits" });
  });
});

describe("Jarvis: a price change is only an approval", () => {
  it("update_plan applies other fields now and turns the price into a pending approval; the plan keeps its price", async () => {
    const out = await svc.updatePlanFromTool(API, { plan: "PRO", name: "Pro Plus", monthlyPriceCents: 12900, confirm: true, idempotencyKey: "plan-price-0001" });
    expect(out.applied?.changed).toEqual(["name"]);
    expect(out.priceChangeApproval).toMatchObject({ status: "pending", kind: "plan_price_change" });
    expect(plan("PRO")).toMatchObject({ name: "Pro Plus", monthlyPriceCents: 9900 });
    expect(h.createPrice).not.toHaveBeenCalled();
    expect(await code(svc.updatePlanFromTool(API, { plan: "PRO", name: "X" }))).toBe("confirm_required");
  });

  it("when the owner approves, the new prices are created and the clients are scheduled; a plan edited in between refuses", async () => {
    seedSub({ plan: "PRO", providerPriceId: "pri_pro_m" });
    const { priceChangeApproval } = await svc.updatePlanFromTool(API, { plan: "PRO", monthlyPriceCents: 12900, confirm: true, idempotencyKey: "plan-price-0002" });
    const done = await svc.approveAction(CONSOLE, priceChangeApproval!.id!);
    expect(done.status).toBe("executed");
    expect(plan("PRO").monthlyPriceCents).toBe(12900);
    expect(h.db.planPriceChange.rows[0]).toMatchObject({ planKey: "PRO", subscribers: 1 });

    const second = await svc.updatePlanFromTool(API, { plan: "PRO", monthlyPriceCents: 13900, confirm: true, idempotencyKey: "plan-price-0003" });
    plan("PRO").monthlyPriceCents = 11111; // someone changed it meanwhile
    resetPlanCache();
    const failed = await svc.approveAction(CONSOLE, second.priceChangeApproval!.id!);
    expect(failed.status).toBe("failed");
    expect(plan("PRO").monthlyPriceCents).toBe(11111);
  });
});

describe("the cron claims what it works on", () => {
  async function raiseTwo() {
    const a = seedSub({ interval: "MONTH", providerPriceId: "pri_std_m", currentPeriodEnd: new Date(NOW.getTime() + 45 * DAY) });
    const b = seedSub({ interval: "YEAR", providerPriceId: "pri_std_y", currentPeriodEnd: new Date(NOW.getTime() + 200 * DAY) });
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 59000 }, { confirmPriceChange: true });
    return { a, b };
  }
  const item = (userId: string) => h.db.planPriceChangeItem.rows.find((i) => i.userId === userId)!;
  const live = (it: { oldPriceId?: unknown; effectiveAt?: unknown }) => ({ status: "active", priceId: it.oldPriceId, nextBilledAt: it.effectiveAt, periodEnd: null, cancelScheduled: false });

  it("two runs at once send each email once", async () => {
    await raiseTwo();
    const [r1, r2] = await Promise.all([processPriceChanges({ now: NOW }), processPriceChanges({ now: NOW })]);
    expect(h.email).toHaveBeenCalledTimes(2);
    expect(r1.notified + r2.notified).toBe(2);
  });

  it("a second run while one holds the lock does nothing", async () => {
    await raiseTwo();
    h.db.$queryRaw.mockResolvedValueOnce([{ locked: false }] as never);
    const run = await processPriceChanges({ now: NOW });
    expect(run.busy).toBe(true);
    expect(h.email).not.toHaveBeenCalled();
  });

  it("the notice is recorded before the email goes out, and a known send failure goes back to waiting", async () => {
    const { a } = await raiseTwo();
    h.email.mockImplementationOnce(async () => {
      expect(item(a.userId)).toMatchObject({ status: "notifying" });
      expect(item(a.userId).noticeSentAt).toEqual(NOW);
      return false;
    });
    await processPriceChanges({ now: NOW });
    expect(item(a.userId)).toMatchObject({ status: "pending", noticeSentAt: null });
  });

  it("Resend switched off in the admin console: no notice is sent, nothing is claimed or counted, and it goes out once it is back on", async () => {
    const { a, b } = await raiseTwo();
    const { clearSwitchCache } = await import("@/lib/admin/switch");
    const db = h.db as unknown as { serviceSwitch?: { findMany: () => Promise<{ service: string }[]> } };
    db.serviceSwitch = { findMany: async () => [{ service: "resend" }] };
    clearSwitchCache();
    try {
      for (let i = 0; i < 7; i++) await processPriceChanges({ now: NOW }); // more runs than MAX_ATTEMPTS
      expect(h.email).not.toHaveBeenCalled();
      for (const u of [a, b]) {
        expect(item(u.userId)).toMatchObject({ status: "pending", noticeSentAt: null });
        expect(item(u.userId).attempts ?? 0).toBe(0);
      }
    } finally {
      db.serviceSwitch = undefined;
      clearSwitchCache();
    }
    await processPriceChanges({ now: NOW });
    expect(h.email).toHaveBeenCalledTimes(2);
    for (const u of [a, b]) expect(item(u.userId).status).toBe("notified");
  });

  it("a Stop pressed during a run beats the swap: the client is not swapped and stays skipped", async () => {
    const { a, b } = await raiseTwo();
    await processPriceChanges({ now: NOW });
    const changeId = h.db.planPriceChange.rows.find((c) => c.status === "scheduled")!.id;
    const day = new Date(item(a.userId).effectiveAt.getTime() - DAY);
    h.getSub.mockImplementation(async (subId: string) => {
      const it = h.db.planPriceChangeItem.rows.find((i) => i.providerSubscriptionId === subId)!;
      await cancelPriceChange(CONSOLE, changeId); // the admin presses Stop while the run is talking to Paddle
      return live(it);
    });
    const run = await processPriceChanges({ now: day });
    expect(h.swap).not.toHaveBeenCalled();
    expect(run.applied).toBe(0);
    expect(item(a.userId).status).toBe("skipped");
    expect(item(b.userId).status).toBe("skipped");
  });

  it("a newer price change that replaced the target stops the old swap", async () => {
    const { a } = await raiseTwo();
    await processPriceChanges({ now: NOW });
    const day = new Date(item(a.userId).effectiveAt.getTime() - DAY);
    h.getSub.mockImplementation(async () => {
      await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 6900 }, { confirmPriceChange: true }); // replaces the monthly target
      return live(item(a.userId));
    });
    await processPriceChanges({ now: day });
    expect(h.swap).not.toHaveBeenCalled();
    expect(h.db.planPriceChangeItem.rows.filter((i) => i.userId === a.userId).map((i) => i.status).sort()).toEqual(["pending", "skipped"]);
  });

  it("work left half-done by a dead run: a swap is repeated, an unknown notice is not resent or swapped", async () => {
    const { a, b } = await raiseTwo();
    await processPriceChanges({ now: NOW });
    const old = new Date(NOW.getTime() - 3_600_000);
    Object.assign(item(a.userId), { status: "swapping", updatedAt: old });
    Object.assign(item(b.userId), { status: "notifying", updatedAt: old });
    h.email.mockClear();
    const run = await processPriceChanges({ now: NOW });
    expect(run.recovered).toBe(2);
    expect(item(a.userId).status).toBe("notified");
    expect(item(b.userId)).toMatchObject({ status: "failed", noticeSentAt: null });
    expect(item(b.userId).error).toMatch(/not known whether it went out/);
    expect(h.email).not.toHaveBeenCalled();
    expect(h.swap).not.toHaveBeenCalled();
  });

  it("an admin can retry failed clients: a client with a notice goes back to the swap, one without is notified again", async () => {
    const { a, b } = await raiseTwo();
    await processPriceChanges({ now: NOW });
    Object.assign(item(a.userId), { status: "failed", error: "Paddle API 422" });
    Object.assign(item(b.userId), { status: "failed", noticeSentAt: null, effectiveAt: null });
    const { retryFailedPriceItems } = await import("@/lib/admin/plans-service");
    const changeId = item(a.userId).changeId;
    await retryFailedPriceItems(CONSOLE, changeId);
    expect(item(a.userId).status).toBe("notified");
    expect(item(b.userId).status).toBe("pending");
    expect(h.db.planPriceChange.rows.find((c) => c.id === changeId)).toMatchObject({ status: "scheduled" });
    expect(audits().map((x) => x.action)).toContain("retry_price_change");
  });
});

describe("clients who ended up on an old price are brought along", () => {
  it("a checkout finished against the old price, and a cancelling client who resumed, get a notice and a move", async () => {
    const early = seedSub({ cancelAtPeriodEnd: true, providerPriceId: "pri_std_m", currentPeriodEnd: new Date(NOW.getTime() + 60 * DAY) }); // leaving: not moved at change time
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900 }, { confirmPriceChange: true });
    expect(h.db.planPriceChangeItem.rows).toHaveLength(0);
    const stale = seedSub({ providerPriceId: "pri_std_m", currentPeriodEnd: new Date(NOW.getTime() + 50 * DAY) }); // bought against the 30 s cache
    h.db.subscription.rows.find((r) => r.userId === early.userId)!.cancelAtPeriodEnd = false; // changed their mind
    const run = await processPriceChanges({ now: NOW });
    expect(run.reconciled).toBe(2);
    expect(run.notified).toBe(2);
    const mine = h.db.planPriceChangeItem.rows.filter((i) => [early.userId, stale.userId].includes(i.userId));
    expect(mine.map((i) => [i.oldCents, i.newCents, i.status])).toEqual([[4900, 5900, "notified"], [4900, 5900, "notified"]]);
    for (const i of mine) expect(i.effectiveAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 30 * DAY);
    expect(h.email).toHaveBeenCalledTimes(2);
    // and nobody is added twice
    expect((await processPriceChanges({ now: new Date(NOW.getTime() + DAY) })).reconciled).toBe(0);
  });

  it("a paused client waits and is moved after they resume, never skipped", async () => {
    const p = seedSub({ currentPeriodEnd: new Date(NOW.getTime() + 45 * DAY) });
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900 }, { confirmPriceChange: true });
    await processPriceChanges({ now: NOW });
    const it = h.db.planPriceChangeItem.rows[0];
    h.getSub.mockResolvedValue({ status: "paused", priceId: "pri_std_m", nextBilledAt: null, periodEnd: null, cancelScheduled: false });
    const day = new Date(it.effectiveAt.getTime() - DAY);
    expect((await processPriceChanges({ now: day })).waiting).toBe(1);
    expect(it.status).toBe("notified");
    // resumed, next bill is 5 days after the notice: too soon, so it is pushed a period
    h.getSub.mockResolvedValue({ status: "active", priceId: "pri_std_m", nextBilledAt: new Date(NOW.getTime() + 5 * DAY), periodEnd: null, cancelScheduled: false });
    await processPriceChanges({ now: new Date(NOW.getTime() + 4 * DAY) });
    expect(h.swap).not.toHaveBeenCalled();
    expect(it.effectiveAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 30 * DAY);
    void p;
  });
});

describe("editing one price leaves the other interval's moves alone", () => {
  it("a monthly-only change keeps yearly clients' notice and date, and does not email them again", async () => {
    const m = seedSub({ interval: "MONTH", providerPriceId: "pri_std_m", currentPeriodEnd: new Date(NOW.getTime() + 45 * DAY) });
    const y = seedSub({ interval: "YEAR", providerPriceId: "pri_std_y", currentPeriodEnd: new Date(NOW.getTime() + 200 * DAY) });
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 59000 }, { confirmPriceChange: true });
    await processPriceChanges({ now: NOW });
    const yearly = () => h.db.planPriceChangeItem.rows.find((i) => i.userId === y.userId && i.status !== "skipped")!;
    const before = { id: yearly().id, noticeSentAt: yearly().noticeSentAt, effectiveAt: yearly().effectiveAt };
    h.email.mockClear();
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 6900 }, { confirmPriceChange: true });
    expect(yearly()).toMatchObject({ id: before.id, status: "notified", noticeSentAt: before.noticeSentAt, effectiveAt: before.effectiveAt });
    const newChange = h.db.planPriceChange.rows.find((c) => c.status === "scheduled")!;
    expect(yearly().changeId).toBe(newChange.id);
    expect(newChange.subscribers).toBe(2);
    expect(h.db.planPriceChangeItem.rows.find((i) => i.userId === m.userId && i.status === "pending")).toMatchObject({ newCents: 6900 });
    await processPriceChanges({ now: new Date(NOW.getTime() + DAY) });
    expect(h.email).toHaveBeenCalledTimes(1); // the monthly client, with the new price; the yearly client is not emailed again
    expect(h.email.mock.calls[0][0].to).toBe("client1@example.com");
  });
});

describe("price history is not wiped by archiving", () => {
  it("does not write a stale copy over a plan that changed meanwhile", async () => {
    seedSub({});
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 3900, yearlyPriceCents: 39000 }, { confirmPriceChange: true });
    h.db.subscription.rows[0].providerPriceId = plan("STANDARD").paddleMonthlyPriceId;
    h.archivePrice.mockImplementation(async () => {
      // somebody changes the price while the archive call is in flight
      plan("STANDARD").paddlePrices = [...plan("STANDARD").paddlePrices, { id: "pri_concurrent", interval: "MONTH", amountCents: 1, createdAt: new Date().toISOString() }];
      plan("STANDARD").updatedAt = new Date("2026-10-10T00:00:00Z");
    });
    const { archiveUnusedPrices } = await import("@/lib/billing/price-changes");
    await archiveUnusedPrices(NOW);
    expect(plan("STANDARD").paddlePrices.some((p: { id: string }) => p.id === "pri_concurrent")).toBe(true);
  });
});

describe("a stale form cannot overwrite another admin's edit", () => {
  it("refuses a save made from an older version of the plan", async () => {
    const opened = (await getPlans({ force: true })).find((p) => p.key === "PRO")!.updatedAt!.toISOString();
    await updatePlan(CONSOLE, "PRO", { description: "Other admin" });
    plan("PRO").updatedAt = new Date("2026-10-10T00:00:00Z"); // the fake database does not bump it
    resetPlanCache();
    const err = await updatePlan(CONSOLE, "PRO", { name: "Mine" }, { expectedVersion: opened }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.code).toBe("conflict");
    expect(err.message).toMatch(/changed since you opened it/);
    expect(plan("PRO").name).toBe("Pro");
    await updatePlan(CONSOLE, "PRO", { name: "Mine" }, { expectedVersion: "2026-10-10T00:00:00.000Z" });
    expect(plan("PRO").name).toBe("Mine");
  });
});

describe("renewal dates", () => {
  it("every step is counted from the original date, so month ends do not drift", () => {
    const jan31 = new Date("2026-01-31T00:00:00Z");
    expect(firstRenewalOnOrAfter(jan31, "MONTH", new Date("2026-03-30T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(firstRenewalOnOrAfter(jan31, "MONTH", new Date("2026-02-15T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(firstRenewalOnOrAfter(new Date("2028-02-29T00:00:00Z"), "YEAR", new Date("2029-03-01T00:00:00Z")).toISOString().slice(0, 10)).toBe("2030-02-28");
  });
});

describe("second reminder for notices sent long ahead", () => {
  it("a yearly client is reminded once, about 30 days before the renewal; a monthly client is not", async () => {
    seedSub({ interval: "MONTH", providerPriceId: "pri_std_m", currentPeriodEnd: new Date(NOW.getTime() + 45 * DAY) });
    const y = seedSub({ interval: "YEAR", providerPriceId: "pri_std_y", currentPeriodEnd: new Date(NOW.getTime() + 300 * DAY) });
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 59000 }, { confirmPriceChange: true });
    await processPriceChanges({ now: NOW });
    expect(h.email).toHaveBeenCalledTimes(2);
    h.email.mockClear();
    h.getSub.mockImplementation(async (subId: string) => {
      const it = h.db.planPriceChangeItem.rows.find((i) => i.providerSubscriptionId === subId)!;
      return { status: "active", priceId: it.oldPriceId, nextBilledAt: it.effectiveAt, periodEnd: null, cancelScheduled: false };
    });
    const yearly = h.db.planPriceChangeItem.rows.find((i) => i.userId === y.userId)!;
    await processPriceChanges({ now: new Date(NOW.getTime() + 200 * DAY) }); // 100 days before: too early
    expect(h.email).not.toHaveBeenCalled();
    const run = await processPriceChanges({ now: new Date(yearly.effectiveAt.getTime() - 29 * DAY) });
    expect(run.reminded).toBe(1);
    expect(h.email).toHaveBeenCalledTimes(1);
    expect(h.email.mock.calls[0][0]).toMatchObject({ to: "client2@example.com" });
    expect(h.email.mock.calls[0][0].subject).toMatch(/^Reminder: your BuPulse Standard price changes on/);
    expect(yearly.reminderSentAt).toBeTruthy();
    await processPriceChanges({ now: new Date(yearly.effectiveAt.getTime() - 20 * DAY) });
    expect(h.email).toHaveBeenCalledTimes(1); // once only
    expect(yearly.status).toBe("notified"); // the reminder never moves the client
    expect(h.swap).not.toHaveBeenCalledWith(y.subId, expect.anything());
  });

  it("a reminder whose send failed is tried again, and is not claimed twice", async () => {
    const y = seedSub({ interval: "YEAR", providerPriceId: "pri_std_y", currentPeriodEnd: new Date(NOW.getTime() + 300 * DAY) });
    await updatePlan(CONSOLE, "STANDARD", { yearlyPriceCents: 59000 }, { confirmPriceChange: true });
    await processPriceChanges({ now: NOW });
    const it = h.db.planPriceChangeItem.rows.find((i) => i.userId === y.userId)!;
    h.getSub.mockResolvedValue({ status: "active", priceId: "pri_std_y", nextBilledAt: it.effectiveAt, periodEnd: null, cancelScheduled: false });
    h.email.mockClear();
    h.email.mockResolvedValueOnce(false);
    const day = new Date(it.effectiveAt.getTime() - 25 * DAY);
    await processPriceChanges({ now: day });
    expect(it.reminderSentAt ?? null).toBeNull();
    await processPriceChanges({ now: new Date(day.getTime() + DAY) });
    expect(it.reminderSentAt).toBeTruthy();
    expect(h.email).toHaveBeenCalledTimes(2);
  });
});

describe("a notice that can never be sent is given up on, visibly", () => {
  it("no email address: failed after 5 tries with a reason, shown in the admin, and retryable", async () => {
    const x = seedSub({ currentPeriodEnd: new Date(NOW.getTime() + 45 * DAY) });
    h.db.user.rows.find((u) => u.id === x.userId)!.email = null;
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900 }, { confirmPriceChange: true });
    const it = h.db.planPriceChangeItem.rows[0];
    for (let day = 0; day < 4; day++) await processPriceChanges({ now: new Date(NOW.getTime() + day * DAY) });
    expect(it).toMatchObject({ status: "pending", attempts: 4 });
    const { getAdminPlan, retryFailedPriceItems } = await import("@/lib/admin/plans-service");
    expect((await getAdminPlan("STANDARD")).struggling).toBe(1);
    const run = await processPriceChanges({ now: new Date(NOW.getTime() + 4 * DAY) });
    expect(run.failed).toBe(1);
    expect(it.status).toBe("failed");
    expect(it.error).toMatch(/no email address.*Gave up after 5 tries/);
    expect(h.email).not.toHaveBeenCalled();
    expect((await getAdminPlan("STANDARD")).failedItems).toHaveLength(1);
    await retryFailedPriceItems(CONSOLE, it.changeId);
    expect(it).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("an unknown renewal date and a refusing email service count the same way", async () => {
    seedSub({ currentPeriodEnd: null });
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900 }, { confirmPriceChange: true });
    const it = h.db.planPriceChangeItem.rows[0];
    await processPriceChanges({ now: NOW });
    expect(it).toMatchObject({ status: "pending", attempts: 1 });
    expect(it.error).toMatch(/renewal date/);
    h.db.subscription.rows[0].currentPeriodEnd = new Date(NOW.getTime() + 45 * DAY);
    h.email.mockResolvedValue(false);
    await processPriceChanges({ now: NOW });
    expect(it).toMatchObject({ status: "pending", attempts: 2, noticeSentAt: null });
  });
});

describe("the scheduled job leaves audit rows", () => {
  it("one row per archived price and one summary per busy run, none on a quiet one", async () => {
    const x = seedSub({ currentPeriodEnd: new Date(NOW.getTime() + 45 * DAY) });
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 59000 }, { confirmPriceChange: true });
    audits().length = 0;
    await processPriceChanges({ now: NOW });
    const actions = audits().map((a) => a.action);
    expect(actions).toContain("archive_paddle_price"); // the old yearly price: nobody is on it
    expect(actions.filter((a) => a === "price_change_run")).toHaveLength(1);
    expect(audits().every((a) => a.actor === "system:cron")).toBe(true);
    expect(audits().find((a) => a.action === "archive_paddle_price")).toMatchObject({ target: "plan:STANDARD", before: { priceId: "pri_std_y" } });
    expect(audits().find((a) => a.action === "price_change_run")!.after).toMatchObject({ notified: 1, archivedPrices: 1 });
    audits().length = 0;
    expect(x.userId).toBeTruthy();
    await processPriceChanges({ now: new Date(NOW.getTime() + DAY) });
    expect(audits().filter((a) => a.action === "price_change_run")).toHaveLength(0);
  });
});

describe("putting a plan on sale", () => {
  it("without Paddle a draft cannot go active, and limit-only edits of a selling plan still work", async () => {
    h.connected = false;
    await createPlan(CONSOLE, { key: "dd", name: "DD", monthlyPriceCents: 1000, yearlyPriceCents: 10000, status: "active" });
    expect(plan("dd").status).toBe("hidden");
    expect(await code(updatePlan(CONSOLE, "dd", { status: "active" }))).toBe("conflict");
    h.connected = true;
    delete process.env.PADDLE_PRICE_STANDARD_MONTH; // an active plan whose ids are not (yet) known to this process
    delete process.env.PADDLE_PRICE_STANDARD_YEAR;
    resetPlanCache();
    await updatePlan(CONSOLE, "STANDARD", { limits: { text: 150 } });
    expect(plan("STANDARD").limits.text).toBe(150);
  });
});

describe("old prices in the admin", () => {
  it("shows an old price as used only while somebody pays it or is waiting to leave it", async () => {
    seedSub({ interval: "MONTH", providerPriceId: "pri_std_m" });
    await updatePlan(CONSOLE, "STANDARD", { monthlyPriceCents: 5900, yearlyPriceCents: 59000 }, { confirmPriceChange: true });
    const { getAdminPlan } = await import("@/lib/admin/plans-service");
    const { priceUse } = await getAdminPlan("STANDARD");
    expect(priceUse).toEqual({ pri_std_m: 2, pri_std_y: 0 }); // the client's subscription and their waiting move
  });
});

describe("team seats", () => {
  it("are part of the plan: seeded 1 / 3 / 10, defaulted for rows saved before seats existed, clamped 1..1000", async () => {
    const { cleanLimits } = await import("@/lib/plan-catalog");
    expect(SEED_PLANS.TRIAL.limits.seats).toBe(1);
    expect(SEED_PLANS.STANDARD.limits.seats).toBe(3);
    expect(SEED_PLANS.PRO.limits.seats).toBe(10);
    expect(cleanLimits({ seats: 0 }).seats).toBe(1);
    expect(cleanLimits({ seats: 5000 }).seats).toBe(1000);
    expect(cleanLimits({ seats: 2.5 }).seats).toBe(1);
    // the rows in the fake database have no seats yet: the loader falls back to the seeded numbers, 1 for new plans
    for (const r of h.db.planDefinition.rows) delete r.limits.seats;
    resetPlanCache();
    expect((await getPlans()).map((p) => [p.key, p.limits.seats])).toEqual([["TRIAL", 1], ["STANDARD", 3], ["PRO", 10]]);
    await createPlan(CONSOLE, { key: "seat-less", name: "S", monthlyPriceCents: 100, yearlyPriceCents: 1000 });
    expect(plan("seat-less").limits.seats).toBe(1);
  });

  it("can be edited, validated, audited, and never touch the usage metrics", async () => {
    await updatePlan(CONSOLE, "STANDARD", { limits: { seats: 5 } });
    expect(plan("STANDARD").limits).toMatchObject({ seats: 5, text: 100 });
    expect(audits()[0]).toMatchObject({ action: "update_plan", before: { limits: expect.objectContaining({ seats: 3 }) }, after: { limits: expect.objectContaining({ seats: 5 }) } });
    expect(await code(updatePlan(CONSOLE, "STANDARD", { limits: { seats: 0 } }))).toBe("invalid");
    expect(await code(updatePlan(CONSOLE, "STANDARD", { limits: { seats: 1001 } }))).toBe("invalid");
    const { USAGE_METRICS } = await import("@/lib/plans");
    expect(USAGE_METRICS).not.toContain("seats");
    await svc.updatePlanLimits(API, { plan: "STANDARD", limits: { seats: null }, confirm: true });
    expect(plan("STANDARD").limits.seats).toBe(3);
  });
});
