import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Adding features to a card plan (lib/offers/card-plan.ts, docs/OFFERS.md "Adding features to a card plan"): the same
// list and rules as Mobile Money's "Add features", each feature a recurring item on the client's Paddle subscription at
// the card rule of plans, charged now prorated; Paddle's answer (and its webhook) switches the custom plan on and
// settles the offer, once. Paddle is a fake that keeps the subscription's items like the real one does.

type Item = { quantity: number; price: { id: string; custom_data: Record<string, unknown> | null; unit_price: { amount: string } } };

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  cardOn: true,
  logError: vi.fn<(error: unknown, context?: Record<string, unknown>) => Promise<void>>(async () => {}),
  paddle: { items: [] as Item[], status: "active", scheduled: null as null | { action: string; effective_at: string }, n: 0, updatedAt: 0 },
  add: vi.fn(),
  get: vi.fn(),
  fail: null as Error | null,
  /** Paddle made the change but the answer was lost. */
  lose: false,
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: h.logError }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: vi.fn(async () => true) }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/switch", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/switch")>()), isServiceEnabled: async () => true }));
vi.mock("@/lib/billing/card-ready", () => ({ cardCheckoutConfigured: async () => h.cardOn, cardPricedPlans: async () => ({}), invoicePayMethods: async () => ({ momo: "ready", card: "off" }) }));
vi.mock("@/lib/billing", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing")>()),
  activeProvider: () => "PADDLE",
  billingAdapter: () => ({ provider: "PADDLE", isConfigured: async () => true, addRecurringItems: h.add, getSubscription: h.get }),
}));

import { mapSubscription, subscriptionItemsOf } from "@/lib/billing/paddle-map";
import { applyProviderSubscription } from "@/lib/billing/apply";
import { signCheckoutUser } from "@/lib/billing/signing";
import { getSettings } from "@/lib/admin/settings";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { cardUsdCents } from "@/lib/region-format";
import * as offers from "@/lib/offers/service";
import { addFeaturesByCard, CARD_PLAN_UNAVAILABLE, CardPlanError } from "@/lib/offers/card-plan";
import { cardPlanAddons, pendingCardAddition } from "@/lib/offers/card-plan-items";
import { CARD_ADDON_KIND, cardAddonMessage, cardAdditionQuote, customPlanKeyFor, readCardPlan } from "@/lib/offers/shared";
import type { NewRecurringItem } from "@/lib/billing/types";

const USER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-13T08:00:00Z");
const END = new Date("2026-11-01T00:00:00Z");
const PLAN_PRICE = "pri_std_m";
const sub = () => h.db.subscription.rows.find((r) => r.userId === USER)!;
const offerRow = (id: string) => h.db.planOffer.rows.find((r) => r.id === id)!;
const err = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** The subscription as Paddle would send it (its own order of items: added features first, to prove order does not matter). */
const raw = () => ({
  id: "sub_1",
  status: h.paddle.status,
  customer_id: "ctm_1",
  currency_code: "USD",
  items: [...h.paddle.items.filter((i) => i.price.custom_data?.kind === CARD_ADDON_KIND), ...h.paddle.items.filter((i) => i.price.custom_data?.kind !== CARD_ADDON_KIND)],
  current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: END.toISOString() },
  scheduled_change: h.paddle.scheduled,
  updated_at: new Date(NOW.getTime() + ++h.paddle.updatedAt * 1000).toISOString(),
  custom_data: { userId: USER },
});

function seed(over: Record<string, unknown> = {}) {
  h.db.user.rows.push({ id: USER, email: "card@example.rw", name: "Card Client", suspendedAt: null });
  h.db.business.rows.push({ id: "biz1", userId: USER, name: "Card Co", ceoName: "Card", phone: null, country: "Rwanda", pricingRegion: "RW", knowledge: null });
  h.db.subscription.rows.push({ id: "s1", userId: USER, plan: "STANDARD", status: "ACTIVE", chosenPlan: null, provider: "PADDLE", providerCustomerId: "ctm_1", providerSubscriptionId: "sub_1", providerPriceId: PLAN_PRICE, providerUpdatedAt: new Date("2026-10-01T00:00:00Z"), interval: "MONTH", cancelAtPeriodEnd: false, trialEndsAt: null, currentPeriodStart: new Date("2026-10-01T00:00:00Z"), currentPeriodEnd: END, updatedAt: NOW, ...over });
  const std = h.db.planDefinition.rows.find((r) => r.key === "STANDARD")!;
  std.featureKeys = ["content", "designs", "calendar", "gallery"];
  std.limits = { text: 200, image: 100, chat: 0, videos: 0, voiceCharacters: 0, seats: 3 };
  h.db.planRegionPrice.rows.push({ id: "prp_std", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 35000, yearlyMinor: 350000 });
  h.db.addonPrice.rows.push({ id: "a1", addonKey: "websiteChat", regionKey: "RW", currency: "RWF", monthlyMinor: 10000 }, { id: "a2", addonKey: "aiPhotos", regionKey: "RW", currency: "RWF", monthlyMinor: 8000 });
  resetRegionPriceCache();
}

