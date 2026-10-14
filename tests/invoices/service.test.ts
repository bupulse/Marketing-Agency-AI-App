import { inflateSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Invoices against the in-memory database (lib/invoices/service.ts): numbering under concurrency, the activation
// draft, the editor's checks, send / mark paid / void (console only, audited, once), Mobile Money with the invoice
// number as the reference (confirm -> invoice paid -> plan active), reminders, card settlement, and the client seeing
// only its own invoices.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string; attachments?: { filename: string; content: string }[] }) => Promise<boolean>>(async () => true),
  trackEvent: vi.fn(),
  off: new Set<string>(),
  stored: new Map<string, Uint8Array>(),
  putFails: false,
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: h.trackEvent }));
vi.mock("@/lib/admin/switch", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/switch")>()), isServiceEnabled: async (id: string) => !h.off.has(id) }));
vi.mock("@/lib/invoices/storage", () => ({
  INVOICE_BUCKET: "invoices",
  invoicePdfPath: (b: string, n: string) => `pdf/${b}/${n}.pdf`,
  putInvoiceObject: vi.fn(async (path: string, bytes: Uint8Array) => {
    if (h.putFails) throw new Error("storage down");
    h.stored.set(path, bytes);
  }),
  getInvoiceObject: vi.fn(async (path: string) => h.stored.get(path) ?? null),
  removeInvoiceObject: vi.fn(async (path: string) => void h.stored.delete(path)),
}));

import { resetPlanCache } from "@/lib/plan-catalog";
import { AdminError, apiContext, consoleContext } from "@/lib/admin/types";
import * as momo from "@/lib/billing/momo";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import { cardPaymentOf, INVOICE_SETTING_KEY, invoiceForCardPayment, matchInvoicePayment, type CardPayment } from "@/lib/invoices/shared";
import * as inv from "@/lib/invoices/service";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5", "all");
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-13T08:00:00Z");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const msg = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const audits = (action: string) => h.db.auditLog.rows.filter((r) => r.action === action);
const invoice = () => h.db.invoice.rows[0];

function company(id: string, userId: string, over: { region?: string; sub?: Record<string, unknown>; email?: string } = {}) {
  h.db.user.rows.push({ id: userId, email: over.email ?? `${id}@example.rw`, name: "Aline Uwase", suspendedAt: null });
  h.db.business.rows.push({ id, userId, name: id === "biz1" ? "Inzu Fashion" : "Other Shop", ceoName: "Aline", phone: "+250 788 123 456", country: "Rwanda", pricingRegion: over.region ?? "RW", knowledge: { locations: [{ kind: "head", label: "Head office", address: "KN 4 Avenue, Kigali, Rwanda", building: { name: "M Peace Plaza", floor: "8" } }] } });
  h.db.subscription.rows.push({ id: `s_${id}`, userId, plan: "TRIAL", status: "PENDING_DEMO", chosenPlan: "PRO", provider: null, providerCustomerId: null, providerSubscriptionId: null, providerPriceId: null, interval: "MONTH", cancelAtPeriodEnd: false, trialEndsAt: null, currentPeriodStart: new Date("2026-10-10T00:00:00Z"), currentPeriodEnd: null, ...over.sub });
}

function seed() {
  company("biz1", USER);
  h.db.planRegionPrice.rows.push(
    { id: "prp_std", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000 },
    { id: "prp_pro", planKey: "PRO", regionKey: "RW", currency: "RWF", monthlyMinor: 35000, yearlyMinor: 350000 },
  );
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse Ltd" } });
  h.db.demoBooking.rows.push({ id: "demo1", businessId: "biz1", kind: "demo", status: "booked", startsAt: new Date("2026-10-13T07:00:00Z"), endsAt: new Date("2026-10-13T07:30:00Z") });
  resetRegionPriceCache();
  clearMomoSettingsCache();
}

async function draft() {
  const r = await inv.createActivationInvoice(CONSOLE, { businessId: "biz1" }, NOW);
  return r.id;
}
async function sent() {
  const id = await draft();
  await inv.sendInvoice(CONSOLE, id, NOW);
  h.sendEmail.mockClear();
  return id;
}

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  h.off.clear();
  h.stored.clear();
  h.putFails = false;
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearMomoSettingsCache();
  process.env.ADMIN_EMAILS = "owner@bupulse.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.com";
});

