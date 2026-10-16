import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Custom plan offers against the in-memory database (lib/offers): add-on prices (audited), save / send / withdraw
// (console only, audited, once), lazy expiry, the client seeing only its own offer, accept -> pay -> activate by
// Mobile Money and by invoice (confirm -> offer paid -> custom plan on, older custom plan retired), idempotency and
// replays, renewals of a custom plan, Jarvis create_offer as an approval, and custom plan requests.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true),
  trackEvent: vi.fn(),
  limited: false,
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: h.trackEvent }));
vi.mock("@/lib/admin/switch", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/switch")>()), isServiceEnabled: async () => true }));
vi.mock("@/lib/invoices/storage", () => ({
  INVOICE_BUCKET: "invoices",
  invoicePdfPath: (b: string, n: string) => `pdf/${b}/${n}.pdf`,
  putInvoiceObject: vi.fn(async () => undefined),
  getInvoiceObject: vi.fn(async () => null),
  removeInvoiceObject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/rate-limit")>();
  return { ...real, rateLimit: vi.fn(async () => { if (h.limited) throw new real.RateLimitError(60); }) };
});

import { getPlans, resetPlanCache } from "@/lib/plan-catalog";
import { AdminError, apiContext, consoleContext } from "@/lib/admin/types";
import * as admin from "@/lib/admin/service";
import { callTool } from "@/lib/admin/tools";
import * as momo from "@/lib/billing/momo";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import * as inv from "@/lib/invoices/service";
import { setAddonPrice } from "@/lib/offers/addon-prices";
import * as offers from "@/lib/offers/service";
import { createPlanRequest, listPlanRequests, PlanRequestError, setPlanRequestStatus } from "@/lib/offers/requests";
import { acceptedAgoText, customPlanKeyFor } from "@/lib/offers/shared";
import { sendOfferReminders, staleAcceptedOfferCount } from "@/lib/offers/reminders";
import { INVOICE_SETTING_KEY } from "@/lib/invoices/shared";
import { RateLimitError } from "@/lib/rate-limit";
import { resetRegionCache } from "@/lib/region";
import { regionalPlansFor, resetRegionPriceCache, getRegionPrices } from "@/lib/region-prices";
import { REGION_SEEDS } from "@/lib/region-format";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5", "all");
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-13T08:00:00Z");
const LATER = new Date("2026-10-13T09:00:00Z");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const msg = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const audits = (action: string) => h.db.auditLog.rows.filter((r) => r.action === action);
const sub = (userId = USER) => h.db.subscription.rows.find((r) => r.userId === userId)!;
const offerRow = (id: string) => h.db.planOffer.rows.find((r) => r.id === id)!;

const PRICES: [string, number][] = [["block:text", 3000], ["block:image", 5000], ["block:chat", 3000], ["seat", 3000], ["aiPhotos", 8000], ["websiteChat", 10000], ["autopilot", 20000], ["analytics", 5000]];

function company(id: string, userId: string, over: { region?: string; sub?: Record<string, unknown> } = {}) {
  h.db.user.rows.push({ id: userId, email: `${id}@example.rw`, name: "Aline Uwase", suspendedAt: null });
  h.db.business.rows.push({ id, userId, name: id === "biz1" ? "Inzu Fashion" : "Other Shop", ceoName: "Aline", phone: "+250 788 123 456", country: "Rwanda", pricingRegion: over.region ?? "RW", knowledge: null });
  h.db.subscription.rows.push({ id: `s_${id}`, userId, plan: "STANDARD", status: "ACTIVE", chosenPlan: null, provider: "MANUAL_MOMO", providerCustomerId: null, providerSubscriptionId: null, providerPriceId: null, interval: "MONTH", cancelAtPeriodEnd: false, trialEndsAt: null, currentPeriodStart: new Date("2026-10-01T00:00:00Z"), currentPeriodEnd: new Date("2026-11-01T00:00:00Z"), updatedAt: NOW, ...over.sub });
}

function seed() {
  company("biz1", USER);
  company("biz2", OTHER);
  // Rwanda's two plans as the R1 migration sells them: STANDARD stands in for Business (35,000) here, with the core
  // features only (website chat and Autopilot are add-ons in Rwanda).
  const std = h.db.planDefinition.rows.find((r) => r.key === "STANDARD")!;
  std.featureKeys = ["content", "designs", "calendar", "gallery"];
  std.limits = { text: 200, image: 100, chat: 0, videos: 0, voiceCharacters: 0, seats: 3 };
  h.db.planRegionPrice.rows.push({ id: "prp_std", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 35000, yearlyMinor: 350000 });
  for (const [addonKey, monthlyMinor] of PRICES) h.db.addonPrice.rows.push({ id: `a_${addonKey}`, addonKey, regionKey: "RW", currency: "RWF", monthlyMinor });
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse Ltd" } });
  resetRegionPriceCache();
  clearMomoSettingsCache();
}

const DRAFT = { basePlanKey: "STANDARD", features: ["websiteChat", "autopilot", "aiPhotos"], limits: { text: 200, image: 130, chat: 500, seats: 3 }, interval: "MONTH" };

async function sentOffer(draft: object = DRAFT, businessId = "biz1") {
  const saved = await offers.saveOfferDraft(CONSOLE, { businessId, draft });
  await offers.sendOffer(CONSOLE, saved.id, NOW);
  h.sendEmail.mockClear();
  return saved.id;
}

async function payByMomo(offerId: string, txn = "MP12345678") {
  const r = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId, method: "momo" }, NOW);
  await momo.submitManualProof(USER, { paymentId: r.payment!.id, transactionId: txn, payerPhone: "078 123 4567", network: "MTN" }, NOW);
  return { accepted: r, confirmed: await momo.confirmManualPayment(CONSOLE, r.payment!.id, LATER) };
}

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  h.limited = false;
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearMomoSettingsCache();
  process.env.ADMIN_EMAILS = "owner@bupulse.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.com";
});

