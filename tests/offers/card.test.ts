import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Card payment of a custom plan offer or added features (lib/offers/card.ts, docs/OFFERS.md "Card"): the price
// converted with the card rule of RWF plans, a one-off Paddle transaction for that exact amount (signed custom data),
// a re-quote when the amount changed, and the transaction.completed webhook switching it on once, checked against the
// signed quote and the paid totals; revenue keeps the RWF quote. Paddle is never called (the adapter is mocked).

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true),
  createOneOffTransaction: vi.fn<(input: { amountCents: number; customData: Record<string, string | number> }) => Promise<{ transactionId: string }>>(async () => ({ transactionId: "txn_01" })),
  cardOn: true,
  logError: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: h.logError }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/switch", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/switch")>()), isServiceEnabled: async () => true }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/invoices/storage", () => ({ INVOICE_BUCKET: "invoices", invoicePdfPath: () => "x", putInvoiceObject: vi.fn(), getInvoiceObject: vi.fn(async () => null), removeInvoiceObject: vi.fn() }));
vi.mock("@/lib/billing", async (orig) => ({ ...(await orig<typeof import("@/lib/billing")>()), activeProvider: () => "PADDLE", billingAdapter: () => ({ provider: "PADDLE", isConfigured: async () => true, createOneOffTransaction: h.createOneOffTransaction }) }));
vi.mock("@/lib/billing/card-ready", () => ({ cardCheckoutConfigured: async () => h.cardOn }));
vi.mock("@/lib/billing/paddle-config", () => ({ getPaddleConfig: async () => ({ environment: "sandbox", clientToken: "test_token", apiKey: "k", webhookSecret: "s" }) }));

import { resetPlanCache } from "@/lib/plan-catalog";
import { consoleContext } from "@/lib/admin/types";
import * as momo from "@/lib/billing/momo";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import * as offers from "@/lib/offers/service";
import { applyOfferCardPayment, CardOfferError, offerCardPaymentOf, offerCardReady, startOfferCardCheckout } from "@/lib/offers/card";
import { customPlanKeyFor, offerCardQuote } from "@/lib/offers/shared";
import { toRevenueEntry } from "@/lib/money/revenue-shared";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";

const CONSOLE = consoleContext("198.51.100.1");
const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-13T08:00:00Z");
const END = new Date("2026-11-01T00:00:00Z");
const sub = () => h.db.subscription.rows.find((r) => r.userId === USER)!;
const offerRow = (id: string) => h.db.planOffer.rows.find((r) => r.id === id)!;
const msg = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

function seed(over: Record<string, unknown> = {}) {
  h.db.user.rows.push({ id: USER, email: "biz1@example.rw", name: "Aline Uwase", suspendedAt: null });
  h.db.business.rows.push({ id: "biz1", userId: USER, name: "Inzu Fashion", ceoName: "Aline", phone: null, country: "Rwanda", pricingRegion: "RW", knowledge: null });
  h.db.subscription.rows.push({ id: "s1", userId: USER, plan: "STANDARD", status: "ACTIVE", chosenPlan: null, provider: "MANUAL_MOMO", providerCustomerId: null, providerSubscriptionId: null, providerPriceId: null, interval: "MONTH", cancelAtPeriodEnd: false, trialEndsAt: null, currentPeriodStart: new Date("2026-10-01T00:00:00Z"), currentPeriodEnd: END, updatedAt: NOW, ...over });
  const std = h.db.planDefinition.rows.find((r) => r.key === "STANDARD")!;
  std.featureKeys = ["content", "designs", "calendar", "gallery"];
  std.limits = { text: 200, image: 100, chat: 0, videos: 0, voiceCharacters: 0, seats: 3 };
  h.db.planRegionPrice.rows.push({ id: "prp_std", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 35000, yearlyMinor: 350000 });
  h.db.addonPrice.rows.push({ id: "a1", addonKey: "websiteChat", regionKey: "RW", currency: "RWF", monthlyMinor: 10000 });
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse Ltd" } });
  resetRegionPriceCache();
  clearMomoSettingsCache();
}

/** The Paddle transaction.completed `data` for a checkout the server opened (custom data as signed). */
function completed(customData: Record<string, string | number>, paid: { subtotal: number; currency?: string; quantity?: number }, id = "txn_01") {
  return { id, status: "completed", custom_data: customData, currency_code: paid.currency ?? "USD", items: [{ quantity: paid.quantity ?? 1, price: { id: "pri_custom" } }], details: { totals: { subtotal: String(paid.subtotal), currency_code: paid.currency ?? "USD", grand_total: String(paid.subtotal) }, payout_totals: { earnings: String(Math.round(paid.subtotal * 0.9)), currency_code: "USD" } } };
}

