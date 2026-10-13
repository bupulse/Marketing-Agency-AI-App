import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Adding features to a paid plan mid-period (docs/OFFERS.md, "Adding features to a paid plan"): the proration maths
// (rounding, 0 days left, same day), the next-renewal total, the request form's locked features with prerequisites,
// and the service: the admin's "Add to current plan", the client's own "Add features", activation on payment with the
// period end unchanged, and renewals at the full new total.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true),
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: vi.fn() }));
vi.mock("@/lib/admin/switch", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/switch")>()), isServiceEnabled: async () => true }));
vi.mock("@/lib/invoices/storage", () => ({
  INVOICE_BUCKET: "invoices",
  invoicePdfPath: (b: string, n: string) => `pdf/${b}/${n}.pdf`,
  putInvoiceObject: vi.fn(async () => undefined),
  getInvoiceObject: vi.fn(async () => null),
  removeInvoiceObject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn(async () => {}) }));

import { getPlans, resetPlanCache } from "@/lib/plan-catalog";
import { consoleContext, type AdminError } from "@/lib/admin/types";
import * as momo from "@/lib/billing/momo";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import * as offers from "@/lib/offers/service";
import { createPlanRequest } from "@/lib/offers/requests";
import {
  customPlanKeyFor,
  lockedRequestFeatures,
  periodDaysEnding,
  prorateMinor,
  quoteAddition,
  requestedFeatures,
  selfServeFeatures,
  toggleRequestFeature,
  type AddonPriceRow,
} from "@/lib/offers/shared";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";

const CONSOLE = consoleContext("198.51.100.1");
const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-13T08:00:00Z");
const LATER = new Date("2026-10-13T09:00:00Z");
const END = new Date("2026-11-01T00:00:00Z");
const msg = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const sub = () => h.db.subscription.rows.find((r) => r.userId === USER)!;
const offerRow = (id: string) => h.db.planOffer.rows.find((r) => r.id === id)!;
const audits = (action: string) => h.db.auditLog.rows.filter((r) => r.action === action);

const PRICES: [string, number][] = [["aiPhotos", 8000], ["websiteChat", 10000], ["autopilot", 20000], ["analytics", 5000]];
const RW_PRICES: AddonPriceRow[] = PRICES.map(([addonKey, monthlyMinor]) => ({ addonKey, regionKey: "RW", currency: "RWF", monthlyMinor }));
const CURRENT = { key: "STANDARD", name: "Business", priceMinor: 35000, features: ["content", "designs", "calendar", "gallery"] as const, limits: { text: 200, image: 100, chat: 0, videoSeconds: 0, voiceCharacters: 0, seats: 3 } };

function seed(over: Record<string, unknown> = {}) {
  h.db.user.rows.push({ id: USER, email: "biz1@example.rw", name: "Aline Uwase", suspendedAt: null });
  h.db.business.rows.push({ id: "biz1", userId: USER, name: "Inzu Fashion", ceoName: "Aline", phone: "+250 788 123 456", country: "Rwanda", pricingRegion: "RW", knowledge: null });
  h.db.subscription.rows.push({ id: "s_biz1", userId: USER, plan: "STANDARD", status: "ACTIVE", chosenPlan: null, provider: "MANUAL_MOMO", providerCustomerId: null, providerSubscriptionId: null, providerPriceId: null, interval: "MONTH", cancelAtPeriodEnd: false, trialEndsAt: null, currentPeriodStart: new Date("2026-10-01T00:00:00Z"), currentPeriodEnd: END, updatedAt: NOW, ...over });
  const std = h.db.planDefinition.rows.find((r) => r.key === "STANDARD")!;
  std.featureKeys = [...CURRENT.features];
  std.limits = CURRENT.limits;
  h.db.planRegionPrice.rows.push({ id: "prp_std", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 35000, yearlyMinor: 350000 });
  for (const [addonKey, monthlyMinor] of PRICES) h.db.addonPrice.rows.push({ id: `a_${addonKey}`, addonKey, regionKey: "RW", currency: "RWF", monthlyMinor });
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse Ltd" } });
  resetRegionPriceCache();
  clearMomoSettingsCache();
}

const ADDON_DRAFT = { mode: "addon", basePlanKey: null, features: ["websiteChat"], limits: { text: 200, image: 100, chat: 0, seats: 3 }, interval: "MONTH" };

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearMomoSettingsCache();
  process.env.ADMIN_EMAILS = "owner@bupulse.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.com";
});