describe("add-on prices", () => {
  it("sets, changes and removes a price in the region's currency, audited with before and after; the API is refused", async () => {
    seed();
    await setAddonPrice(CONSOLE, { addonKey: "webhooks", regionKey: "RW", monthlyMinor: 5000 });
    expect(h.db.addonPrice.rows.find((r) => r.addonKey === "webhooks")).toMatchObject({ currency: "RWF", monthlyMinor: 5000, updatedBy: "admin" });
    await setAddonPrice(CONSOLE, { addonKey: "webhooks", regionKey: "RW", monthlyMinor: 6000 });
    expect(audits("set_addon_price").map((a) => [a.before?.monthlyMinor ?? null, a.after.monthlyMinor])).toEqual([[null, 5000], [5000, 6000]]);
    await setAddonPrice(CONSOLE, { addonKey: "webhooks", regionKey: "RW", monthlyMinor: null });
    expect(h.db.addonPrice.rows.some((r) => r.addonKey === "webhooks")).toBe(false);
    expect(audits("remove_addon_price")).toHaveLength(1);
    expect(await code(setAddonPrice(CONSOLE, { addonKey: "teleport", regionKey: "RW", monthlyMinor: 1 }))).toBe("invalid");
    expect(await code(setAddonPrice(CONSOLE, { addonKey: "seat", regionKey: "RW", monthlyMinor: -1 }))).toBe("invalid");
    expect(await code(setAddonPrice(API, { addonKey: "seat", regionKey: "RW", monthlyMinor: 1 }))).toBe("forbidden");
  });
});

describe("making and sending an offer", () => {
  it("prices the draft from the region (73,000 RWF), freezes the lines, and audits it; console only", async () => {
    seed();
    const saved = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: DRAFT });
    expect(offerRow(saved.id)).toMatchObject({ status: "draft", currency: "RWF", computedMinor: 73000, adjustedMinor: 73000, interval: "MONTH", basePlanKey: "STANDARD", createdBy: "admin" });
    expect(offerRow(saved.id).featureKeys).toEqual(["content", "designs", "aiPhotos", "calendar", "gallery", "websiteChat", "autopilot"]);
    expect(audits("create_offer")).toHaveLength(1);
    expect(await code(offers.saveOfferDraft(API, { businessId: "biz1", draft: DRAFT }))).toBe("forbidden");
    expect(await code(offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: { ...DRAFT, basePlanKey: "PRO" } }))).toBe("invalid"); // not sold in RW
    expect(await msg(offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: { ...DRAFT, adjustedMinor: 70000 } }))).toMatch(/why the price differs/);
    const rounded = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", offerId: saved.id, draft: { ...DRAFT, adjustedMinor: 70000, adjustReason: "Rounded" } });
    expect(rounded.created).toBe(false);
    expect(offerRow(saved.id)).toMatchObject({ computedMinor: 73000, adjustedMinor: 70000, adjustReason: "Rounded" });
  });

  it("sends once, open for 7 days, and emails the company owner; a newer offer replaces a sent one", async () => {
    seed();
    const saved = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: DRAFT });
    const r = await offers.sendOffer(CONSOLE, saved.id, NOW);
    expect(r).toMatchObject({ status: "sent", emailed: true, to: "biz1@example.rw" });
    expect(offerRow(saved.id).validUntil.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ to: "biz1@example.rw", subject: expect.stringContaining("73,000") });
    expect(h.sendEmail.mock.calls[0][0].text).toContain("/dashboard/billing#offer");
    expect(await code(offers.sendOffer(CONSOLE, saved.id, NOW))).toBe("conflict");
    expect(audits("send_offer")).toHaveLength(1);

    const newer = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: { ...DRAFT, features: ["websiteChat"] , limits: { ...DRAFT.limits, image: 100 } } });
    await offers.sendOffer(CONSOLE, newer.id, NOW);
    expect(offerRow(saved.id)).toMatchObject({ status: "withdrawn", withdrawReason: "Replaced by a newer offer." });
    expect(offerRow(newer.id).status).toBe("sent");
  });

  it("an accepted offer stops a new one being sent", async () => {
    seed();
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    const next = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: DRAFT });
    expect(await msg(offers.sendOffer(CONSOLE, next.id, NOW))).toMatch(/accepted another offer/);
  });
});