const add = (features: string[], at: Date = NOW, expectedUsdCents?: number) => addFeaturesByCard({ userId: USER, actorId: USER, businessId: "biz1", features, expectedUsdCents }, at);

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  h.cardOn = true;
  h.fail = null;
  h.lose = false;
  h.paddle.items = [{ quantity: 1, price: { id: PLAN_PRICE, custom_data: null, unit_price: { amount: "2500" } } }];
  h.paddle.status = "active";
  h.paddle.scheduled = null;
  h.paddle.n = 0;
  h.paddle.updatedAt = 0;
  // Paddle: every current item is kept, the new prices are added (an id each), all at once or not at all.
  h.add.mockImplementation(async (_id: string, items: NewRecurringItem[]) => {
    if (h.fail) throw h.fail;
    for (const i of items) h.paddle.items.push({ quantity: 1, price: { id: `pri_add_${++h.paddle.n}`, custom_data: i.customData, unit_price: { amount: String(i.amountCents) } } });
    if (h.lose) throw new TypeError("fetch failed");
    return mapSubscription(raw())!;
  });
  h.get.mockImplementation(async () => mapSubscription(raw())!);
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  process.env.ENCRYPTION_KEY = "test-key";
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.com";
  process.env.PADDLE_PRICE_STANDARD_MONTH = PLAN_PRICE;
  process.env.PADDLE_PRICE_STANDARD_YEAR = "pri_std_y";
});

const rate = async () => {
  const s = await getSettings();
  return (rwf: number) => cardUsdCents(rwf, "RWF", s.usdToRwf, s.cardMarginPercent);
};

describe("the card price of added features (pure)", () => {
  it("each feature's regional price for a period at the card rule of plans, and the charge now for the days left", () => {
    const q = cardAdditionQuote({ lines: [{ key: "websiteChat", label: "Website chat", quantity: 1, unitMinor: 10000, totalMinor: 10000 }, { key: "free", label: "Free", quantity: 1, unitMinor: 0, totalMinor: 0 }], currency: "RWF", usdToRwf: 1450, marginPercent: 12, interval: "MONTH", periodEnd: END, now: NOW });
    // 10,000 RWF / 1,450 x 1.12 = $7.72 -> $8; 19 of 31 days left -> $4.90.
    expect(q).toEqual({ items: [{ key: "websiteChat", label: "Website chat", usdCents: 800 }], perPeriodUsdCents: 800, dueNowUsdCents: 490, daysLeft: 19, periodDays: 31 });
  });

  it("Paddle's items in any order: the plan's own price is the one that is not an added feature", () => {
    const data = { ...raw(), items: [{ quantity: 1, price: { id: "pri_add_9", custom_data: { kind: CARD_ADDON_KIND, key: "aiPhotos", offerId: "o1", userId: USER, sig: "x" }, unit_price: { amount: "400" } } }, ...h.paddle.items] };
    const mapped = mapSubscription(data)!;
    expect(mapped.providerPriceId).toBe(PLAN_PRICE);
    expect(mapped.addons).toEqual([{ priceId: "pri_add_9", key: "aiPhotos", offerId: "o1", userId: USER, sig: "x", amountCents: 400 }]);
    expect(mapSubscription(raw())!.addons).toBeUndefined();
    expect(subscriptionItemsOf(data)).toEqual([{ priceId: PLAN_PRICE, quantity: 1, addon: false }, { priceId: "pri_add_9", quantity: 1, addon: true }]);
  });
});