describe("numbering", () => {
  it("hands out distinct, sequential numbers to concurrent callers", async () => {
    const numbers = await Promise.all(Array.from({ length: 25 }, () => inv.nextInvoiceNumber()));
    expect(new Set(numbers).size).toBe(25);
    expect([...numbers].sort()).toEqual(Array.from({ length: 25 }, (_, i) => `BP-INV-${String(i + 1).padStart(4, "0")}`));
  });

  it("concurrent activations of different companies get different numbers; the same company twice gets one draft", async () => {
    seed();
    for (let i = 2; i <= 6; i++) company(`biz${i}`, `${i}${USER.slice(1)}`);
    const results = await Promise.all(["biz1", "biz2", "biz3", "biz4", "biz5", "biz6"].map((businessId) => inv.createActivationInvoice(CONSOLE, { businessId }, NOW)));
    expect(new Set(results.map((r) => r.number)).size).toBe(6);
    const again = await Promise.all([inv.createActivationInvoice(CONSOLE, { businessId: "biz1" }, NOW), inv.createActivationInvoice(CONSOLE, { businessId: "biz1" }, NOW)]);
    expect(again.map((r) => r.id)).toEqual([results[0].id, results[0].id]);
    expect(again.every((r) => !r.created)).toBe(true);
    expect(h.db.invoice.rows.filter((r) => r.businessId === "biz1")).toHaveLength(1);
  });

  it("a race past the draft check is caught by the one-draft index and returns the winner", async () => {
    seed();
    const first = await inv.createActivationInvoice(CONSOLE, { businessId: "biz1" }, NOW);
    // The second caller read "no draft" before the first wrote it.
    h.db.invoice.findFirst.mockResolvedValueOnce(null);
    const second = await inv.createActivationInvoice(CONSOLE, { businessId: "biz1" }, NOW);
    expect(second).toEqual({ id: first.id, number: first.number, created: false });
  });
});