describe("what the client sees", () => {
  it("only its own open offer; a sent offer past its date expires on read and cannot be accepted", async () => {
    seed();
    const id = await sentOffer();
    expect(await offers.clientOffer("biz2", NOW)).toBeNull();
    const mine = await offers.clientOffer("biz1", NOW);
    expect(mine).toMatchObject({ id, status: "sent", totalMinor: 73000, currency: "RWF", basePlanName: "Standard" });
    expect(mine!.features.filter((f) => f.added).map((f) => f.key)).toEqual(["aiPhotos", "websiteChat", "autopilot"]);
    // Another company cannot accept it, even with the id.
    expect(await msg(offers.acceptOffer({ userId: OTHER, actorId: OTHER, businessId: "biz2", offerId: id, method: "momo" }, NOW))).toMatch(/could not find/);

    const late = new Date("2026-10-21T00:00:00Z");
    expect(await offers.clientOffer("biz1", late)).toBeNull();
    expect(offerRow(id).status).toBe("expired");
    expect(audits("expire_offer")).toHaveLength(1);
    expect(await msg(offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, late))).toMatch(/expired/);
  });

  it("the custom plan is never on the pricing page or in the plan pickers", async () => {
    seed();
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    const plans = await getPlans({ force: true });
    const custom = plans.find((p) => p.isCustom)!;
    expect(custom).toMatchObject({ key: customPlanKeyFor(id), status: "hidden", businessId: "biz1", currency: "RWF", monthlyPriceCents: 73000, yearlyPriceCents: 730000 });
    const rw = REGION_SEEDS.find((r) => r.key === "RW")!;
    // Even a row in PlanRegionPrice (which nothing writes for custom plans) would not put it on sale.
    const prices = [...(await getRegionPrices({ force: true })), { planKey: custom.key, regionKey: "RW", currency: "RWF", monthlyMinor: 1, yearlyMinor: 1, cardMonthlyUsdCents: null, cardYearlyUsdCents: null, paddleMonthlyPriceId: null, paddleYearlyPriceId: null }];
    expect(regionalPlansFor(plans.map((p) => (p.key === custom.key ? { ...p, status: "active" as const } : p)), prices, rw).some((p) => p.key === custom.key)).toBe(false);
  });
});