describe("proration (pure)", () => {
  it("+10,000 RWF a month with 15 of 30 days left is 5,000 RWF; whole RWF and US cents are rounded", () => {
    expect(prorateMinor(10000, 15, 30)).toBe(5000);
    expect(prorateMinor(10000, 19, 31)).toBe(6129); // 6,129.03 -> whole francs
    expect(prorateMinor(10000, 1, 3)).toBe(3333);
    expect(prorateMinor(1999, 10, 30)).toBe(666); // $6.6633 -> 666 cents
    expect(prorateMinor(1999, 20, 30)).toBe(1333); // 1,332.67 -> 1,333 cents
  });

  it("edges: 0 days left costs nothing; nothing to add costs nothing; more days than a period (renewed early) pays them all", () => {
    expect(prorateMinor(10000, 0, 30)).toBe(0);
    expect(prorateMinor(0, 15, 30)).toBe(0);
    expect(prorateMinor(10000, 35, 30)).toBe(11667);
  });

  it("the period is the one ending at the period end (months of different lengths, and a year)", () => {
    expect(periodDaysEnding(END, "MONTH")).toBe(31);
    expect(periodDaysEnding(new Date("2027-03-01T00:00:00Z"), "MONTH")).toBe(28);
    expect(periodDaysEnding(new Date("2027-11-01T00:00:00Z"), "YEAR")).toBe(365);
  });

  it("quotes only the added features, prorated; the next renewal is the plan plus the added features", () => {
    const q = quoteAddition({ current: CURRENT, features: ["websiteChat"], interval: "MONTH", currency: "RWF", regionKey: "RW", prices: RW_PRICES, periodEnd: END, now: NOW });
    expect(q.added).toEqual(["websiteChat"]);
    expect(q.lines.map((l) => l.key)).toEqual(["websiteChat"]);
    expect(q).toMatchObject({ addonMinor: 10000, currentMinor: 35000, nextRenewalMinor: 45000, daysLeft: 19, periodDays: 31, dueNowMinor: 6129 });
    // The added feature's allowance raises its limit; no block is ever bought here.
    expect(q.limits.chat).toBe(500);
    expect(q.features).toEqual(expect.arrayContaining(["content", "designs", "calendar", "gallery", "websiteChat"]));
  });

  it("same day as the period started: the whole period; a part of a day counts as a day; at the period end: nothing", () => {
    const at = (now: Date) => quoteAddition({ current: CURRENT, features: ["websiteChat"], interval: "MONTH", currency: "RWF", regionKey: "RW", prices: RW_PRICES, periodEnd: END, now });
    expect(at(new Date("2026-10-01T00:00:00Z"))).toMatchObject({ daysLeft: 31, dueNowMinor: 10000 });
    expect(at(new Date("2026-10-31T23:00:00Z"))).toMatchObject({ daysLeft: 1, dueNowMinor: 323 });
    expect(at(END)).toMatchObject({ daysLeft: 0, dueNowMinor: 0, nextRenewalMinor: 45000 });
  });

  it("yearly: the add-on costs 10 months a year and is prorated over the year; the admin's price replaces the computed one", () => {
    const yearEnd = new Date("2027-04-13T08:00:00Z");
    const q = quoteAddition({ current: { ...CURRENT, priceMinor: 350000 }, features: ["websiteChat"], interval: "YEAR", currency: "RWF", regionKey: "RW", prices: RW_PRICES, periodEnd: yearEnd, now: NOW });
    expect(q).toMatchObject({ addonMinor: 100000, nextRenewalMinor: 450000, periodDays: 365, daysLeft: 182, dueNowMinor: Math.round((100000 * 182) / 365) });
    const discounted = quoteAddition({ current: CURRENT, features: ["websiteChat"], interval: "MONTH", currency: "RWF", regionKey: "RW", prices: RW_PRICES, periodEnd: END, now: NOW, addonMinor: 8000 });
    expect(discounted).toMatchObject({ computedMinor: 10000, addonMinor: 8000, nextRenewalMinor: 43000, dueNowMinor: Math.round((8000 * 19) / 31) });
  });

  it("self-serve: only priced, built features the plan lacks (with priced prerequisites); never Managed", () => {
    const addable = selfServeFeatures(CURRENT.features, RW_PRICES, "RW", "RWF");
    expect(addable).toEqual(["aiPhotos", "websiteChat", "autopilot", "analytics"]);
    // Analytics needs Calendar: without Calendar in the plan and without a price for it, it is not self-serve.
    expect(selfServeFeatures(["content"], RW_PRICES, "RW", "RWF")).toEqual(["websiteChat"]);
  });
});