describe("what a card plan sees on Billing", () => {
  it("the same features to add, as a card plan", async () => {
    seed();
    const s = await offers.selfServeAddition("biz1", NOW);
    expect(s).toMatchObject({ ok: true, method: "card", addable: expect.arrayContaining(["websiteChat", "aiPhotos"]) });
  });

  it("set to end, or past due: nothing can be added, and it says why", async () => {
    seed({ cancelAtPeriodEnd: true });
    expect(await offers.selfServeAddition("biz1", NOW)).toMatchObject({ ok: false, card: true, reason: "Your plan is set to end on 1 November 2026, so nothing can be added to it. Renew it from 25 October 2026, then add the features here." });
    expect((await err(add(["websiteChat"])))?.message).toMatch(/set to end on 1 November 2026/);
    Object.assign(sub(), { cancelAtPeriodEnd: false, status: "PAST_DUE" });
    expect(await offers.selfServeAddition("biz1", NOW)).toMatchObject({ ok: false, card: true, reason: expect.stringMatching(/did not go through\. Update your payment method/) });
    expect(h.add).not.toHaveBeenCalled();
  });

  it("never 'ask us for a card link'; Mobile Money, invoice and one-off card are refused for a card plan", async () => {
    seed();
    const s = await offers.selfServeAddition("biz1", NOW);
    expect(JSON.stringify(s)).not.toMatch(/card link/i);
    expect((await err(offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["websiteChat"], method: "momo" }, NOW)))?.message).toMatch(/Add to my card plan/);
    expect((await err(offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["websiteChat"], method: "card" }, NOW)))?.message).toMatch(/Add to my card plan/);
    expect(h.db.planOffer.rows).toHaveLength(0);
  });
});