describe("accept -> pay by Mobile Money -> activate", () => {
  it("accepting prepares the custom plan and a payment of the offer's price; nothing switches on before the payment is confirmed", async () => {
    seed();
    const id = await sentOffer();
    const r = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    expect(offerRow(id)).toMatchObject({ status: "accepted", payMethod: "momo", customPlanKey: customPlanKeyFor(id) });
    expect(r.payment).toMatchObject({ planKey: customPlanKeyFor(id), amountMinor: 73000, currency: "RWF", offerId: id, status: "pending" });
    expect(sub()).toMatchObject({ plan: "STANDARD", status: "ACTIVE" });
    expect(audits("accept_offer")[0]).toMatchObject({ actor: `client:${USER}` });
    // Accepting again (another tab) gives the same payment, no second plan.
    const again = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    expect(again.payment!.id).toBe(r.payment!.id);
    expect(h.db.planDefinition.rows.filter((p) => p.isCustom)).toHaveLength(1);
  });

  it("confirming switches the company onto its custom plan (fresh period, usage anchor now), marks the offer paid, audits, emails", async () => {
    seed();
    const id = await sentOffer();
    const { confirmed } = await payByMomo(id);
    expect(confirmed).toMatchObject({ status: "confirmed", plan: customPlanKeyFor(id), periodMode: "replace" });
    expect(sub()).toMatchObject({ plan: customPlanKeyFor(id), status: "ACTIVE", provider: "MANUAL_MOMO", interval: "MONTH" });
    expect(sub().currentPeriodStart.toISOString()).toBe(LATER.toISOString());
    expect(sub().currentPeriodEnd.toISOString()).toBe("2026-11-13T09:00:00.000Z");
    expect(offerRow(id)).toMatchObject({ status: "paid", paidBy: `manual_payment:${confirmed.id}` });
    expect(audits("offer_paid")).toHaveLength(1);
    expect(audits("confirm_momo_payment")).toHaveLength(1);
    expect(h.sendEmail.mock.calls.map(([m]) => m.subject)).toContain("Your BuPulse Custom plan is active");
    // The plan's features are the offer's.
    const plan = (await getPlans({ force: true })).find((p) => p.key === customPlanKeyFor(id))!;
    expect(plan.features).toEqual(expect.arrayContaining(["websiteChat", "autopilot", "aiPhotos"]));
    expect(plan.limits).toMatchObject({ text: 200, image: 130, chat: 500, seats: 3 });
  });

  it("is idempotent: a second confirm, a replayed accept and a replayed transaction id change nothing", async () => {
    seed();
    const id = await sentOffer();
    const { confirmed } = await payByMomo(id);
    const before = { ...sub() };
    expect(await code(momo.confirmManualPayment(CONSOLE, confirmed.id, LATER))).toBe("conflict");
    expect(await msg(offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, LATER))).toMatch(/already paid/);
    expect(await code(offers.withdrawOffer(CONSOLE, id, "too late", LATER))).toBe("conflict");
    expect(sub()).toEqual(before);
    expect(audits("offer_paid")).toHaveLength(1);
    // The same MoMo SMS cannot pay a second offer.
    const next = await sentOffer({ ...DRAFT, features: ["websiteChat", "autopilot", "aiPhotos", "analytics"] });
    const r = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: next, method: "momo" }, LATER);
    expect(await msg(momo.submitManualProof(USER, { paymentId: r.payment!.id, transactionId: "MP12345678", payerPhone: "078 123 4567", network: "MTN" }, LATER))).toMatch(/already been used/);
  });

  it("an offer's own payment never settles or flags another open invoice of the company", async () => {
    seed();
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    // An invoice the admin made by hand for the same plan, interval and amount: a plain payment would settle it.
    h.db.invoice.rows.push({ id: "inv_other", number: "BP-INV-0099", businessId: "biz1", status: "sent", currency: "RWF", lines: [{ description: "Custom", quantity: 1, unitMinor: 73000 }], subtotalMinor: 73000, taxMinor: 0, totalMinor: 73000, planKey: customPlanKeyFor(id), interval: "MONTH", sentAt: NOW, sentTo: [], paymentReview: null, createdAt: NOW });
    await payByMomo(id);
    expect(offerRow(id).status).toBe("paid");
    expect(h.db.invoice.rows.find((r) => r.id === "inv_other")).toMatchObject({ status: "sent", paymentReview: null });
    expect(audits("invoice_paid")).toHaveLength(0);
    expect(audits("invoice_payment_review")).toHaveLength(0);
  });

  it("a newer paid offer replaces the custom plan: the old one is retired", async () => {
    seed();
    const first = await sentOffer();
    await payByMomo(first, "MP11111111");
    const second = await sentOffer({ ...DRAFT, features: ["websiteChat", "autopilot", "aiPhotos", "analytics"] });
    await payByMomo(second, "MP22222222");
    expect(sub().plan).toBe(customPlanKeyFor(second));
    const rows = h.db.planDefinition.rows.filter((p) => p.isCustom);
    expect(rows.map((p) => [p.key, p.status])).toEqual([[customPlanKeyFor(first), "retired"], [customPlanKeyFor(second), "hidden"]]);
  });

  it("a payment for an offer that was withdrawn meanwhile is refused at confirm, nothing changes", async () => {
    seed();
    const id = await sentOffer();
    const r = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    await momo.submitManualProof(USER, { paymentId: r.payment!.id, transactionId: "MP33333333", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    expect(await msg(offers.withdrawOffer(CONSOLE, id, "Changed my mind", NOW))).toMatch(/reported a payment/);
    offerRow(id).status = "withdrawn"; // as if withdrawn in a race
    expect(await code(momo.confirmManualPayment(CONSOLE, r.payment!.id, LATER))).toBe("conflict");
    expect(sub().plan).toBe("STANDARD");
    expect(h.db.manualPayment.rows[0].status).toBe("pending");
  });

  it("the custom plan renews by Mobile Money at its own price; nobody else can buy it", async () => {
    seed();
    const id = await sentOffer();
    const { confirmed } = await payByMomo(id);
    void confirmed;
    // Renewing opens in the last 7 days of the period (docs/BILLING.md, "Renewing").
    expect(await msg(momo.startManualPayment({ userId: USER, plan: customPlanKeyFor(id), interval: "MONTH", now: LATER }))).toMatch(/is paid until 13 November 2026/);
    const renewal = await momo.startManualPayment({ userId: USER, plan: customPlanKeyFor(id), interval: "MONTH", now: new Date("2026-11-08T09:00:00Z") });
    expect(renewal).toMatchObject({ amountMinor: 73000, currency: "RWF", offerId: null });
    expect(await msg(momo.startManualPayment({ userId: OTHER, plan: customPlanKeyFor(id), interval: "MONTH", now: LATER }))).toMatch(/not available/);
  });
});