async function addFeaturesByCard() {
  const accepted = await offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["websiteChat"], method: "card" }, NOW);
  const config = await startOfferCardCheckout({ userId: USER, email: "biz1@example.rw", businessId: "biz1", offerId: accepted.offer.id }, NOW);
  return { offerId: accepted.offer.id, config, customData: h.createOneOffTransaction.mock.calls.at(-1)![0].customData };
}

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  h.cardOn = true;
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearMomoSettingsCache();
  process.env.ENCRYPTION_KEY = "test-key";
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.com";
  process.env.RESEND_API_KEY = "re_test";
});

describe("the card quote (pure)", () => {
  it("converts like an RWF plan's card price: rate plus margin, rounded up to whole dollars; USD stays as it is", () => {
    // 6,129 RWF / 1,450 = $4.23, +5% = $4.44 -> $5.
    expect(offerCardQuote(6129, "RWF", 1450, 5)).toEqual({ usdCents: 500, quoteMinor: 6129, quoteCurrency: "RWF", usdToRwf: 1450, marginPercent: 5 });
    expect(offerCardQuote(32000, "RWF", 1450, 5).usdCents).toBe(2400); // 23.17 -> $24
    expect(offerCardQuote(4900, "usd", 1450, 5)).toMatchObject({ usdCents: 4900, quoteCurrency: "USD", marginPercent: 0 });
  });
});

describe("opening the card checkout", () => {
  it("a one-off Paddle transaction for the exact amount, with the signed quote; the offer is accepted, nothing switches on yet", async () => {
    seed();
    const { offerId, config, customData } = await addFeaturesByCard();
    const call = h.createOneOffTransaction.mock.calls[0][0];
    // Due now 6,129 RWF (19 of 31 days of 10,000), at the default rate and margin.
    expect(call).toMatchObject({ amountCents: offerCardQuote(6129, "RWF", 1450, 5).usdCents, currency: "USD" });
    expect(customData).toMatchObject({ kind: "offer", offerId, userId: USER, quoteMinor: 6129, quoteCurrency: "RWF", plan: customPlanKeyFor(offerId), partial: 1 });
    expect(typeof customData.qsig).toBe("string");
    expect(config).toMatchObject({ provider: "PADDLE", transactionId: "txn_01", clientToken: "test_token", environment: "sandbox" });
    expect(offerRow(offerId)).toMatchObject({ status: "accepted", payMethod: "card" });
    expect(sub().plan).toBe("STANDARD");
  });

  it("re-quotes when the amount the client saw is not today's, and charges nothing", async () => {
    seed();
    const accepted = await offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["websiteChat"], method: "card" }, NOW);
    const e = (await msg(startOfferCardCheckout({ userId: USER, email: "a@b.rw", businessId: "biz1", offerId: accepted.offer.id, expectedUsdCents: 300 }, NOW))) as CardOfferError;
    expect(e).toBeInstanceOf(CardOfferError);
    expect(e.requote?.usdCents).toBe(500);
    expect(e.message).toMatch(/card price is now \$5/);
    expect(h.createOneOffTransaction).not.toHaveBeenCalled();
  });

  it("card not set up, switched off, or not offered in the region: no card button (Mobile Money stays)", async () => {
    seed();
    h.cardOn = false;
    expect(await offerCardReady(["momo", "card"])).toBe(false);
    h.cardOn = true;
    expect(await offerCardReady(["momo", "card"])).toBe(true);
    expect(await offerCardReady(["momo"])).toBe(false);
  });
});