describe("Add to my card plan", () => {
  it("one recurring item per feature on the card subscription; Paddle's answer switches the custom plan on and settles the offer", async () => {
    seed();
    const usd = await rate();
    const done = await add(["websiteChat"], NOW, usd(10000));
    expect(done).toMatchObject({ applied: true, added: ["Website chat and leads"], quote: { perPeriodUsdCents: usd(10000), daysLeft: 19, periodDays: 31 } });

    const [subscriptionId, items] = h.add.mock.calls[0] as [string, NewRecurringItem[]];
    const offerId = h.db.planOffer.rows[0].id as string;
    expect(subscriptionId).toBe("sub_1");
    expect(items).toEqual([{ name: "BuPulse Website chat and leads", description: "Website chat and leads, added to your BuPulse plan", amountCents: usd(10000), currency: "USD", interval: "MONTH", customData: { kind: CARD_ADDON_KIND, key: "websiteChat", offerId, userId: USER, sig: await signCheckoutUser(cardAddonMessage(offerId, USER)) } }]);

    const key = customPlanKeyFor(offerId);
    // Still the same card subscription and price; the plan is the custom plan; the period does not move.
    expect(sub()).toMatchObject({ plan: key, provider: "PADDLE", providerSubscriptionId: "sub_1", providerPriceId: PLAN_PRICE, status: "ACTIVE", currentPeriodEnd: END });
    const plan = h.db.planDefinition.rows.find((r) => r.key === key)!;
    expect(plan.featureKeys).toEqual(expect.arrayContaining(["content", "designs", "websiteChat"]));
    expect(offerRow(offerId)).toMatchObject({ status: "paid", paidBy: "card:sub_1", payMethod: "card" });
    expect(readCardPlan(offerRow(offerId).options)).toMatchObject({ subscriptionId: "sub_1", basePlanKey: "STANDARD", addedUsdCents: usd(10000), addonsUsdCents: usd(10000), items: [{ key: "websiteChat", usdCents: usd(10000) }] });
    expect(h.db.auditLog.rows.map((a) => a.action)).toEqual(expect.arrayContaining(["self_serve_addition", "accept_offer", "card_plan_addition", "offer_paid"]));
    // Billing: the card plan's price is the plan's plus the added features', and the offer has no pay buttons.
    expect(await cardPlanAddons("biz1", key)).toMatchObject({ usdCents: usd(10000), labels: ["Website chat and leads"] });
    expect(await offers.clientOffer("biz1", NOW)).toBeNull();
  });

  it("the webhook of the same change, and every renewal after, keep the custom plan and settle nothing twice", async () => {
    seed();
    await add(["websiteChat"]);
    const key = sub().plan;
    expect(await applyProviderSubscription("PADDLE", mapSubscription(raw())!)).toBe("applied");
    expect(await applyProviderSubscription("PADDLE", mapSubscription(raw())!)).toBe("applied");
    expect(sub().plan).toBe(key);
    expect(h.db.auditLog.rows.filter((a) => a.action === "offer_paid")).toHaveLength(1);
  });

  it("a second addition on top: every earlier item kept, the newest custom plan, the card price adding up", async () => {
    seed();
    const usd = await rate();
    await add(["websiteChat"]);
    const done = await add(["aiPhotos"], later(5 * 60_000));
    expect(done.applied).toBe(true);
    expect(h.paddle.items.map((i) => i.price.id)).toEqual([PLAN_PRICE, "pri_add_1", "pri_add_2"]);
    const second = h.db.planOffer.rows.find((r) => r.status === "paid" && readCardPlan(r.options)?.items[0]?.key === "aiPhotos")!;
    expect(sub().plan).toBe(customPlanKeyFor(second.id as string));
    expect(h.db.planDefinition.rows.find((r) => r.key === sub().plan)!.featureKeys).toEqual(expect.arrayContaining(["websiteChat", "aiPhotos"]));
    expect(await cardPlanAddons("biz1", sub().plan)).toMatchObject({ usdCents: usd(10000) + usd(8000), labels: expect.arrayContaining(["Website chat and leads", "AI photos"]) });
  });

  it("a plan change (only the new price) ends the added features: back to the plan's own", async () => {
    seed();
    await add(["websiteChat"]);
    h.paddle.items = h.paddle.items.filter((i) => i.price.id === PLAN_PRICE);
    await applyProviderSubscription("PADDLE", mapSubscription(raw())!);
    expect(sub().plan).toBe("STANDARD");
  });

  it("the card price changed since the page loaded: the new price to confirm, nothing charged or made", async () => {
    seed();
    const usd = await rate();
    const e = (await err(add(["websiteChat"], NOW, usd(10000) - 100))) as CardPlanError;
    expect(e).toBeInstanceOf(CardPlanError);
    expect(e.requoteUsdCents).toBe(usd(10000));
    expect(e.message).toMatch(/card price is now \$\d+ a month/);
    expect(h.add).not.toHaveBeenCalled();
    expect(h.db.planOffer.rows).toHaveLength(0);
  });

  it("a declined card: nothing added, the offer withdrawn, the plan as it was, said plainly", async () => {
    seed();
    h.fail = new Error("Paddle API 400 on /subscriptions/sub_1: subscription_payment_declined The payment was declined");
    expect((await err(add(["websiteChat"])))?.message).toBe("Your card was declined, so nothing was added or charged. Update your card with Payment method above, then try again.");
    const offer = h.db.planOffer.rows[0];
    expect(offer).toMatchObject({ status: "withdrawn" });
    expect(h.db.planDefinition.rows.find((r) => r.key === offer.customPlanKey)).toMatchObject({ status: "retired" });
    expect(sub().plan).toBe("STANDARD");
    expect(h.paddle.items).toHaveLength(1);
  });

  it("card not set up, or a Paddle key without the permission: the last resort, worded nicely", async () => {
    seed();
    h.cardOn = false;
    expect((await err(add(["websiteChat"])))?.message).toBe(CARD_PLAN_UNAVAILABLE);
    expect(h.add).not.toHaveBeenCalled();
    h.cardOn = true;
    h.fail = new Error("Paddle API 403 on /subscriptions/sub_1: forbidden You aren't permitted to perform this request");
    expect((await err(add(["websiteChat"])))?.message).toBe(CARD_PLAN_UNAVAILABLE);
    expect(CARD_PLAN_UNAVAILABLE).toMatch(/^Adding features by card is not available right now\. Write to us at .+ and we will add them to your plan for you\.$/);
    expect(h.logError.mock.calls.some((c) => (c[1] as { level?: string }).level === "error")).toBe(true);
  });

  it("a lost answer: Billing waits, a quick retry is held, the next one settles it from Paddle and never adds twice", async () => {
    seed();
    h.lose = true;
    expect((await err(add(["websiteChat"])))?.message).toMatch(/could not hear back from the card provider/);
    const offerId = h.db.planOffer.rows[0].id as string;
    expect(offerRow(offerId).status).toBe("accepted");
    expect(sub().plan).toBe("STANDARD");
    expect(await pendingCardAddition("biz1")).toMatchObject({ labels: ["Website chat and leads"] });
    expect(await offers.clientOffer("biz1", NOW)).toBeNull();

    h.lose = false;
    expect((await err(add(["websiteChat"], later(30_000))))?.message).toMatch(/still going through/);
    expect((await err(add(["websiteChat"], later(2 * 60_000))))?.message).toMatch(/earlier change went through: Website chat and leads is on/);
    expect(h.add).toHaveBeenCalledTimes(1);
    expect(sub().plan).toBe(customPlanKeyFor(offerId));
    expect(offerRow(offerId).status).toBe("paid");
  });

  it("added items BuPulse did not sign are not trusted: the plan's own features, logged for the owner", async () => {
    seed();
    h.paddle.items.push({ quantity: 1, price: { id: "pri_forged", custom_data: { kind: CARD_ADDON_KIND, key: "websiteChat", offerId: "o_forged", userId: USER, sig: "nope" }, unit_price: { amount: "100" } } });
    await applyProviderSubscription("PADDLE", mapSubscription(raw())!);
    expect(sub().plan).toBe("STANDARD");
    expect(h.logError.mock.calls.some((c) => (c[1] as { source?: string }).source === "billing.card_addons")).toBe(true);
  });
});