describe("activation: No trial, send invoice", () => {
  it("drafts the chosen plan at the region's RWF price, due in 3 days; the demo booking is done; audited", async () => {
    seed();
    const r = await inv.createActivationInvoice(CONSOLE, { businessId: "biz1" }, NOW);
    expect(r).toMatchObject({ number: "BP-INV-0001", created: true });
    expect(invoice()).toMatchObject({ status: "draft", currency: "RWF", planKey: "PRO", interval: "MONTH", subtotalMinor: 35000, taxMinor: 0, totalMinor: 35000, createdBy: "admin" });
    expect(invoice().lines).toEqual([{ description: "BuPulse Pro plan, monthly (1 month)", quantity: 1, unitMinor: 35000 }]);
    expect(invoice().issueDate.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(invoice().dueDate.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(h.db.demoBooking.rows[0].status).toBe("done");
    expect(audits("create_invoice")).toHaveLength(1);
    expect(h.db.subscription.rows[0].status).toBe("PENDING_DEMO"); // nothing opens until it is paid
  });

  it("yearly, VAT from the settings, USD outside Rwanda", async () => {
    seed();
    h.db.adminSetting.rows.push({ key: INVOICE_SETTING_KEY, value: { vatRatePercent: 18 } });
    await inv.createActivationInvoice(CONSOLE, { businessId: "biz1", interval: "YEAR" }, NOW);
    expect(invoice()).toMatchObject({ interval: "YEAR", subtotalMinor: 350000, taxRatePercent: 18, taxMinor: 63000, totalMinor: 413000 });
    company("bizG", OTHER, { region: "GLOBAL" });
    // GLOBAL offers a plan when it has a GLOBAL row; the amounts are the plan's own USD prices (docs/REGIONS.md).
    h.db.planRegionPrice.rows.push({ id: "prp_pro_g", planKey: "PRO", regionKey: "GLOBAL", currency: "USD", monthlyMinor: 9900, yearlyMinor: 99000 });
    resetRegionPriceCache();
    await inv.createActivationInvoice(CONSOLE, { businessId: "bizG" }, NOW);
    expect(h.db.invoice.rows[1]).toMatchObject({ currency: "USD", subtotalMinor: 9900 });
  });

  it("refuses the API, a plan the region does not sell, and a company already paying", async () => {
    seed();
    expect(await code(inv.createActivationInvoice(API, { businessId: "biz1" }, NOW))).toBe("forbidden");
    expect(await msg(inv.createActivationInvoice(CONSOLE, { businessId: "biz1", planKey: "STARTER_NOPE" }, NOW))).toMatch(/not offered in/);
    h.db.subscription.rows[0] = { ...h.db.subscription.rows[0], status: "ACTIVE", plan: "PRO", currentPeriodEnd: new Date("2026-11-01T00:00:00Z") };
    expect(await code(inv.createActivationInvoice(CONSOLE, { businessId: "biz1" }, NOW))).toBe("conflict");
    expect(h.db.invoice.rows).toHaveLength(0);
  });
});

describe("the editor", () => {
  it("saves lines, due date, notes and billing contact, and recomputes the totals with the VAT setting", async () => {
    seed();
    const id = await draft();
    h.db.adminSetting.rows.push({ key: INVOICE_SETTING_KEY, value: { vatRatePercent: 18 } });
    await inv.updateInvoiceDraft(CONSOLE, id, { lines: [{ description: "Pro plan", quantity: 1, unitMinor: 30000 }, { description: "Set-up", quantity: 2, unitMinor: 5000 }], dueDate: "2026-10-20", notes: "Discount agreed in the demo", billingEmail: "Accounts@Inzu.rw" });
    expect(invoice()).toMatchObject({ subtotalMinor: 40000, taxRatePercent: 18, taxMinor: 7200, totalMinor: 47200, notes: "Discount agreed in the demo", billingEmail: "accounts@inzu.rw" });
    expect(invoice().dueDate.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(audits("update_invoice")).toHaveLength(1);
  });

  it("refuses bad input with the first problem, and anything but a draft", async () => {
    seed();
    const id = await draft();
    const bad = (raw: object) => msg(inv.updateInvoiceDraft(CONSOLE, id, { lines: [{ description: "x", quantity: 1, unitMinor: 1 }], dueDate: "2026-10-20", notes: "", billingEmail: "", ...raw }));
    expect(await bad({ lines: [] })).toBe("Add at least one line.");
    expect(await bad({ dueDate: "2026-10-01" })).toBe("The due date cannot be before the issue date.");
    expect(await bad({ lines: [{ description: "x", quantity: -1, unitMinor: 1 }] })).toBe("The quantity is at least 1.");
    expect(await bad({ billingEmail: "nope" })).toMatch(/email address/);
    expect(audits("update_invoice")).toHaveLength(0);
    await inv.sendInvoice(CONSOLE, id, NOW);
    expect(await code(inv.updateInvoiceDraft(CONSOLE, id, { lines: [{ description: "x", quantity: 1, unitMinor: 1 }], dueDate: "2026-10-20", notes: "", billingEmail: "" }))).toBe("conflict");
    expect(await code(inv.updateInvoiceDraft(API, id, {}))).toBe("forbidden");
  });
});

describe("send", () => {
  it("emails owner and billing contact once, with the PDF attached and a Pay online link; stores the PDF; audited", async () => {
    seed();
    const id = await draft();
    await inv.updateInvoiceDraft(CONSOLE, id, { lines: [{ description: "Pro plan", quantity: 1, unitMinor: 35000 }], dueDate: "2026-10-16", notes: "", billingEmail: "accounts@inzu.rw" });
    const r = await inv.sendInvoice(CONSOLE, id, NOW);
    expect(r).toMatchObject({ number: "BP-INV-0001", to: ["biz1@example.rw", "accounts@inzu.rw"], emailed: 2, failed: 0 });
    expect(invoice()).toMatchObject({ status: "sent", sentTo: ["biz1@example.rw", "accounts@inzu.rw"], pdfPath: "pdf/biz1/BP-INV-0001.pdf" });
    expect(invoice().billTo).toMatchObject({ businessName: "Inzu Fashion", ownerName: "Aline Uwase", phone: "+250 788 123 456", address: "M Peace Plaza, 8th floor — KN 4 Avenue, Kigali" });
    expect(invoice().seller).toMatchObject({ seller: { businessName: "BuPulse" }, payment: { details: { merchantCode: "123456" } } });
    const mail = h.sendEmail.mock.calls[0][0];
    expect(mail.subject).toBe("Invoice BP-INV-0001 from BuPulse: 35,000 RWF due 16 October 2026");
    expect(mail.html).toContain("https://bupulse.com/dashboard/billing?invoice=BP-INV-0001");
    expect(mail.html).toContain("16 October 2026");
    expect(mail.attachments?.[0].filename).toBe("BP-INV-0001.pdf");
    const pdf = Buffer.from(mail.attachments?.[0].content ?? "", "base64");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(h.stored.get("pdf/biz1/BP-INV-0001.pdf")?.length).toBe(pdf.length);
    expect(audits("send_invoice")).toHaveLength(1);
    // A second click: refused, no second email, no second audit row.
    expect(await code(inv.sendInvoice(CONSOLE, id, NOW))).toBe("conflict");
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    expect(audits("send_invoice")).toHaveLength(1);
  });

  it("still sends when Storage is down (downloads draw it again), and reports a failed email", async () => {
    seed();
    const id = await draft();
    h.putFails = true;
    h.sendEmail.mockResolvedValueOnce(false);
    const r = await inv.sendInvoice(CONSOLE, id, NOW);
    expect(r).toMatchObject({ emailed: 0, failed: 1 });
    expect(invoice()).toMatchObject({ status: "sent", pdfPath: null });
    const again = await inv.invoicePdf(invoice() as never);
    expect(Buffer.from(again.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("refuses a due date that has passed, and the API", async () => {
    seed();
    const id = await draft();
    expect(await msg(inv.sendInvoice(CONSOLE, id, new Date("2026-10-20T08:00:00Z")))).toMatch(/due date has passed/);
    expect(await code(inv.sendInvoice(API, id, NOW))).toBe("forbidden");
    expect(invoice().status).toBe("draft");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe("Mobile Money with the invoice number as the reference", () => {
  it("client pays the invoice total with reference = number; confirming marks the invoice paid and activates its plan", async () => {
    seed();
    const id = await sent();
    const pay = await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    expect(pay).toMatchObject({ reference: "BP-INV-0001", invoiceId: id, amountMinor: 35000, currency: "RWF", planKey: "PRO", interval: "MONTH" });
    // Starting again returns the same payment.
    expect((await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW })).id).toBe(pay.id);
    await momo.submitManualProof(USER, { paymentId: pay.id, transactionId: "MP99887766", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    const done = await momo.confirmManualPayment(CONSOLE, pay.id, NOW);
    expect(done.status).toBe("confirmed");
    expect(invoice()).toMatchObject({ status: "paid", paidBy: `manual_payment:${pay.id}` });
    expect(h.db.subscription.rows[0]).toMatchObject({ status: "ACTIVE", plan: "PRO", provider: "MANUAL_MOMO", interval: "MONTH" });
    expect(audits("invoice_paid")).toHaveLength(1);
    expect(h.db.billingEvent.rows[0].payload.data).toMatchObject({ id: "BP-INV-0001", invoice_id: id, amount_minor: 35000 });
    // Replay: the paid invoice cannot be paid again, and the confirmed payment cannot be confirmed twice.
    expect(await msg(momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW }))).toBe("This invoice is already paid.");
    expect(await code(momo.confirmManualPayment(CONSOLE, pay.id, NOW))).toBe("conflict");
    expect(audits("invoice_paid")).toHaveLength(1);
  });

  it("a rejected attempt can be retried with the same reference", async () => {
    seed();
    const id = await sent();
    const first = await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    await momo.submitManualProof(USER, { paymentId: first.id, transactionId: "MP111111", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    await momo.rejectManualPayment(CONSOLE, first.id, "No money arrived", NOW);
    const second = await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    expect(second.id).not.toBe(first.id);
    expect(second.reference).toBe("BP-INV-0001");
  });

  it("a voided invoice cannot be paid, and a payment reported for it is not confirmed", async () => {
    seed();
    const id = await sent();
    const pay = await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    await momo.submitManualProof(USER, { paymentId: pay.id, transactionId: "MP222222", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    // Void is refused while a reported payment waits; force the state to check confirm's own guard.
    expect(await code(inv.voidInvoice(CONSOLE, id, "Wrong plan", NOW))).toBe("conflict");
    h.db.invoice.rows[0].status = "void";
    expect(await code(momo.confirmManualPayment(CONSOLE, pay.id, NOW))).toBe("conflict");
    expect(h.db.subscription.rows[0].status).toBe("PENDING_DEMO");
    expect(h.db.manualPayment.rows[0].status).toBe("pending");
    expect(await msg(momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW }))).toMatch(/cancelled/);
  });

  it("another company's invoice, or a draft, is not found", async () => {
    seed();
    const id = await draft();
    expect(await msg(momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW }))).toMatch(/could not find/);
    company("biz2", OTHER);
    await inv.sendInvoice(CONSOLE, id, NOW);
    expect(await msg(momo.startInvoicePayment({ userId: OTHER, invoiceId: id, now: NOW }))).toMatch(/could not find/);
  });
});

describe("mark as paid (by hand)", () => {
  it("goes through the Mobile Money confirmation: plan active, invoice paid, audited, once", async () => {
    seed();
    const id = await sent();
    const r = await inv.markInvoicePaid(CONSOLE, id, { method: "BANK", reference: "TRF-2026-0042" }, NOW);
    expect(r).toMatchObject({ status: "paid", number: "BP-INV-0001" });
    expect(r.periodEnd?.toISOString()).toBe("2026-11-13T08:00:00.000Z");
    const pay = h.db.manualPayment.rows[0];
    expect(pay).toMatchObject({ status: "confirmed", reference: "BP-INV-0001", invoiceId: id, network: "BANK", transactionId: "BP-INV-0001/TRF-2026-0042", amountMinor: 35000 });
    expect(invoice()).toMatchObject({ status: "paid", paidBy: `manual_payment:${pay.id}` });
    expect(h.db.subscription.rows[0]).toMatchObject({ status: "ACTIVE", plan: "PRO" });
    expect(audits("confirm_momo_payment")).toHaveLength(1);
    expect(audits("invoice_paid")).toHaveLength(1);
    expect(await code(inv.markInvoicePaid(CONSOLE, id, { method: "BANK", reference: "TRF-2026-0043" }, NOW))).toBe("conflict");
    expect(h.db.manualPayment.rows).toHaveLength(1);
  });

  it("checks the method and reference, refuses a draft, the API, and waits for a payment the client reported", async () => {
    seed();
    const id = await draft();
    expect(await code(inv.markInvoicePaid(CONSOLE, id, { method: "GOLD", reference: "X12345" }, NOW))).toBe("invalid");
    expect(await code(inv.markInvoicePaid(CONSOLE, id, { method: "CASH", reference: "x" }, NOW))).toBe("invalid");
    expect(await msg(inv.markInvoicePaid(CONSOLE, id, { method: "CASH", reference: "R-0001" }, NOW))).toMatch(/Send invoice/);
    await inv.sendInvoice(CONSOLE, id, NOW);
    expect(await code(inv.markInvoicePaid(API, id, { method: "CASH", reference: "R-0001" }, NOW))).toBe("forbidden");
    const pay = await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    await momo.submitManualProof(USER, { paymentId: pay.id, transactionId: "MP333333", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    expect(await msg(inv.markInvoicePaid(CONSOLE, id, { method: "CASH", reference: "R-0001" }, NOW))).toMatch(/waiting in Payments/);
    expect(invoice().status).toBe("sent");
  });

  it("the same bank or cash receipt text on two invoices is fine; the same MoMo transaction id is still a replay", async () => {
    seed();
    company("biz2", OTHER);
    const first = await sent();
    const second = (await inv.createActivationInvoice(CONSOLE, { businessId: "biz2" }, NOW)).id;
    await inv.sendInvoice(CONSOLE, second, NOW);
    await inv.markInvoicePaid(CONSOLE, first, { method: "CASH", reference: "R-0001" }, NOW);
    await inv.markInvoicePaid(CONSOLE, second, { method: "CASH", reference: "R-0001" }, NOW);
    expect(h.db.invoice.rows.map((r) => r.status)).toEqual(["paid", "paid"]);
    expect(h.db.manualPayment.rows.map((r) => r.transactionId)).toEqual(["BP-INV-0001/R-0001", "BP-INV-0002/R-0001"]);

    // MoMo ids are not scoped: one SMS pays once, across companies.
    company("biz3", `3${USER.slice(1)}`);
    const third = (await inv.createActivationInvoice(CONSOLE, { businessId: "biz3" }, NOW)).id;
    await inv.sendInvoice(CONSOLE, third, NOW);
    h.db.manualPayment.rows[0] = { ...h.db.manualPayment.rows[0], network: "MTN", transactionId: "MP555555" };
    expect(await code(inv.markInvoicePaid(CONSOLE, third, { method: "MTN", reference: "mp555555" }, NOW))).toBe("conflict");
    expect(h.db.invoice.rows[2].status).toBe("sent");
    expect(h.db.manualPayment.rows.at(-1)?.status).toBe("expired");
  });

  it("an unsubmitted payment the client opened gives way", async () => {
    seed();
    const id = await sent();
    await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    await inv.markInvoicePaid(CONSOLE, id, { method: "CASH", reference: "R-0001" }, NOW);
    expect(h.db.manualPayment.rows.map((r) => r.status)).toEqual(["expired", "confirmed"]);
    expect(invoice().status).toBe("paid");
  });
});

describe("void", () => {
  it("voids a draft or a sent invoice with a reason, once; closes an opened payment; never a paid one", async () => {
    seed();
    const id = await sent();
    await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    expect(await code(inv.voidInvoice(CONSOLE, id, "x", NOW))).toBe("invalid");
    await inv.voidInvoice(CONSOLE, id, "Wrong plan, re-issued", NOW);
    expect(invoice()).toMatchObject({ status: "void", voidReason: "Wrong plan, re-issued" });
    expect(h.db.manualPayment.rows[0].status).toBe("expired");
    expect(audits("void_invoice")).toHaveLength(1);
    expect(await code(inv.voidInvoice(CONSOLE, id, "again", NOW))).toBe("conflict");
    expect(audits("void_invoice")).toHaveLength(1);
    expect(await code(inv.voidInvoice(API, id, "again", NOW))).toBe("forbidden");

    // A new draft for the same company is allowed after voiding, and a paid invoice is never voided.
    const second = await inv.createActivationInvoice(CONSOLE, { businessId: "biz1" }, NOW);
    expect(second.number).toBe("BP-INV-0002");
    await inv.sendInvoice(CONSOLE, second.id, NOW);
    await inv.markInvoicePaid(CONSOLE, second.id, { method: "CASH", reference: "R-0002" }, NOW);
    expect(await msg(inv.voidInvoice(CONSOLE, second.id, "Oops", NOW))).toMatch(/Refund/);
  });

  it("with money received for it (a payment flagged for review) a void needs the admin to say they know; the audit keeps the payments", async () => {
    seed();
    const id = await sent();
    h.db.invoice.rows[0].paymentReview = [{ source: "momo", reference: "BP-7K3Q", amountMinor: 20000, currency: "RWF", receivedAt: NOW.toISOString(), planKey: "PRO", interval: "MONTH" }];
    expect(await msg(inv.voidInvoice(CONSOLE, id, "Wrong plan", NOW))).toMatch(/Money was received for BP-INV-0001 \(20,000 RWF by Mobile Money, BP-7K3Q\)/);
    expect(invoice().status).toBe("sent");
    await inv.voidInvoice(CONSOLE, id, "Wrong plan, refunded by MoMo", NOW, { acknowledgePayment: true });
    expect(invoice().status).toBe("void");
    expect(audits("void_invoice")[0].after).toMatchObject({ status: "void", acknowledgedPayments: [expect.objectContaining({ reference: "BP-7K3Q" })] });
  });
});

describe("reminders and card", () => {
  it("one reminder on the due date, with the PDF; none before, none twice, none while Resend is off", async () => {
    seed();
    const id = await sent();
    expect(await inv.sendInvoiceReminders(new Date("2026-10-15T05:41:00Z"))).toBe(0);
    h.off.add("resend");
    expect(await inv.sendInvoiceReminders(new Date("2026-10-16T05:41:00Z"))).toBe(0);
    expect(invoice().reminderSentAt).toBeNull();
    h.off.clear();
    h.sendEmail.mockResolvedValueOnce(false);
    expect(await inv.sendInvoiceReminders(new Date("2026-10-16T05:41:00Z"))).toBe(0);
    expect(invoice().reminderSentAt).toBeNull(); // a failed send gives the claim back
    expect(await inv.sendInvoiceReminders(new Date("2026-10-16T05:41:00Z"))).toBe(1);
    expect(h.sendEmail.mock.calls.at(-1)?.[0]).toMatchObject({ to: "biz1@example.rw", subject: "Reminder: invoice BP-INV-0001 (35,000 RWF) is due 16 October 2026" });
    expect(await inv.sendInvoiceReminders(new Date("2026-10-17T05:41:00Z"))).toBe(0);
    void id;
  });

  it("a completed card payment settles the open invoice it pays; never one sent after it, never on a renewal that does not match", async () => {
    seed();
    const id = await sent(); // BP-INV-0001, PRO monthly, 35,000 RWF, sent at NOW
    h.db.subscription.rows[0] = { ...h.db.subscription.rows[0], provider: "PADDLE", providerSubscriptionId: "sub_1", plan: "PRO", interval: "MONTH", status: "ACTIVE" };
    const pay = (over: Partial<CardPayment> = {}): CardPayment => ({ transactionId: "txn_1", subscriptionId: "sub_1", priceId: null, amountMinor: 2800, currency: "USD", paidAt: new Date("2026-10-14T09:00:00Z"), origin: "web", userId: null, ...over });
    // A payment made before the invoice was sent does not pay it.
    expect(await inv.settleInvoiceFromCardPayment(pay({ paidAt: new Date("2026-10-12T09:00:00Z") }))).toBeNull();
    // A renewal at the card price (another amount and currency) does not pay it either.
    expect(await inv.settleInvoiceFromCardPayment(pay({ origin: "subscription_recurring" }))).toBeNull();
    // Another plan does not.
    h.db.subscription.rows[0].plan = "STANDARD";
    expect(await inv.settleInvoiceFromCardPayment(pay())).toBeNull();
    h.db.subscription.rows[0].plan = "PRO";
    expect(invoice().status).toBe("sent");
    // A first purchase at the plan's USD card price for an RWF invoice cannot be proven to be for it: nothing is marked
    // paid; the payment is recorded on the invoice for an admin to check (it stays sent, so the reminders keep going),
    // audited, and the admins are emailed.
    h.sendEmail.mockClear();
    expect(await inv.settleInvoiceFromCardPayment(pay())).toBeNull();
    expect(invoice()).toMatchObject({ status: "sent", paidBy: null, paymentReview: [{ source: "paddle", reference: "txn_1", amountMinor: 2800, currency: "USD", planKey: "PRO", interval: "MONTH" }] });
    expect(audits("invoice_paid")).toHaveLength(0);
    expect(audits("invoice_payment_review")).toHaveLength(1);
    expect(h.sendEmail.mock.calls.map((c) => c[0].subject)).toEqual(["Payment received for BP-INV-0001: check and mark paid"]);
    // A replay of the same transaction adds nothing and alerts nobody again; a second, different payment is APPENDED
    // (never overwrites the first) and the admins are told it may be a double payment.
    h.sendEmail.mockClear();
    await inv.settleInvoiceFromCardPayment(pay());
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(invoice().paymentReview).toHaveLength(1);
    expect(await inv.settleInvoiceFromCardPayment(pay({ transactionId: "txn_1b", amountMinor: 2900 }))).toBeNull();
    expect(invoice().paymentReview.map((r: { reference: string }) => r.reference)).toEqual(["txn_1", "txn_1b"]);
    expect(h.sendEmail.mock.calls.map((c) => c[0].subject)).toEqual(["Second payment received for BP-INV-0001: possible double payment"]);
    // The client cannot start another payment for it while one is being checked; a void needs the admin's say-so.
    expect(await msg(momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW }))).toBe("A payment for this invoice is being checked. We'll confirm shortly.");
    expect(await code(inv.voidInvoice(CONSOLE, id, "Wrong plan", NOW))).toBe("conflict");
    expect(invoice().status).toBe("sent");
    // Marking it paid first: a refunded card transaction (Paddle adjustment) is refused.
    h.db.billingEvent.rows.push({ id: "adj1", provider: "PADDLE", eventId: "evt_adj", type: "adjustment.created", payload: { data: { transaction_id: "txn_1", action: "refund", status: "approved" } }, createdAt: new Date() });
    expect(await msg(inv.markInvoicePaid(CONSOLE, id, { method: "BANK", reference: "BANK-REF-1" }, NOW))).toMatch(/Paddle shows transaction txn_1 as refunded/);
    h.db.billingEvent.rows.length = 0;
    // The admin's method and reference are in the audit row beside the payments they confirmed.
    h.db.invoice.rows[0].paymentReview = h.db.invoice.rows[0].paymentReview.slice(0, 1);
    await inv.markInvoicePaid(CONSOLE, id, { method: "BANK", reference: "BANK-REF-1" }, NOW);
    expect(invoice()).toMatchObject({ status: "paid", paidBy: "paddle:txn_1" });
    expect(audits("invoice_paid")[0].after).toMatchObject({ paidBy: "paddle:txn_1", adminMethod: "BANK", adminReference: "BANK-REF-1", confirmedPayments: [expect.objectContaining({ reference: "txn_1" })] });
    // A voided invoice with money received: shown in a separate test below. Here: back to an open one for the exact match.
    invoice().status = "sent";
    invoice().paidBy = null;
    invoice().paymentReview = null;
    for (let i = h.db.auditLog.rows.length - 1; i >= 0; i--) if (h.db.auditLog.rows[i].action === "invoice_paid") h.db.auditLog.rows.splice(i, 1);
    // The same amount and currency as the invoice settles it, once.
    expect(await inv.settleInvoiceFromCardPayment(pay({ transactionId: "txn_2", amountMinor: 35000, currency: "RWF" }))).toBe(id);
    expect(invoice()).toMatchObject({ status: "paid", paidBy: "paddle:txn_2" });
    expect(await inv.settleInvoiceFromCardPayment(pay({ transactionId: "txn_3", amountMinor: 35000, currency: "RWF" }))).toBeNull();
    expect(audits("invoice_paid")).toHaveLength(1);
  });

  it("auto-settles only on an exact total or a single plan line of the paid amount; anything else is for review", () => {
    const at = (iso: string) => new Date(iso);
    const line = (unitMinor: number) => ({ description: "Plan", quantity: 1, unitMinor });
    const base = { currency: "USD", planKey: "PRO", interval: "MONTH" };
    const invs = [
      { id: "a", sentAt: at("2026-10-01T00:00:00Z"), totalMinor: 4900, lines: [line(4900)], ...base },
      { id: "b", sentAt: at("2026-10-05T00:00:00Z"), totalMinor: 4900, lines: [line(4900)], ...base },
      { id: "c", sentAt: at("2026-10-06T00:00:00Z"), totalMinor: 9900, lines: [line(4900), { description: "Setup", quantity: 1, unitMinor: 5000 }], ...base },
      { id: "late", sentAt: at("2026-10-20T00:00:00Z"), totalMinor: 4900, lines: [line(4900)], ...base },
    ];
    const plan = { plan: "PRO", interval: "MONTH" };
    const pay = (amountMinor: number, origin = "web", currency = "USD") => ({ amountMinor, currency, paidAt: at("2026-10-10T00:00:00Z"), origin });
    // Exact total: the newest exact match, whatever the origin.
    expect(matchInvoicePayment(invs, pay(4900), plan)).toMatchObject({ settle: { id: "b" }, review: null });
    // A renewal never pays or flags an invoice, even at the same amount.
    expect(matchInvoicePayment(invs, pay(4900, "subscription_recurring"), plan)).toEqual({ settle: null, review: null });
    // A payment equal to the single plan line of an invoice that has a setup fee on top does NOT pay that invoice (its total is larger)...
    expect(matchInvoicePayment([invs[2]], pay(4900), plan)).toMatchObject({ settle: null, review: { id: "c" } });
    // ...while one that matches nothing is for review (newest candidate), and a renewal needs no review at all.
    expect(matchInvoicePayment(invs, pay(1234), plan)).toMatchObject({ settle: null, review: { id: "c" } });
    expect(matchInvoicePayment(invs, pay(1234, "subscription_recurring"), plan)).toEqual({ settle: null, review: null });
    expect(matchInvoicePayment(invs, pay(4900, "web", "RWF"), plan)).toMatchObject({ settle: null, review: { id: "c" } }); // wrong currency
    // A single plan line that equals the payment settles even when tax makes the total higher.
    const taxed = { id: "t", sentAt: at("2026-10-02T00:00:00Z"), totalMinor: 5782, lines: [line(4900)], ...base };
    expect(matchInvoicePayment([taxed], pay(4900), plan).settle?.id).toBe("t");
    expect(invoiceForCardPayment(invs, pay(1234), plan)).toBeNull();
    expect(cardPaymentOf({ event_type: "subscription.updated", data: { id: "sub_1" } })).toBeNull();
    expect(cardPaymentOf({ event_type: "transaction.completed", data: { id: "txn_1", details: { totals: { grand_total: "4900", currency_code: "USD" } } } })).toMatchObject({ amountMinor: 4900, currency: "USD" });
  });
});

describe("the client sees only its own invoices", () => {
  it("drafts are hidden, another company's invoice is not found, and the PDF is the stored one", async () => {
    seed();
    company("biz2", OTHER);
    const id = await draft();
    expect(await inv.clientInvoices("biz1", NOW)).toEqual([]);
    expect(await inv.clientInvoiceRow("biz1", id)).toBeNull();
    await inv.sendInvoice(CONSOLE, id, NOW);
    expect((await inv.clientInvoices("biz1", NOW)).map((i) => i.number)).toEqual(["BP-INV-0001"]);
    expect(await inv.clientInvoices("biz2", NOW)).toEqual([]);
    expect(await inv.clientInvoiceRow("biz2", id)).toBeNull();
    expect(await inv.clientInvoiceRow("biz2", "BP-INV-0001")).toBeNull();
    expect(await inv.clientInvoiceRow("", id)).toBeNull();
    const row = await inv.clientInvoiceRow("biz1", "BP-INV-0001");
    expect(row?.id).toBe(id);
    const pdf = await inv.invoicePdf(row as never);
    expect(pdf).toBe(h.stored.get("pdf/biz1/BP-INV-0001.pdf"));
    expect((await inv.openInvoiceOf("biz1"))?.id).toBe(id);
    expect(await inv.openInvoiceOf("biz2")).toBeNull();
  });

  it("a paid invoice's PDF is drawn again with PAID on it", async () => {
    seed();
    const id = await sent();
    await inv.markInvoicePaid(CONSOLE, id, { method: "CASH", reference: "R-0001" }, NOW);
    const pdf = await inv.invoicePdf(invoice() as never);
    expect(pdf).not.toBe(h.stored.get("pdf/biz1/BP-INV-0001.pdf"));
    const raw = Buffer.from(pdf).toString("latin1");
    const texts = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map((m) => {
      try {
        return inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
      } catch {
        return "";
      }
    });
    const hex = Buffer.from("PAID", "latin1").toString("hex").toUpperCase();
    expect(texts.join("")).toContain(hex);
  });
});

describe("admin list", () => {
  it("filters by status (overdue = sent and past due) and searches number or company name", async () => {
    seed();
    company("biz2", OTHER);
    await sent();
    await inv.createActivationInvoice(CONSOLE, { businessId: "biz2" }, NOW);
    expect((await inv.listInvoices({}, NOW)).map((i) => i.number).sort()).toEqual(["BP-INV-0001", "BP-INV-0002"]);
    expect((await inv.listInvoices({ status: "draft" }, NOW)).map((i) => i.company)).toEqual(["Other Shop"]);
    expect(await inv.listInvoices({ status: "overdue" }, NOW)).toEqual([]);
    expect((await inv.listInvoices({ status: "overdue" }, new Date("2026-10-17T08:00:00Z"))).map((i) => i.number)).toEqual(["BP-INV-0001"]);
    expect((await inv.listInvoices({ q: "inzu" }, NOW)).map((i) => i.number)).toEqual(["BP-INV-0001"]);
    expect((await inv.listInvoices({ q: "inv-0002" }, NOW)).map((i) => i.number)).toEqual(["BP-INV-0002"]);
    expect((await inv.listInvoices({ businessId: "biz2" }, NOW)).map((i) => i.number)).toEqual(["BP-INV-0002"]);
  });
});

describe("deleting a company", () => {
  it("the reference index does not depend on invoiceId, so the SET NULL on its invoices' payments never collides", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("prisma/migrations/20261013090000_invoices/migration.sql", "utf8");
    const index = /CREATE UNIQUE INDEX "ManualPayment_reference_key"[^;]*;/.exec(sql)?.[0] ?? "";
    expect(index).toContain(`WHERE "reference" NOT LIKE 'BP-INV-%'`);
    expect(index).not.toContain("invoiceId");

    seed();
    const id = await sent();
    // Two attempts at the invoice (a rejected one, then the retry) share its number.
    const first = await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    await momo.submitManualProof(USER, { paymentId: first.id, transactionId: "MP444444", payerPhone: "078 123 4567", network: "MTN" }, NOW);
    await momo.rejectManualPayment(CONSOLE, first.id, "No money arrived", NOW);
    await momo.startInvoicePayment({ userId: USER, invoiceId: id, now: NOW });
    // What ON DELETE SET NULL does when the company's invoices go: both rows keep "BP-INV-0001" with no invoice.
    h.db.invoice.rows.splice(0);
    for (const r of h.db.manualPayment.rows) r.invoiceId = null;
    // Another payment with that number, and plain payments, are still accepted; plain references stay unique.
    await expect(h.db.manualPayment.create({ data: { userId: OTHER, planKey: "PRO", interval: "MONTH", amountMinor: 1, reference: "BP-INV-0001", invoiceId: null, status: "expired" } })).resolves.toBeTruthy();
    await h.db.manualPayment.create({ data: { userId: OTHER, planKey: "PRO", interval: "MONTH", amountMinor: 1, reference: "BP-7K3Q", status: "expired" } });
    await expect(h.db.manualPayment.create({ data: { userId: OTHER, planKey: "PRO", interval: "MONTH", amountMinor: 1, reference: "BP-7K3Q", status: "expired" } })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("logo upload", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  it("refuses a decompression bomb (huge declared size) and SVG before storing anything; stores a sane PNG", async () => {
    const { uploadInvoiceLogo } = await import("@/lib/invoices/settings");
    const { putInvoiceObject } = await import("@/lib/invoices/storage");
    expect(await msg(uploadInvoiceLogo(CONSOLE, png(30000, 30000)))).toMatch(/at most 2000 × 2000 pixels \(this one is 30000 × 30000\)/);
    expect(await msg(uploadInvoiceLogo(CONSOLE, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toMatch(/PNG or JPEG/);
    expect(putInvoiceObject).not.toHaveBeenCalled();
    const saved = await uploadInvoiceLogo(CONSOLE, png(400, 120));
    expect(saved).toMatchObject({ logoType: "image/png" });
    expect(putInvoiceObject).toHaveBeenCalledTimes(1);
    expect(audits("set_invoice_logo")).toHaveLength(1);
  });
});