describe("the webhook (transaction.completed)", () => {
  it("switches the added features on once, keeps the period end, closes the open Mobile Money payment; a replay changes nothing", async () => {
    seed();
    // The client had first opened a Mobile Money payment of the same features, then chose card.
    const viaMomo = await offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["websiteChat"], method: "momo" }, NOW);
    expect(viaMomo.payment?.status).toBe("pending");
    const { offerId, customData } = await addFeaturesByCard();
    expect(h.db.manualPayment.rows.find((p) => p.id === viaMomo.payment!.id)!.status).toBe("expired");
    const data = completed(customData, { subtotal: Number(customData.usdCents) });
    expect(await applyOfferCardPayment(data, NOW)).toMatch(/paid by card \(keep\)/);
    expect(sub()).toMatchObject({ plan: customPlanKeyFor(offerId), status: "ACTIVE", provider: "MANUAL_MOMO" });
    expect(sub().currentPeriodEnd).toEqual(END);
    expect(offerRow(offerId)).toMatchObject({ status: "paid", paidBy: "card:txn_01" });
    expect(h.db.auditLog.rows.filter((r) => r.action === "offer_paid_card")).toHaveLength(1);
    expect(h.sendEmail.mock.calls.map(([m]) => m.subject)).toContain("Your BuPulse Custom plan is active");
    // Paddle sends it again: nothing more.
    expect(await applyOfferCardPayment(data, NOW)).toBe("offer already paid by this transaction");
    expect(h.db.auditLog.rows.filter((r) => r.action === "offer_paid_card")).toHaveLength(1);
  });

  it("never trusts the transaction: a wrong amount, an unsigned or edited quote, a price changed since, or a second payment are not applied (refund alert)", async () => {
    seed();
    const { offerId, customData } = await addFeaturesByCard();
    const usd = Number(customData.usdCents);
    expect(await applyOfferCardPayment(completed(customData, { subtotal: usd - 100 }), NOW)).toMatch(/refund needed/);
    expect(await applyOfferCardPayment(completed(customData, { subtotal: usd, currency: "EUR" }), NOW)).toMatch(/refund needed/);
    // More than one bought (Paddle's quantity picker): refused whatever the total, never switched on.
    expect(await applyOfferCardPayment(completed(customData, { subtotal: usd * 2, quantity: 2 }), NOW)).toMatch(/bought 2 instead of 1\): refund needed/);
    expect(await applyOfferCardPayment(completed(customData, { subtotal: usd, quantity: 2 }), NOW)).toMatch(/bought 2 instead of 1/);
    expect(await applyOfferCardPayment(completed({ ...customData, quoteMinor: 1 }, { subtotal: usd }), NOW)).toMatch(/not signed/);
    expect(await applyOfferCardPayment(completed({ ...customData, usdCents: 100 }, { subtotal: 100 }), NOW)).toMatch(/not signed/);
    expect(offerRow(offerId).status).toBe("accepted");
    expect(sub().plan).toBe("STANDARD");
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "billing.offer_card" }));
    // Paid once; a second transaction for the same offer is a double payment.
    await applyOfferCardPayment(completed(customData, { subtotal: usd }), NOW);
    expect(await applyOfferCardPayment(completed(customData, { subtotal: usd }, "txn_02"), NOW)).toMatch(/already paid another way/);
    // Not an offer payment at all (a plan's card checkout): left to the subscription events.
    expect(await applyOfferCardPayment({ id: "txn_9", custom_data: { userId: USER } }, NOW)).toBeNull();
  });

  it("a custom plan offer from the team paid by card starts its period like a Mobile Money payment", async () => {
    seed();
    h.db.addonPrice.rows.push({ id: "a2", addonKey: "autopilot", regionKey: "RW", currency: "RWF", monthlyMinor: 20000 });
    resetRegionPriceCache();
    const saved = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: { basePlanKey: "STANDARD", features: ["websiteChat"], limits: { text: 200, image: 100, chat: 500, seats: 3 }, interval: "MONTH" } }, NOW);
    await offers.sendOffer(CONSOLE, saved.id, NOW);
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: saved.id, method: "card" }, NOW);
    await startOfferCardCheckout({ userId: USER, email: "a@b.rw", businessId: "biz1", offerId: saved.id }, NOW);
    const customData = h.createOneOffTransaction.mock.calls[0][0].customData;
    expect(customData).toMatchObject({ quoteMinor: 45000, quoteCurrency: "RWF", partial: 0 });
    expect(await applyOfferCardPayment(completed(customData, { subtotal: Number(customData.usdCents) }), NOW)).toMatch(/paid by card \(replace\)/);
    expect(sub()).toMatchObject({ plan: customPlanKeyFor(saved.id), provider: "MANUAL_MOMO" });
    // It renews like any custom plan: by Mobile Money (or card) in its last 7 days.
    expect((await msg(momo.startManualPayment({ userId: USER, plan: customPlanKeyFor(saved.id), interval: "MONTH", now: NOW })))?.message).toMatch(/paid until/);
  });

  it("revenue keeps the RWF quote next to the card's USD (the books, the TV and the leaderboard count it)", () => {
    const entry = toRevenueEntry({ eventId: "e1", type: "transaction.completed", createdAt: NOW, userId: USER, payload: { event_type: "transaction.completed", occurred_at: NOW.toISOString(), data: completed({ kind: "offer", offerId: "o1", userId: USER, usdCents: 500, quoteMinor: 6129, quoteCurrency: "RWF", plan: "CUSTOM-X", partial: 1 }, { subtotal: 500 }) } });
    expect(entry).toMatchObject({ method: "card", kind: "payment", localMinor: 6129, currency: "RWF", plan: "CUSTOM-X", partial: true, userId: USER });
    expect(offerCardPaymentOf({ id: "t", custom_data: { kind: "offer" } })).toBeNull();
  });
});