describe("the request form: what the client has is ticked and locked", () => {
  it("locks the plan's features and their prerequisites; ticking pulls prerequisites in; a needed one cannot be unticked", () => {
    expect(lockedRequestFeatures(["aiPhotos"])).toEqual(["designs", "aiPhotos"]);
    // Owned: content. Ticking Autopilot ticks designs, calendar and gallery (not content: already in the plan).
    let selected = toggleRequestFeature(["content"], [], "autopilot", true);
    expect(selected).toEqual(["designs", "calendar", "gallery", "autopilot"]);
    // Calendar is needed by Autopilot: it stays.
    expect(toggleRequestFeature(["content"], selected, "calendar", false)).toEqual(selected);
    selected = toggleRequestFeature(["content"], selected, "autopilot", false);
    expect(selected).toEqual(["designs", "calendar", "gallery"]);
    // A feature in the plan can never be unticked or added twice.
    expect(toggleRequestFeature(["content"], selected, "content", false)).toEqual(selected);
    expect(toggleRequestFeature(["content"], selected, "content", true)).toEqual(selected);
  });

  it("the request stores only what is new on top of the plan", async () => {
    expect(requestedFeatures(["content", "designs"], ["content", "aiPhotos", "video"])).toEqual(["aiPhotos", "video"]);
    seed();
    const r = await createPlanRequest({ userId: USER, actorId: USER, businessId: "biz1", owned: [...CURRENT.features], raw: { description: "We sell shoes in Kigali.", features: ["content", "websiteChat"], source: "billing" } }, NOW);
    const row = h.db.customPlanRequest.rows.find((x) => x.id === r.id)!;
    expect(row.featureKeys).toEqual(["websiteChat"]);
    expect(row.goals).toBeNull();
    expect(h.sendEmail.mock.calls[0][0].text).not.toMatch(/Goals/);
  });
});

describe("Add to current plan (admin) -> accept -> pay -> features on", () => {
  it("prices only the added features prorated, shows the next renewal, and the payment switches them on without moving the period end", async () => {
    seed();
    const saved = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: ADDON_DRAFT }, NOW);
    expect(offerRow(saved.id)).toMatchObject({ basePlanKey: "STANDARD", adjustedMinor: 6129, computedMinor: 6129, interval: "MONTH", currency: "RWF" });
    expect(offerRow(saved.id).options).toMatchObject({ mode: "addon", addition: { currentPlanKey: "STANDARD", addonMinor: 10000, nextRenewalMinor: 45000, daysLeft: 19, periodDays: 31 } });
    await offers.sendOffer(CONSOLE, saved.id, NOW);
    const view = await offers.clientOffer("biz1", NOW);
    expect(view).toMatchObject({ totalMinor: 6129, addition: { nextRenewalMinor: 45000, renewsOn: END.toISOString(), selfServe: false } });

    // Accepted three days later: prorated again for the days left that day (16 of 31).
    const ACCEPT = new Date("2026-10-16T08:00:00Z");
    const accepted = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: saved.id, method: "momo" }, ACCEPT);
    expect(accepted.payment).toMatchObject({ amountMinor: Math.round((10000 * 16) / 31), offerId: saved.id, periodNote: null });
    expect(sub()).toMatchObject({ plan: "STANDARD" }); // nothing on before the payment
    const custom = h.db.planDefinition.rows.find((p) => p.key === customPlanKeyFor(saved.id))!;
    expect(custom).toMatchObject({ monthlyPriceCents: 45000, isCustom: true });

    await momo.submitManualProof(USER, { paymentId: accepted.payment!.id, transactionId: "MP55500011", payerPhone: "078 123 4567", network: "MTN" }, ACCEPT);
    const confirmed = await momo.confirmManualPayment(CONSOLE, accepted.payment!.id, ACCEPT);
    expect(confirmed).toMatchObject({ periodMode: "keep", plan: customPlanKeyFor(saved.id) });
    expect(sub()).toMatchObject({ plan: customPlanKeyFor(saved.id), status: "ACTIVE", provider: "MANUAL_MOMO", interval: "MONTH" });
    expect(sub().currentPeriodEnd).toEqual(END);
    expect(sub().currentPeriodStart).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(offerRow(saved.id).status).toBe("paid");
    const plan = (await getPlans({ force: true })).find((p) => p.key === customPlanKeyFor(saved.id))!;
    expect(plan.features).toEqual(expect.arrayContaining(["websiteChat", "content", "designs"]));

    // The next renewal is the full new total, in the last 7 days only.
    expect(await msg(momo.startManualPayment({ userId: USER, plan: plan.key, interval: "MONTH", now: ACCEPT }))).toMatch(/paid until 1 November 2026/);
    const renewal = await momo.startManualPayment({ userId: USER, plan: plan.key, interval: "MONTH", now: new Date("2026-10-28T08:00:00Z") });
    expect(renewal).toMatchObject({ amountMinor: 45000, offerId: null, periodNote: { mode: "extend" } });
  });

  it("refuses a card plan, a plan whose period has ended, and nothing new to add", async () => {
    seed({ provider: "PADDLE", providerSubscriptionId: "sub_1" });
    expect(await msg(offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: ADDON_DRAFT }, NOW))).toMatch(/renews by card/);
    Object.assign(sub(), { provider: "MANUAL_MOMO", providerSubscriptionId: null, currentPeriodEnd: new Date("2026-10-10T00:00:00Z") });
    expect(await msg(offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: ADDON_DRAFT }, NOW))).toMatch(/period has ended/);
    sub().currentPeriodEnd = END;
    expect(await msg(offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: { ...ADDON_DRAFT, features: ["content"] } }, NOW))).toMatch(/Tick at least one feature/);
  });

  it("a plan changed between accepting and confirming: the payment is refused, nothing switches", async () => {
    seed();
    const saved = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: ADDON_DRAFT }, NOW);
    await offers.sendOffer(CONSOLE, saved.id, NOW);
    const accepted = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: saved.id, method: "momo" }, NOW);
    await momo.submitManualProof(USER, { paymentId: accepted.payment!.id, transactionId: "MP55500022", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    sub().plan = "PRO";
    const error = await momo.confirmManualPayment(CONSOLE, accepted.payment!.id, LATER).then(() => null, (e: AdminError) => e);
    expect(error?.message).toMatch(/plan changed since they added these features/);
    expect(offerRow(saved.id).status).toBe("accepted");
    expect(sub().plan).toBe("PRO");
  });
});

