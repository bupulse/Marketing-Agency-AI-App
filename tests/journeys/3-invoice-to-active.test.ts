import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";
import { authUser, code, companyOf, installSignUp, recipients, seedCatalog, subjects } from "./world";

// Journey 3: after the demo the admin sends an invoice (no trial). The client pays it by Mobile Money quoting the
// invoice number (BP-INV-...), the owner confirms, and the invoice is paid and the plan ACTIVE. A voided invoice cannot
// be paid. docs/INVOICES.md.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string; attachments?: { filename: string; content: string }[] }) => Promise<boolean>>(async () => true),
  track: vi.fn(),
  stored: new Map<string, Uint8Array>(),
}));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup" }, trackEvent: h.track }));
vi.mock("@/lib/invoices/storage", () => ({
  INVOICE_BUCKET: "invoices",
  invoicePdfPath: (b: string, n: string) => `pdf/${b}/${n}.pdf`,
  putInvoiceObject: vi.fn(async (path: string, bytes: Uint8Array) => void h.stored.set(path, bytes)),
  getInvoiceObject: vi.fn(async (path: string) => h.stored.get(path) ?? null),
  removeInvoiceObject: vi.fn(async (path: string) => void h.stored.delete(path)),
}));

import { ensureAccount } from "@/lib/account";
import { companyEntitlements, hasFeature } from "@/lib/entitlements";
import * as momo from "@/lib/billing/momo";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import * as inv from "@/lib/invoices/service";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { clearSwitchCache } from "@/lib/admin/switch";
import { apiContext, consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5");
const AT = new Date("2026-10-13T08:00:00Z");
const audits = (action: string) => h.db.auditLog.rows.filter((r) => r.action === action);

/** A Rwandan company that has had its demo and chose Business. */
async function afterDemo(n: number) {
  await ensureAccount(authUser(n, "Rwanda") as never);
  const company = companyOf(h.db, n);
  company.subscription.chosenPlan = "BUSINESS";
  h.db.demoBooking.rows.push({ id: `demo${n}`, businessId: company.businessId, status: "booked", planKey: "BUSINESS", startsAt: new Date("2026-10-13T07:00:00Z"), endsAt: new Date("2026-10-13T07:30:00Z") });
  return company;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AT);
  h.db = createFakeDb();
  installSignUp(h.db);
  h.stored.clear();
  h.sendEmail.mockClear();
  h.track.mockClear();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
  seedCatalog(h.db);
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "123456", momoNumber: "0788000000", accountName: "BuPulse Ltd" } });
  clearMomoSettingsCache();
  vi.stubEnv("ADMIN_EMAILS", "owner@bupulse.com");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.com");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("journey: invoice -> Mobile Money with BP-INV reference -> paid + ACTIVE", () => {
  it("drafts, sends, is paid by the client, confirmed by the owner, and cannot be paid twice", async () => {
    const { userId, businessId, subscription } = await afterDemo(1);

    // 1. Only the console drafts an invoice, for the plan the client chose at the region's RWF price; the demo is done.
    expect(await code(inv.createActivationInvoice(API, { businessId }, AT))).toMatch(/^forbidden/);
    const draft = await inv.createActivationInvoice(CONSOLE, { businessId }, AT);
    expect(draft).toMatchObject({ number: "BP-INV-0001", created: true });
    expect((await inv.createActivationInvoice(CONSOLE, { businessId }, AT)).created).toBe(false); // one draft per company
    const row = () => h.db.invoice.rows.find((i) => i.id === draft.id)!;
    expect(row()).toMatchObject({ status: "draft", currency: "RWF", planKey: "BUSINESS", interval: "MONTH", totalMinor: 35000 });
    expect(h.db.demoBooking.rows[0].status).toBe("done");
    expect(subscription.status).toBe("PENDING_DEMO");
    // The client cannot see or pay a draft.
    expect(await inv.clientInvoices(businessId, AT)).toEqual([]);
    expect(await code(momo.startInvoicePayment({ userId, invoiceId: draft.id, now: AT }))).toMatch(/could not find that invoice/);

    // 2. Sending emails the client the PDF with a pay link, once; the account is still locked.
    h.sendEmail.mockClear();
    await inv.sendInvoice(CONSOLE, draft.id, AT);
    expect(row()).toMatchObject({ status: "sent", sentTo: ["owner1@example.com"] });
    expect(recipients(h.sendEmail.mock.calls)).toEqual(["owner1@example.com"]);
    expect(subjects(h.sendEmail.mock.calls)[0]).toMatch(/^Invoice BP-INV-0001 from BuPulse: 35,000 RWF due 16 October 2026/);
    expect((h.sendEmail.mock.calls[0][0].attachments ?? [])[0].filename).toBe("BP-INV-0001.pdf");
    expect(h.sendEmail.mock.calls[0][0].html).toContain("https://bupulse.com/dashboard/billing?invoice=BP-INV-0001");
    expect(await code(inv.sendInvoice(CONSOLE, draft.id, AT))).toMatch(/^conflict/);
    expect(audits("send_invoice")).toHaveLength(1);
    expect((await companyEntitlements(businessId)).block).toBe("pending_demo");
    expect(await inv.clientInvoices(businessId, AT)).toEqual([expect.objectContaining({ number: "BP-INV-0001", status: "sent", payable: true })]);

    // 3. The client pays by MoMo: the reference is the invoice number and the amount the invoice total.
    const pay = await momo.startInvoicePayment({ userId, invoiceId: draft.id, now: AT });
    expect(pay).toMatchObject({ reference: "BP-INV-0001", invoiceId: draft.id, amountMinor: 35000, currency: "RWF", planKey: "BUSINESS", interval: "MONTH" });
    expect((await momo.startInvoicePayment({ userId, invoiceId: draft.id, now: AT })).id).toBe(pay.id);
    await momo.submitManualProof(userId, { paymentId: pay.id, transactionId: "MP77001234", payerPhone: "0781234567", network: "MTN" }, AT);
    expect(row().status).toBe("sent"); // reporting is not paying
    // The admin cannot void it from under a reported payment, nor mark it paid on top of it.
    expect(await code(inv.voidInvoice(CONSOLE, draft.id, "Changed our mind", AT))).toMatch(/^conflict: The client has reported a payment/);
    expect(await code(inv.markInvoicePaid(CONSOLE, draft.id, { method: "MTN", reference: "MP5555555" }, AT))).toMatch(/^conflict: The client has reported a payment/);

    // 4. The owner confirms: invoice paid, plan ACTIVE with a period end, revenue and audit rows, the client emailed.
    h.sendEmail.mockClear();
    const done = await momo.confirmManualPayment(CONSOLE, pay.id, AT);
    expect(done).toMatchObject({ status: "confirmed", plan: "BUSINESS", periodEnd: new Date("2026-11-13T08:00:00Z") });
    expect(row()).toMatchObject({ status: "paid", paidBy: `manual_payment:${pay.id}`, paidAt: AT });
    expect(subscription).toMatchObject({ status: "ACTIVE", plan: "BUSINESS", provider: "MANUAL_MOMO", currentPeriodEnd: new Date("2026-11-13T08:00:00Z") });
    expect(audits("invoice_paid")).toHaveLength(1);
    expect(audits("invoice_paid")[0]).toMatchObject({ target: `invoice:${draft.id}`, before: { status: "sent" }, after: { status: "paid", number: "BP-INV-0001", amountMinor: 35000, currency: "RWF" } });
    expect(audits("confirm_momo_payment")[0]).toMatchObject({ after: expect.objectContaining({ invoiceId: draft.id }) });
    expect(h.db.billingEvent.rows[0].payload.data).toMatchObject({ id: "BP-INV-0001", invoice_id: draft.id, amount_minor: 35000 });
    expect(subjects(h.sendEmail.mock.calls)).toEqual(["Your BuPulse Business plan is active"]);
    expect((await companyEntitlements(businessId)).block).toBeNull();
    for (const feature of ["content", "websiteChat", "webhooks", "apiAccess"] as const) expect(await hasFeature(businessId, feature)).toBe(true);
    expect((await inv.clientInvoices(businessId, AT))[0]).toMatchObject({ status: "paid", payable: false });

    // 5. Replays change nothing: no second payment, no second confirmation, no void of a paid invoice.
    expect(await code(momo.startInvoicePayment({ userId, invoiceId: draft.id, now: AT }))).toMatch(/already paid/);
    expect(await code(momo.confirmManualPayment(CONSOLE, pay.id, AT))).toMatch(/^conflict: This payment is already confirmed/);
    expect(await code(inv.voidInvoice(CONSOLE, draft.id, "Oops", AT))).toMatch(/^conflict: .*is paid/);
    expect(await code(inv.markInvoicePaid(CONSOLE, draft.id, { method: "CASH", reference: "RECEIPT-001" }, AT))).toMatch(/^conflict: .*already paid/);
    expect(audits("invoice_paid")).toHaveLength(1);
    expect(h.db.billingEvent.rows).toHaveLength(1);
  });

  it("a voided invoice cannot be paid; the client's opened payment is closed with it; a new invoice can follow", async () => {
    const { userId, businessId, subscription } = await afterDemo(1);
    const first = await inv.createActivationInvoice(CONSOLE, { businessId }, AT);
    await inv.sendInvoice(CONSOLE, first.id, AT);
    // The client opened the pay screen but has not paid yet.
    const opened = await momo.startInvoicePayment({ userId, invoiceId: first.id, now: AT });

    expect(await code(inv.voidInvoice(CONSOLE, first.id, "x", AT))).toMatch(/^invalid/); // a reason is required
    h.sendEmail.mockClear();
    await inv.voidInvoice(CONSOLE, first.id, "Wrong plan on the invoice", AT);
    expect(h.db.invoice.rows[0]).toMatchObject({ status: "void", voidReason: "Wrong plan on the invoice" });
    expect(h.db.manualPayment.rows.find((p) => p.id === opened.id)).toMatchObject({ status: "expired" });
    expect(audits("void_invoice")[0]).toMatchObject({ before: { status: "sent" }, after: expect.objectContaining({ status: "void", number: "BP-INV-0001" }) });
    // Cannot be paid any more, in any way, and nothing was activated.
    expect(await code(momo.startInvoicePayment({ userId, invoiceId: first.id, now: AT }))).toMatch(/cancelled/);
    expect(await code(inv.markInvoicePaid(CONSOLE, first.id, { method: "MTN", reference: "MP1234567" }, AT))).toMatch(/^conflict: .*already void/);
    expect(await code(inv.sendInvoice(CONSOLE, first.id, AT))).toMatch(/^conflict/);
    expect(await code(inv.voidInvoice(CONSOLE, first.id, "again please", AT))).toMatch(/already void/);
    expect(subscription.status).toBe("PENDING_DEMO");
    expect(audits("invoice_paid")).toHaveLength(0);
    expect((await companyEntitlements(businessId)).block).toBe("pending_demo");
    expect(h.db.manualPayment.rows.filter((p) => p.status === "confirmed")).toHaveLength(0);

    // Even a payment that was reported before a void forced by hand (no console path allows it) is not confirmed.
    const second = await inv.createActivationInvoice(CONSOLE, { businessId, planKey: "STARTER" }, AT);
    expect(second.number).toBe("BP-INV-0002");
    await inv.sendInvoice(CONSOLE, second.id, AT);
    const reported = await momo.startInvoicePayment({ userId, invoiceId: second.id, now: AT });
    await momo.submitManualProof(userId, { paymentId: reported.id, transactionId: "MP99002200", payerPhone: "0781234567", network: "MTN" }, AT);
    h.db.invoice.rows.find((i) => i.id === second.id)!.status = "void";
    expect(await code(momo.confirmManualPayment(CONSOLE, reported.id, AT))).toMatch(/^conflict: Invoice BP-INV-0002 is already void/);
    expect(subscription.status).toBe("PENDING_DEMO");

    // The owner marks a fresh invoice paid by hand (MTN receipt): the same confirmation, the same result.
    const third = await inv.createActivationInvoice(CONSOLE, { businessId, planKey: "STARTER" }, AT);
    await inv.sendInvoice(CONSOLE, third.id, AT);
    // The reported-but-voided payment still sits in the queue: the admin settles it first.
    await momo.rejectManualPayment(CONSOLE, reported.id, "Invoice was cancelled; refunding by MoMo", AT);
    const paid = await inv.markInvoicePaid(CONSOLE, third.id, { method: "MTN", reference: "MP-RCPT-1234" }, AT);
    expect(paid).toMatchObject({ status: "paid", number: "BP-INV-0003" });
    expect(subscription).toMatchObject({ status: "ACTIVE", plan: "STARTER", provider: "MANUAL_MOMO" });
    expect(h.db.invoice.rows.find((i) => i.id === third.id)).toMatchObject({ status: "paid" });
  });

  // A plain Mobile Money payment (BP-XXXX, from the pay screen) for the invoiced plan settles at most one open invoice,
  // by the card rules (invoiceForCardPayment); an invoice of another plan, a void or a draft one is never touched.
  it("a plain Mobile Money payment for the invoiced plan also settles the open invoice", async () => {
    const { userId, businessId } = await afterDemo(1);
    const draft = await inv.createActivationInvoice(CONSOLE, { businessId }, AT);
    await inv.sendInvoice(CONSOLE, draft.id, AT);
    const plain = await momo.startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: AT });
    expect(plain.invoiceId).toBeNull();
    await momo.submitManualProof(userId, { paymentId: plain.id, transactionId: "MP88112233", payerPhone: "0781234567", network: "MTN" }, AT);
    await momo.confirmManualPayment(CONSOLE, plain.id, AT);
    expect(h.db.subscription.rows[0]).toMatchObject({ status: "ACTIVE", plan: "BUSINESS" });
    expect(h.db.invoice.rows[0]).toMatchObject({ status: "paid", paidBy: `momo:${plain.reference}`, paidAt: AT });
    expect(audits("invoice_paid")).toHaveLength(1);
    expect(audits("invoice_paid")[0]).toMatchObject({ actor: "admin", target: `invoice:${draft.id}`, after: expect.objectContaining({ paidBy: `momo:${plain.reference}`, amountMinor: 35000 }) });
    // The payment itself stays a plain one, and the reminder no longer chases the paid invoice.
    expect(h.db.manualPayment.rows[0].invoiceId).toBeNull();
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
    expect(await inv.sendInvoiceReminders(new Date())).toBe(0);
  });

  it("settles only the matching invoice: not another plan's, not a void or draft one, and only one of two open ones", async () => {
    const { userId, businessId } = await afterDemo(1);
    const rows = h.db.invoice.rows;
    const base = { businessId, status: "sent", currency: "RWF", interval: "MONTH", sentAt: new Date("2026-10-12T08:00:00Z"), taxMinor: 0, dueDate: new Date("2026-10-30T00:00:00Z"), reminderSentAt: null };
    rows.push(
      { ...base, id: "i_old", number: "BP-INV-0001", planKey: "BUSINESS", totalMinor: 35000, subtotalMinor: 35000, sentAt: new Date("2026-10-11T08:00:00Z") },
      { ...base, id: "i_new", number: "BP-INV-0002", planKey: "BUSINESS", totalMinor: 35000, subtotalMinor: 35000 },
      { ...base, id: "i_other", number: "BP-INV-0003", planKey: "STARTER", totalMinor: 15000, subtotalMinor: 15000 },
      { ...base, id: "i_void", number: "BP-INV-0004", planKey: "BUSINESS", totalMinor: 35000, subtotalMinor: 35000, status: "void" },
      { ...base, id: "i_draft", number: "BP-INV-0005", planKey: "BUSINESS", totalMinor: 35000, subtotalMinor: 35000, status: "draft", sentAt: null },
      { ...base, id: "i_year", number: "BP-INV-0006", planKey: "BUSINESS", totalMinor: 350000, subtotalMinor: 350000, interval: "YEAR" },
    );
    const plain = await momo.startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: AT });
    await momo.submitManualProof(userId, { paymentId: plain.id, transactionId: "MP88112244", payerPhone: "0781234567", network: "MTN" }, AT);
    await momo.confirmManualPayment(CONSOLE, plain.id, AT);
    const status = (id: string) => rows.find((i) => i.id === id)!.status;
    // Two equal exact matches: the newest one is settled, the older stays open.
    expect(["i_old", "i_new", "i_other", "i_void", "i_draft", "i_year"].map(status)).toEqual(["sent", "paid", "sent", "void", "draft", "sent"]);
    expect(audits("invoice_paid")).toHaveLength(1);
  });

  it("a payment confirmed before the invoice was sent does not settle it", async () => {
    const { userId, businessId } = await afterDemo(1);
    h.db.invoice.rows.push({ id: "i_later", businessId, number: "BP-INV-0001", status: "sent", currency: "RWF", planKey: "BUSINESS", interval: "MONTH", totalMinor: 35000, subtotalMinor: 35000, taxMinor: 0, sentAt: new Date(AT.getTime() + 3_600_000), reminderSentAt: null });
    const plain = await momo.startManualPayment({ userId, plan: "BUSINESS", interval: "MONTH", now: AT });
    await momo.submitManualProof(userId, { paymentId: plain.id, transactionId: "MP88112255", payerPhone: "0781234567", network: "MTN" }, AT);
    await momo.confirmManualPayment(CONSOLE, plain.id, AT);
    expect(h.db.invoice.rows[0].status).toBe("sent");
  });
});