describe("accept -> pay by invoice -> activate", () => {
  it("issues one sent invoice for the offer's price with the custom plan; Mark as paid switches it on and marks the offer paid", async () => {
    seed();
    const id = await sentOffer();
    const r = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "invoice" }, NOW);
    const invoice = h.db.invoice.rows[0];
    expect(r.invoiceId).toBe(invoice.id);
    expect(invoice).toMatchObject({ status: "sent", currency: "RWF", totalMinor: 73000, planKey: customPlanKeyFor(id), interval: "MONTH", createdBy: `client:${USER}` });
    expect(offerRow(id)).toMatchObject({ status: "accepted", payMethod: "invoice", invoiceId: invoice.id });
    expect(h.sendEmail).toHaveBeenCalled(); // the invoice email
    // Asking again returns the same invoice.
    const again = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "invoice" }, NOW);
    expect(again.invoiceId).toBe(invoice.id);
    expect(h.db.invoice.rows).toHaveLength(1);

    await inv.markInvoicePaid(CONSOLE, invoice.id, { method: "MTN", reference: "MP44444444" }, LATER);
    expect(invoice.status).toBe("paid");
    expect(offerRow(id).status).toBe("paid");
    expect(sub()).toMatchObject({ plan: customPlanKeyFor(id), status: "ACTIVE" });
  });

  it("the client's Mobile Money payment of the offer's invoice activates it too; switching from invoice to MoMo voids nothing until paid", async () => {
    seed();
    const id = await sentOffer();
    const r = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "invoice" }, NOW);
    const pay = await momo.startInvoicePayment({ userId: USER, invoiceId: r.invoiceId!, now: NOW });
    await momo.submitManualProof(USER, { paymentId: pay.id, transactionId: "MP55555555", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    await momo.confirmManualPayment(CONSOLE, pay.id, LATER);
    expect(offerRow(id).status).toBe("paid");
    expect(h.db.invoice.rows[0].status).toBe("paid");
  });

  it("paying the offer directly by Mobile Money voids its open invoice, so it cannot be paid twice", async () => {
    seed();
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "invoice" }, NOW);
    await payByMomo(id, "MP66666666");
    expect(offerRow(id).status).toBe("paid");
    expect(h.db.invoice.rows[0]).toMatchObject({ status: "void", voidReason: expect.stringMatching(/paid by Mobile Money/) });
  });
});

describe("withdrawing", () => {
  it("an accepted offer: its open payment is closed, its invoice voided, its prepared plan retired; audited", async () => {
    seed();
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "invoice" }, NOW);
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    expect(await code(offers.withdrawOffer(CONSOLE, id, "x", NOW))).toBe("invalid");
    expect(await code(offers.withdrawOffer(API, id, "Not via API", NOW))).toBe("forbidden");
    await offers.withdrawOffer(CONSOLE, id, "Client asked for something else", NOW);
    expect(offerRow(id)).toMatchObject({ status: "withdrawn", withdrawReason: "Client asked for something else" });
    expect(h.db.manualPayment.rows.every((p) => p.status === "expired")).toBe(true);
    expect(h.db.invoice.rows[0].status).toBe("void");
    expect(h.db.planDefinition.rows.find((p) => p.key === customPlanKeyFor(id))!.status).toBe("retired");
    expect(audits("withdraw_offer")).toHaveLength(1);
    expect(await offers.clientOffer("biz1", NOW)).toBeNull();
  });
});

