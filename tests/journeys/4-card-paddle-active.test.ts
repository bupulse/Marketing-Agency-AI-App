import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { authUser, companyOf, HOUR, installSignUp, seedCatalog } from "./world";

// Journey 4: outside Rwanda the client pays by card (Paddle). The webhook route runs for real against the in-memory
// database, with a correctly signed request (HMAC with a test secret). subscription.* events move the plan to ACTIVE
// but never settle an invoice; only transaction.completed (money received) does, once. docs/INVOICES.md "Card payments".

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true),
  track: vi.fn(),
  logError: vi.fn(async () => {}),
  stored: new Map<string, Uint8Array>(),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: h.logError }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup" }, trackEvent: h.track }));
vi.mock("@/lib/invoices/storage", () => ({
  INVOICE_BUCKET: "invoices",
  invoicePdfPath: (b: string, n: string) => `pdf/${b}/${n}.pdf`,
  putInvoiceObject: vi.fn(async (path: string, bytes: Uint8Array) => void h.stored.set(path, bytes)),
  getInvoiceObject: vi.fn(async (path: string) => h.stored.get(path) ?? null),
  removeInvoiceObject: vi.fn(async (path: string) => void h.stored.delete(path)),
}));

import { POST } from "@/app/api/billing/webhooks/paddle/route";
import { ensureAccount } from "@/lib/account";
import { companyEntitlements, hasFeature } from "@/lib/entitlements";
import { signCheckoutUser } from "@/lib/billing/signing";
import { choosePlan } from "@/lib/demo/bookings";
import * as inv from "@/lib/invoices/service";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const SECRET = "pdl_ntfset_journey";
const SENT_AT = new Date("2026-10-13T08:00:00Z");
const audits = (action: string) => h.db.auditLog.rows.filter((r) => r.action === action);

type Ctx = { userId: string; sig: string };
const subscriptionEvent = (c: Ctx, type: "subscription.created" | "subscription.updated", id: string, over: Record<string, unknown> = {}, priceId = "pri_pro_m") =>
  JSON.stringify({
    event_id: id,
    event_type: type,
    occurred_at: "2026-10-13T09:00:00Z",
    data: { id: "sub_1", status: "active", customer_id: "ctm_1", items: [{ price: { id: priceId } }], custom_data: { userId: c.userId, sig: c.sig }, current_billing_period: { starts_at: "2026-10-13T09:00:00Z", ends_at: "2026-11-13T09:00:00Z" }, scheduled_change: null, updated_at: "2026-10-13T09:00:00Z", ...over },
  });
const transactionEvent = (c: Ctx, id: string, txn: string, over: Record<string, unknown> = {}, amount = "9900") =>
  JSON.stringify({
    event_id: id,
    event_type: "transaction.completed",
    occurred_at: "2026-10-13T09:00:05Z",
    data: { id: txn, status: "completed", subscription_id: "sub_1", origin: "web", billed_at: "2026-10-13T09:00:05Z", items: [{ price: { id: "pri_pro_m" } }], custom_data: { userId: c.userId }, details: { totals: { grand_total: amount, currency_code: "USD" } }, ...over },
  });
function post(body: string, opts: { signature?: string | null } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");
  const headers: Record<string, string> = {};
  if (opts.signature !== null) headers["paddle-signature"] = opts.signature ?? `ts=${ts};h1=${h1}`;
  return POST(new NextRequest("https://bupulse.test/api/billing/webhooks/paddle", { method: "POST", headers, body }));
}