describe("Add features on Billing (the client, self-serve)", () => {
  it("instant quote -> Mobile Money payment of the prorated amount; replacing an unpaid choice; audited", async () => {
    seed();
    const first = await offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["websiteChat"], method: "momo" }, NOW);
    expect(first.payment).toMatchObject({ amountMinor: 6129, currency: "RWF" });
    expect(first.offer).toMatchObject({ status: "accepted", addition: { selfServe: true, nextRenewalMinor: 45000 } });
    expect(audits("self_serve_addition")).toHaveLength(1);
    // Changed their mind before paying: the earlier choice is withdrawn, its payment closed.
    const second = await offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["websiteChat", "aiPhotos"], method: "momo" }, NOW);
    expect(second.payment).toMatchObject({ amountMinor: Math.round((18000 * 19) / 31) });
    expect(offerRow(first.offer.id).status).toBe("withdrawn");
    expect(h.db.manualPayment.rows.find((p) => p.id === first.payment!.id)!.status).toBe("expired");
    await momo.submitManualProof(USER, { paymentId: second.payment!.id, transactionId: "MP55500033", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    await momo.confirmManualPayment(CONSOLE, second.payment!.id, LATER);
    expect(sub().currentPeriodEnd).toEqual(END);
    expect(sub().plan).toBe(customPlanKeyFor(second.offer.id));
  });

  it("refuses unpriced features, Managed, an open offer from the team, and a card plan", async () => {
    seed();
    expect(await msg(offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["video"], method: "momo" }, NOW))).toMatch(/Request a custom change/);
    expect(await msg(offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["managed"], method: "momo" }, NOW))).toMatch(/Request a custom change/);
    const team = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: ADDON_DRAFT }, NOW);
    await offers.sendOffer(CONSOLE, team.id, NOW);
    expect(await msg(offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["aiPhotos"], method: "momo" }, NOW))).toMatch(/Our team has sent you an offer/);
    Object.assign(sub(), { provider: "PADDLE", providerSubscriptionId: "sub_1" });
    expect(await msg(offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["aiPhotos"], method: "momo" }, NOW))).toMatch(/card link/);
  });
});