describe("Jarvis", () => {
  it("create_offer only creates an approval (nothing saved); approving saves and sends it; list_offers reads", async () => {
    seed();
    const receipt = (await callTool("create_offer", { businessId: "biz1", ...DRAFT, send: true, idempotencyKey: "offer-biz1-001" }, API)) as { id: string; status: string; kind: string };
    expect(receipt).toMatchObject({ status: "pending", kind: "create_offer" });
    expect(h.db.planOffer.rows).toHaveLength(0);
    const replay = (await callTool("create_offer", { businessId: "biz1", ...DRAFT, send: true, idempotencyKey: "offer-biz1-001" }, API)) as { id: string; replayed: boolean };
    expect(replay).toMatchObject({ id: receipt.id, replayed: true });
    expect(h.db.adminApproval.rows[0].params).toMatchObject({ company: "Inzu Fashion", adjustedMinor: 73000, currency: "RWF" });
    // Without an idempotency key it is refused, and Jarvis cannot run the console functions directly.
    expect(await code(callTool("create_offer", { businessId: "biz1", ...DRAFT }, API))).toBe("idempotency_required");
    expect(await code(offers.sendOffer(API, "x"))).toBe("forbidden");

    const done = await admin.approveAction(CONSOLE, receipt.id);
    expect(done.status).toBe("executed");
    expect(h.db.planOffer.rows[0]).toMatchObject({ status: "sent", adjustedMinor: 73000 });
    const list = (await callTool("list_offers", { businessId: "biz1" }, API)) as { status: string }[];
    expect(list.map((o) => o.status)).toEqual(["sent"]);
  });
});

describe("custom plan requests", () => {
  const raw = { description: "We sell shoes in Kigali.", goals: "More orders on WhatsApp.", features: ["websiteChat", "teleport"], budget: "50k_100k", source: "pricing" };

  it("records the request against the company (and its demo booking) and emails the owner", async () => {
    seed();
    h.db.demoBooking.rows.push({ id: "demo1", businessId: "biz1", kind: "demo", status: "booked", startsAt: new Date("2026-10-14T07:00:00Z"), endsAt: new Date("2026-10-14T07:30:00Z") });
    const r = await createPlanRequest({ userId: USER, actorId: USER, businessId: "biz1", raw }, NOW);
    const row = h.db.customPlanRequest.rows[0];
    expect(row).toMatchObject({ id: r.id, businessId: "biz1", demoBookingId: "demo1", companyName: "Inzu Fashion", email: "biz1@example.rw", status: "new", source: "pricing", budget: "50k_100k" });
    expect(row.featureKeys).toEqual(["websiteChat"]);
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@bupulse.com", subject: "Custom plan request: Inzu Fashion" }));
    expect((await listPlanRequests({ status: "new" })).map((x) => x.id)).toEqual([r.id]);
  });

  it("validates the form and is rate-limited per company", async () => {
    seed();
    expect(await msg(createPlanRequest({ userId: USER, actorId: USER, businessId: "biz1", raw: { ...raw, description: "x" } }, NOW))).toMatch(/what your business does/);
    expect(await createPlanRequest({ userId: USER, actorId: USER, businessId: "", raw }, NOW).catch((e) => e)).toBeInstanceOf(PlanRequestError);
    h.limited = true;
    expect(await createPlanRequest({ userId: USER, actorId: USER, businessId: "biz1", raw }, NOW).catch((e) => e)).toBeInstanceOf(RateLimitError);
    expect(h.db.customPlanRequest.rows).toHaveLength(0);
  });

  it("the admin marks it contacted (audited); sending an offer made from it marks it offered", async () => {
    seed();
    const r = await createPlanRequest({ userId: USER, actorId: USER, businessId: "biz1", raw }, NOW);
    await setPlanRequestStatus(CONSOLE, r.id, "contacted");
    expect(audits("set_request_status")).toHaveLength(1);
    expect(await code(setPlanRequestStatus(CONSOLE, r.id, "nope"))).toBe("invalid");
    expect(await code(setPlanRequestStatus(API, r.id, "closed"))).toBe("forbidden");
    h.db.user.rows[0].subscription = sub(); // the fake database serves nested selects from what the row carries
    const ctx = await offers.offerEditorContext({ businessId: "biz1", requestId: r.id });
    expect(ctx.initial).toMatchObject({ basePlanKey: "STANDARD", features: ["websiteChat"], requestId: r.id });
    await sentOffer({ ...DRAFT, requestId: r.id });
    expect(h.db.customPlanRequest.rows[0].status).toBe("offered");
  });
});