/** A client abroad that chose Pro and was sent an invoice for it: USD at the plan's price. */
async function invoicedClient(n: number, country: string) {
  await ensureAccount(authUser(n, country) as never);
  const company = companyOf(h.db, n);
  await choosePlan({ businessId: company.businessId, planKey: "PRO" });
  const draft = await inv.createActivationInvoice(CONSOLE, { businessId: company.businessId }, SENT_AT);
  await inv.sendInvoice(CONSOLE, draft.id, SENT_AT);
  const ctx: Ctx = { userId: company.userId, sig: await signCheckoutUser(company.userId) };
  const invoice = () => h.db.invoice.rows.find((i) => i.id === draft.id)!;
  return { ...company, invoice, ctx };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T09:00:10Z"));
  h.db = createFakeDb();
  installSignUp(h.db);
  h.stored.clear();
  h.sendEmail.mockClear();
  h.track.mockClear();
  h.logError.mockClear();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  seedCatalog(h.db);
  h.db.planDefinition.rows.find((p) => p.key === "PRO")!.paddleMonthlyPriceId = "pri_pro_m";
  vi.stubEnv("ADMIN_EMAILS", "owner@bupulse.com");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
  vi.stubEnv("ENCRYPTION_KEY", "journey-test-key");
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("journey: card payment through Paddle webhooks", () => {
  it("subscription events activate the plan; only transaction.completed settles the invoice, once", async () => {
    const c = await invoicedClient(1, "France");
    expect(c.business.pricingRegion).toBe("GLOBAL");
    expect(c.invoice()).toMatchObject({ status: "sent", currency: "USD", planKey: "PRO", interval: "MONTH", totalMinor: 9900 });
    expect((await companyEntitlements(c.businessId)).block).toBe("pending_demo");

    // An unsigned, wrongly signed or stale request changes nothing.
    expect((await post(subscriptionEvent(c.ctx, "subscription.created", "evt_0"), { signature: null })).status).toBe(401);
    expect((await post(subscriptionEvent(c.ctx, "subscription.created", "evt_0"), { signature: `ts=${Math.floor(Date.now() / 1000)};h1=${"0".repeat(64)}` })).status).toBe(401);
    expect(h.db.billingEvent.rows).toHaveLength(0);
    expect(c.subscription.status).toBe("PENDING_DEMO");

    // The first purchase: subscription.created (signed checkout user) -> ACTIVE on Pro with Paddle's period. No invoice settled.
    expect((await post(subscriptionEvent(c.ctx, "subscription.created", "evt_1"))).status).toBe(200);
    expect(c.subscription).toMatchObject({ status: "ACTIVE", plan: "PRO", interval: "MONTH", provider: "PADDLE", providerSubscriptionId: "sub_1", providerCustomerId: "ctm_1", trialEndsAt: null, currentPeriodEnd: new Date("2026-11-13T09:00:00Z") });
    expect((await companyEntitlements(c.businessId)).block).toBeNull();
    expect(await hasFeature(c.businessId, "content")).toBe(true);
    expect(c.invoice().status).toBe("sent");
    expect(h.track.mock.calls.map((x) => x[0])).toEqual(expect.arrayContaining(["signup"]));

    // subscription.updated alone (a plan edit, a renewal notice) settles nothing.
    expect((await post(subscriptionEvent(c.ctx, "subscription.updated", "evt_2", { updated_at: "2026-10-13T09:00:02Z" }))).status).toBe(200);
    expect(c.invoice()).toMatchObject({ status: "sent", paidBy: null });
    expect(audits("invoice_paid")).toHaveLength(0);
    expect(c.subscription.status).toBe("ACTIVE");

    // The money arrives: transaction.completed settles the invoice that was open, and records who paid it.
    expect((await post(transactionEvent(c.ctx, "evt_3", "txn_1"))).status).toBe(200);
    expect(c.invoice()).toMatchObject({ status: "paid", paidBy: "paddle:txn_1", paidAt: new Date("2026-10-13T09:00:05Z") });
    expect(audits("invoice_paid")).toHaveLength(1);
    expect(audits("invoice_paid")[0]).toMatchObject({ actor: "system:paddle", target: `invoice:${c.invoice().id}`, before: { status: "sent" }, after: expect.objectContaining({ status: "paid", number: "BP-INV-0001", amountMinor: 9900, currency: "USD", subscriptionId: "sub_1" }) });
    expect(h.db.billingEvent.rows.map((e) => e.type)).toEqual(["subscription.created", "subscription.updated", "transaction.completed"]);
    expect(h.db.billingEvent.rows.every((e) => e.processedAt instanceof Date)).toBe(true);

    // Paddle retries and renewals do not settle anything again: the same event id is a duplicate; a new transaction
    // (the monthly renewal, no open invoice left) changes nothing.
    const writes = h.db.auditLog.rows.length;
    expect(await (await post(transactionEvent(c.ctx, "evt_3", "txn_1"))).json()).toEqual({ ok: true, duplicate: true });
    expect((await post(transactionEvent(c.ctx, "evt_4", "txn_2", { origin: "subscription_recurring", billed_at: "2026-11-13T09:00:05Z" }))).status).toBe(200);
    expect(h.db.auditLog.rows).toHaveLength(writes);
    expect(c.invoice().paidBy).toBe("paddle:txn_1");
    expect(c.subscription.status).toBe("ACTIVE");
    expect(h.logError).not.toHaveBeenCalled();
  });

  it("transaction.completed arriving before subscription.created still settles the invoice", async () => {
    const c = await invoicedClient(1, "France");
    expect((await post(transactionEvent(c.ctx, "evt_1", "txn_1", { subscription_id: "sub_1" }))).status).toBe(200);
    expect(c.invoice()).toMatchObject({ status: "paid", paidBy: "paddle:txn_1" });
    // The plan follows when the subscription event arrives.
    expect((await post(subscriptionEvent(c.ctx, "subscription.created", "evt_2"))).status).toBe(200);
    expect(c.subscription).toMatchObject({ status: "ACTIVE", plan: "PRO", provider: "PADDLE" });
    expect(audits("invoice_paid")).toHaveLength(1);
  });

  it("a card payment that does not match the invoice (it has a setup fee) activates the plan but only flags the invoice for review", async () => {
    const c = await invoicedClient(1, "France");
    const inv0 = c.invoice();
    Object.assign(inv0, { lines: [{ description: "Pro plan", quantity: 1, unitMinor: 9900 }, { description: "Setup", quantity: 1, unitMinor: 5000 }], totalMinor: 14900, subtotalMinor: 14900 });
    h.sendEmail.mockClear();
    await post(subscriptionEvent(c.ctx, "subscription.created", "evt_1"));
    await post(transactionEvent(c.ctx, "evt_2", "txn_1"));
    expect(c.subscription).toMatchObject({ status: "ACTIVE", plan: "PRO" });
    expect(c.invoice()).toMatchObject({ status: "sent", paidBy: null, paymentReview: { source: "paddle", reference: "txn_1", amountMinor: 9900, currency: "USD" } });
    expect(audits("invoice_paid")).toHaveLength(0);
    expect(audits("invoice_payment_review")[0]).toMatchObject({ actor: "system:paddle", target: `invoice:${c.invoice().id}` });
    expect((h.sendEmail.mock.calls.at(-1)?.[0] as { subject: string }).subject).toBe("Payment received for BP-INV-0001: check and mark paid");
    // The admin checks and marks it paid: the card subscription is not touched and no Mobile Money payment is made.
    const end = c.subscription.currentPeriodEnd;
    await inv.markInvoicePaid(CONSOLE, c.invoice().id, { method: "BANK", reference: "BANK-REF-1234" }, new Date());
    expect(c.invoice()).toMatchObject({ status: "paid", paidBy: "paddle:txn_1" });
    expect(c.subscription).toMatchObject({ provider: "PADDLE", currentPeriodEnd: end });
    expect(h.db.manualPayment.rows).toHaveLength(0);
  });

  it("a payment made before the invoice was sent, or for another plan, does not settle it", async () => {
    const c = await invoicedClient(1, "France");
    await post(subscriptionEvent(c.ctx, "subscription.created", "evt_1"));
    // billed one hour before the invoice went out
    await post(transactionEvent(c.ctx, "evt_2", "txn_early", { billed_at: new Date(SENT_AT.getTime() - HOUR).toISOString() }));
    expect(c.invoice().status).toBe("sent");
    // a renewal at another amount never settles an invoice it does not match exactly
    await post(transactionEvent(c.ctx, "evt_3", "txn_renew", { origin: "subscription_recurring" }, "1234"));
    expect(c.invoice().status).toBe("sent");
    expect(audits("invoice_paid")).toHaveLength(0);
  });

  // The region's own Paddle price (PlanRegionPrice.paddleMonthlyPriceId, docs/REGIONS.md) maps to its plan too.
  it("an EAC client paying with the region's own Paddle price becomes ACTIVE", async () => {
    h.db.planRegionPrice.rows.push({ id: "prp_pro_eac", planKey: "PRO", regionKey: "EAC", currency: "USD", monthlyMinor: 4900, yearlyMinor: 49000, cardMonthlyUsdCents: null, cardYearlyUsdCents: null, paddleMonthlyPriceId: "pri_pro_eac_m", paddleYearlyPriceId: null });
    resetRegionPriceCache();
    await ensureAccount(authUser(2, "Kenya") as never);
    const c = companyOf(h.db, 2);
    expect(c.business.pricingRegion).toBe("EAC");
    const ctx: Ctx = { userId: c.userId, sig: await signCheckoutUser(c.userId) };
    expect((await post(subscriptionEvent(ctx, "subscription.created", "evt_eac", {}, "pri_pro_eac_m"))).status).toBe(200);
    expect(c.subscription).toMatchObject({ status: "ACTIVE", plan: "PRO", provider: "PADDLE", providerPriceId: "pri_pro_eac_m" });
  });

  it("an unknown price is recorded as unmapped with an alert and a 200, never retried forever, and never changes the plan", async () => {
    const c = await invoicedClient(1, "France");
    h.sendEmail.mockClear();
    const body = subscriptionEvent(c.ctx, "subscription.created", "evt_x", {}, "pri_nobody");
    expect((await post(body)).status).toBe(200);
    expect(c.subscription).toMatchObject({ status: "PENDING_DEMO", provider: null });
    expect(h.db.billingEvent.rows[0]).toMatchObject({ type: "subscription.created", error: expect.stringMatching(/^unmapped: price pri_nobody/) });
    expect(h.db.billingEvent.rows[0].processedAt).toBeInstanceOf(Date);
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "billing.webhook.paddle.unmapped" }));
    expect((h.sendEmail.mock.calls.at(-1)?.[0] as { subject: string }).subject).toBe("Paddle price not recognised: pri_nobody");
    expect(await (await post(body)).json()).toEqual({ ok: true, duplicate: true });
    expect(h.db.billingEvent.rows).toHaveLength(1);
  });

  it("is unreachable without the signed checkout user: a forged user id attaches nothing", async () => {
    const c = await invoicedClient(1, "France");
    const forged = { userId: c.userId, sig: "0".repeat(64) };
    expect((await post(subscriptionEvent(forged, "subscription.created", "evt_1"))).status).toBe(200);
    expect(c.subscription).toMatchObject({ status: "PENDING_DEMO", provider: null });
    expect(h.db.billingEvent.rows[0].error).toMatch(/no matching account/);
  });
});