describe("review fixes", () => {
  const DAY = 86_400_000;
  const at = (days: number) => new Date(NOW.getTime() + days * DAY);

  it("an offer invoice has no tax line whatever the VAT setting: the offer's price is the total", async () => {
    seed();
    h.db.adminSetting.rows.push({ key: INVOICE_SETTING_KEY, value: { vatRatePercent: 18 } });
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "invoice" }, NOW);
    expect(h.db.invoice.rows[0]).toMatchObject({ subtotalMinor: 73000, taxMinor: 0, totalMinor: 73000, taxRatePercent: null });
  });

  it("confirming refuses a payment whose amount or currency is not the offer's price; nothing changes", async () => {
    seed();
    const id = await sentOffer();
    const r = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    await momo.submitManualProof(USER, { paymentId: r.payment!.id, transactionId: "MP77777777", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    h.db.manualPayment.rows[0].amountMinor = 70000;
    expect(await msg(momo.confirmManualPayment(CONSOLE, r.payment!.id, LATER))).toMatch(/70000 RWF, but the custom plan offer costs 73000 RWF/);
    h.db.manualPayment.rows[0].amountMinor = 73000;
    h.db.manualPayment.rows[0].currency = "USD";
    expect(await code(momo.confirmManualPayment(CONSOLE, r.payment!.id, LATER))).toBe("conflict");
    expect(offerRow(id).status).toBe("accepted");
    expect(sub().plan).toBe("STANDARD");
    expect(h.db.manualPayment.rows[0].status).toBe("pending");
  });

  it("a plain Mobile Money payment of a custom plan goes through its accepted offer; a withdrawn offer's plan cannot be paid", async () => {
    seed();
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "invoice" }, NOW);
    const p = await momo.startManualPayment({ userId: USER, plan: customPlanKeyFor(id), interval: "YEAR", now: NOW });
    expect(p).toMatchObject({ offerId: id, amountMinor: 73000, interval: "MONTH" });
    await offers.withdrawOffer(CONSOLE, id, "Client changed plans", NOW);
    expect(await msg(momo.startManualPayment({ userId: USER, plan: customPlanKeyFor(id), interval: "MONTH", now: NOW }))).toMatch(/not available|no longer open/);
  });

  it("withdrawing re-checks for a reported payment inside its transaction: a proof landing meanwhile stops it", async () => {
    seed();
    const id = await sentOffer();
    const r = await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    const real = h.db.manualPayment.updateMany.getMockImplementation()!;
    // The client taps "I've paid" just before the withdrawal closes the open payments.
    h.db.manualPayment.updateMany.mockImplementationOnce(async (args) => {
      await momo.submitManualProof(USER, { paymentId: r.payment!.id, transactionId: "MP88888888", payerPhone: "078 123 4567", network: "MTN" }, NOW);
      return real(args);
    });
    expect(await msg(offers.withdrawOffer(CONSOLE, id, "Too slow", NOW))).toMatch(/reported a payment/);
    expect(h.db.manualPayment.rows[0]).toMatchObject({ status: "pending", transactionId: "MP88888888" });
    expect(audits("withdraw_offer")).toHaveLength(0);
  });

  it("accepted but unpaid: reminders on day 3 and day 7, once each; on the Overview after 7 days", async () => {
    seed();
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    h.sendEmail.mockClear();
    expect(await sendOfferReminders(at(2))).toBe(0);
    expect(await sendOfferReminders(at(3))).toBe(1);
    expect(await sendOfferReminders(at(4))).toBe(0);
    expect(await staleAcceptedOfferCount(at(6))).toBe(0);
    expect(await staleAcceptedOfferCount(at(7))).toBe(1);
    expect(await sendOfferReminders(at(7))).toBe(1);
    expect(await sendOfferReminders(at(9))).toBe(0);
    expect(h.sendEmail.mock.calls.map(([m]) => [m.to, m.subject])).toEqual([
      ["biz1@example.rw", "Your custom BuPulse plan is waiting for payment"],
      ["biz1@example.rw", "Reminder: your custom BuPulse plan is not paid yet"],
    ]);
    expect(acceptedAgoText(NOW, at(9))).toBe("Accepted 9 days ago");
    expect(acceptedAgoText(NOW, at(0.5))).toBe("Accepted today");
  });

  it("a missed day-3 run sends only the day-7 reminder; a failed email is retried next run; a paid offer gets none", async () => {
    seed();
    const id = await sentOffer();
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    h.sendEmail.mockClear();
    h.sendEmail.mockResolvedValueOnce(false);
    expect(await sendOfferReminders(at(8))).toBe(0);
    expect(offerRow(id)).toMatchObject({ reminder3SentAt: null, reminder7SentAt: null });
    expect(await sendOfferReminders(at(8))).toBe(1);
    expect(await sendOfferReminders(at(9))).toBe(0);
    const other = await sentOffer({ ...DRAFT }, "biz2");
    await offers.acceptOffer({ userId: OTHER, actorId: OTHER, businessId: "biz2", offerId: other, method: "invoice" }, NOW);
    offerRow(other).status = "paid";
    expect(await sendOfferReminders(at(8))).toBe(0);
  });

  it("an approved create_offer is priced again before anything is saved: a price change fails it and saves nothing", async () => {
    seed();
    const receipt = (await callTool("create_offer", { businessId: "biz1", ...DRAFT, send: true, idempotencyKey: "offer-biz1-drift" }, API)) as { id: string };
    h.db.addonPrice.rows.find((r) => r.addonKey === "autopilot")!.monthlyMinor = 25000;
    const done = await admin.approveAction(CONSOLE, receipt.id);
    expect(done.status).toBe("failed");
    expect(JSON.stringify(done.result)).toMatch(/price changed/);
    expect(h.db.planOffer.rows).toHaveLength(0);
  });
});

describe("included amounts and features that are not set up", () => {
  // Drive and Dropbox import runs on the Google Picker or the Dropbox Chooser: without BuPulse's keys it cannot be used.
  const KEYS = ["GOOGLE_PICKER_API_KEY", "GOOGLE_PICKER_APP_ID", "GOOGLE_CLIENT_ID", "GOOGLE_YOUTUBE_CLIENT_ID", "DROPBOX_APP_KEY"];
  const before: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      before[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  });
  const withDrivePrice = () => h.db.addonPrice.rows.push({ id: "a_driveImport", addonKey: "driveImport", regionKey: "RW", currency: "RWF", monthlyMinor: 3000 });

  it("a draft with website chat but 0 chat replies is saved with the 500 included, at the same price (no chat block)", async () => {
    seed();
    const saved = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: { ...DRAFT, limits: { text: 200, image: 0, chat: 0, seats: 3 } } });
    const row = offerRow(saved.id);
    expect(row.limits).toMatchObject({ chat: 500, image: 130 });
    expect((row.lines as { key: string }[]).map((l) => l.key)).not.toContain("block:chat");
    expect(row.computedMinor).toBe(73000);
  });

  it("an offer saved before that rule (0 chat replies) still makes a custom plan with the 500 included when accepted", async () => {
    seed();
    const id = await sentOffer();
    offerRow(id).limits = { ...(offerRow(id).limits as object), chat: 0 };
    await offers.acceptOffer({ userId: USER, actorId: USER, businessId: "biz1", offerId: id, method: "momo" }, NOW);
    expect(h.db.planDefinition.rows.find((p) => p.key === customPlanKeyFor(id))!.limits).toMatchObject({ chat: 500, image: 130, text: 200 });
  });

  it("Drive and Dropbox import cannot be offered until one of them is set up", async () => {
    seed();
    withDrivePrice();
    const draft = { ...DRAFT, features: ["websiteChat", "driveImport"] };
    expect(await msg(offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft }))).toMatch(/Drive and Dropbox import is coming soon/);
    expect(await msg(offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft: { ...draft, mode: "addon" } }))).toMatch(/Drive and Dropbox import is coming soon/);
    process.env.DROPBOX_APP_KEY = "dropbox-key";
    const saved = await offers.saveOfferDraft(CONSOLE, { businessId: "biz1", draft });
    expect(offerRow(saved.id).featureKeys).toContain("driveImport");
  });

  it("the editor starts a request's website chat at 500 replies and leaves features that are not set up unticked", async () => {
    seed();
    h.db.customPlanRequest.rows.push({ id: "req1", businessId: "biz1", companyName: "Inzu Fashion", description: "We sell clothes in Kigali", goals: null, featureKeys: ["websiteChat", "driveImport"], status: "new", createdAt: NOW });
    const ctx = await offers.offerEditorContext({ businessId: "biz1", requestId: "req1" });
    expect(ctx.initial.features).toEqual(["websiteChat"]);
    expect(ctx.initial.limits.chat).toBe(500);
    expect(ctx.notSetUp).toContain("driveImport");
  });

  it("Billing's Add features lists Drive and Dropbox import as coming soon and refuses to sell it", async () => {
    seed();
    withDrivePrice();
    const add = await offers.selfServeAddition("biz1", NOW);
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(add.addable).not.toContain("driveImport");
    expect(add.addable).toContain("websiteChat");
    expect(add.soon).toContain("driveImport");
    expect(await msg(offers.startFeatureAddition({ userId: USER, actorId: USER, businessId: "biz1", features: ["driveImport"], method: "momo" }, NOW))).toMatch(/cannot be added here/);
  });
});
