import "server-only";
import type { BillingInterval, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, consoleContext, type AdminContext } from "@/lib/admin/types";
import { siteUrl } from "@/lib/auth/site-url";
import { readKnowledge } from "@/lib/brand/schemas";
import { confirmManualPayment } from "@/lib/billing/momo";
import { sendInvoiceReviewAlertEmail } from "@/lib/billing/momo-emails";
import { transactionIdSchema, usdCentsOf } from "@/lib/billing/momo-shared";
import { getSetting } from "@/lib/admin/settings";
import { INVOICE_PAID_EVENT } from "@/lib/analytics/math";
import { locationText } from "@/lib/business-info/locations";
import { logError } from "@/lib/errors";
import { isServiceEnabled } from "@/lib/admin/switch";
import { getPlan } from "@/lib/plan-catalog";
import { companyPlans, planForAnyPriceId } from "@/lib/region-prices";
import { sendInvoiceEmail, sendInvoiceReminderEmail } from "./emails";
import { renderInvoicePdf } from "./pdf";
import { getInvoiceSettings, loadInvoiceLogo, paymentInstructionsFor } from "./settings";
import {
  addDaysYmd,
  computeTotals,
  dateOfYmd,
  DEFAULT_DUE_DAYS,
  formatInvoiceMoney,
  formatInvoiceNumber,
  matchInvoicePayment,
  readPaymentReviews,
  withPaymentReview,
  type PaymentReview,
  intervalLabel,
  invoiceToday,
  isInvoiceNumber,
  isInvoiceStatus,
  isOverdue,
  longInvoiceDate as longInvoiceDateOf,
  readLines,
  validateDraft,
  ymdOf,
  type BillTo,
  type CardPayment,
  type InvoiceDocument,
  type InvoiceLine,
  type InvoicePayDetails,
  type InvoiceStatus,
  type Seller,
} from "./shared";
import { getInvoiceObject, invoicePdfPath, putInvoiceObject } from "./storage";

// Invoices (docs/INVOICES.md). The admin side (create on activation, edit a draft, send, mark paid, void) runs in the
// console only and is audited; every change is one conditional write on the status, so a double click or two admins
// cannot send, pay or void twice. The client side only ever reads invoices of its own company.

type Row = Prisma.InvoiceGetPayload<object>;
type Db = Pick<typeof prisma, "$queryRaw">;

/** What a sent invoice keeps of the seller, so later settings changes never rewrite it. */
type SellerSnapshot = { seller: Seller; payment: { instructions: string; details: InvoicePayDetails }; logoPath: string; logoType: string };

const isUnique = (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");

/** Invoices change in the console only (never through the Jarvis API): money owed by a client is the owner's call. */
function requireConsole(ctx: AdminContext) {
  if (ctx.viaApi || ctx.actor !== "admin") throw new AdminError("forbidden", "Invoices are created, sent, paid and voided in the admin console.");
}

/**
 * The next invoice number, "BP-INV-0001" onwards. A Postgres sequence: nextval is atomic and never hands out the same
 * value twice, so concurrent creations get distinct numbers without locks. Unused values (a failed create) leave a gap,
 * which is fine; numbers are never reused.
 */
export async function nextInvoiceNumber(db: Db = prisma): Promise<string> {
  const [row] = await db.$queryRaw<{ n: bigint | number }[]>`SELECT nextval('"Invoice_number_seq"') AS n`;
  if (row?.n === undefined || row.n === null) throw new Error("The invoice number sequence did not answer.");
  return formatInvoiceNumber(typeof row.n === "bigint" ? row.n : BigInt(row.n));
}

export const payUrlOf = (number: string) => `${siteUrl()}/dashboard/billing?invoice=${encodeURIComponent(number)}`;

async function planLabelOf(row: Pick<Row, "planKey" | "interval">): Promise<string | null> {
  if (!row.planKey) return null;
  const plan = await getPlan(row.planKey);
  return `${plan?.name ?? row.planKey}, ${intervalLabel(row.interval)}`;
}

/** Who the invoice is for, from the company's details: name, owner, phone, email and head office. */
async function billToOf(businessId: string): Promise<{ billTo: BillTo; ownerEmail: string | null; userId: string }> {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, ceoName: true, phone: true, country: true, knowledge: true, userId: true, user: { select: { email: true, name: true } } },
  });
  if (!b) throw new AdminError("not_found", "No company with that id.");
  const head = readKnowledge(b.knowledge).locations.find((l) => l.kind === "head") ?? null;
  return {
    billTo: {
      businessName: b.name,
      ownerName: b.user?.name?.trim() || b.ceoName || null,
      email: b.user?.email ?? null,
      phone: b.phone ?? null,
      address: head ? locationText(head) : null,
      country: b.country ?? null,
    },
    ownerEmail: b.user?.email ?? null,
    userId: b.userId,
  };
}

async function sellerSnapshot(): Promise<SellerSnapshot> {
  const s = await getInvoiceSettings();
  const seller: Seller = { businessName: s.businessName, address: s.address, email: s.email, phone: s.phone, website: s.website, tin: s.tin, footer: s.footer, accentColor: s.accentColor, hasLogo: Boolean(s.logoPath) };
  return { seller, payment: await paymentInstructionsFor(s), logoPath: s.logoPath, logoType: s.logoType };
}

function readSnapshot(value: unknown): SellerSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SellerSnapshot>;
  return v.seller && v.payment ? (v as SellerSnapshot) : null;
}

/**
 * The page the PDF and the preview draw. A sent invoice uses what was frozen when it was sent; a draft is drawn from
 * the current settings and company details, as it would go out now.
 */
export async function invoiceDocument(row: Row): Promise<{ doc: InvoiceDocument; logo: { path: string; type: string } }> {
  const frozen = row.status !== "draft" ? readSnapshot(row.seller) : null;
  const snap = frozen ?? (await sellerSnapshot());
  const billTo = (row.status !== "draft" && row.billTo && typeof row.billTo === "object" ? (row.billTo as BillTo) : null) ?? (await billToOf(row.businessId)).billTo;
  return {
    doc: {
      number: row.number,
      status: row.status as InvoiceStatus,
      currency: row.currency,
      issueDate: ymdOf(row.issueDate),
      dueDate: ymdOf(row.dueDate),
      lines: readLines(row.lines),
      subtotalMinor: row.subtotalMinor,
      taxRatePercent: row.taxRatePercent,
      taxMinor: row.taxMinor,
      totalMinor: row.totalMinor,
      notes: row.notes,
      planLabel: await planLabelOf(row),
      seller: snap.seller,
      billTo,
      payment: { ...snap.payment, reference: row.number, payUrl: payUrlOf(row.number) },
      paidAt: row.paidAt ? ymdOf(row.paidAt) : null,
    },
    logo: { path: snap.logoPath, type: snap.logoType },
  };
}

/** The invoice PDF, drawn now. */
export async function renderInvoice(row: Row): Promise<Uint8Array> {
  const { doc, logo } = await invoiceDocument(row);
  return renderInvoicePdf(doc, await loadInvoiceLogo(logo.path, logo.type));
}

/**
 * The PDF to download: a sent invoice is the copy stored when it was emailed; a paid or void one is drawn again with
 * its PAID / VOID mark (from the frozen details); a draft is drawn from the current settings.
 */
export async function invoicePdf(row: Row): Promise<Uint8Array> {
  if (row.status === "sent" && row.pdfPath) {
    const stored = await getInvoiceObject(row.pdfPath);
    if (stored) return stored;
  }
  return renderInvoice(row);
}

// ---- admin: create (activation), edit, send, mark paid, void ------------------------------------------------

/**
 * "Activate account -> No trial, send invoice" after the demo: a DRAFT invoice for the client's chosen plan (or the one
 * the admin picks) and interval at the company region's price (RWF in Rwanda, USD elsewhere), due in DEFAULT_DUE_DAYS.
 * Only for a company still waiting for its demo (PENDING_DEMO). The live demo booking is marked done. Opening it twice returns the same draft (one draft per company, also a partial
 * unique index). Audited.
 */
export async function createActivationInvoice(ctx: AdminContext, input: { businessId: string; interval?: string; planKey?: string }, now: Date = new Date()) {
  requireConsole(ctx);
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, name: true, userId: true } });
  if (!business) throw new AdminError("not_found", "No company with that id.");
  const sub = await prisma.subscription.findUnique({ where: { userId: business.userId }, select: { status: true, plan: true, chosenPlan: true, interval: true, provider: true, currentPeriodEnd: true } });
  if (!sub) throw new AdminError("conflict", "This company has no subscription record.");
  const draft = await prisma.invoice.findFirst({ where: { businessId: business.id, status: "draft" }, orderBy: { createdAt: "desc" } });
  if (draft) return { id: draft.id, number: draft.number, created: false };
  // Activation is the step after the demo, like Start trial: a company on its trial or paying is past it.
  if (sub.status !== "PENDING_DEMO") {
    throw new AdminError("conflict", `This company is ${sub.status === "TRIALING" ? "already on its trial" : sub.status === "ACTIVE" ? "already active" : `${sub.status.toLowerCase().replace("_", " ")}, not waiting for a demo`}. Use "Extend trial" or "Change plan" on the company page instead.`);
  }
  const interval: BillingInterval = input.interval === "YEAR" ? "YEAR" : input.interval === "MONTH" ? "MONTH" : sub.interval === "YEAR" ? "YEAR" : "MONTH";
  const planKey = input.planKey?.trim() || sub.chosenPlan;
  if (!planKey) throw new AdminError("conflict", "The client has not chosen a plan yet. Ask them to choose one (Book a demo, step 1), or pick one here.");
  const { region, plans } = await companyPlans(business.id);
  const plan = plans.find((p) => p.key === planKey);
  if (!plan) throw new AdminError("conflict", `That plan is not offered in ${region.name} (${region.key}), the company's region. Pick one of: ${plans.map((p) => p.name).join(", ") || "none (add a price for this region first)"}.`);
  const unitMinor = interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
  if (!unitMinor || unitMinor <= 0) throw new AdminError("conflict", `The ${plan.name} plan has no ${intervalLabel(interval)} price in ${region.name}.`);
  const settings = await getInvoiceSettings();
  const lines: InvoiceLine[] = [{ description: `BuPulse ${plan.name} plan, ${interval === "YEAR" ? "yearly (12 months)" : "monthly (1 month)"}`, quantity: 1, unitMinor }];
  const totals = computeTotals(lines, settings.vatRatePercent);
  const today = invoiceToday(now);
  const number = await nextInvoiceNumber();
  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.invoice.create({
        data: {
          number,
          businessId: business.id,
          status: "draft",
          currency: plan.currency.toUpperCase(),
          lines: lines as Prisma.InputJsonValue,
          ...totals,
          taxRatePercent: settings.vatRatePercent,
          issueDate: dateOfYmd(today),
          dueDate: dateOfYmd(addDaysYmd(today, DEFAULT_DUE_DAYS)),
          planKey: plan.key,
          interval,
          createdBy: ctx.actor,
        },
      });
      // The demo has happened: the booking is done, as Start trial does.
      await tx.demoBooking.updateMany({ where: { businessId: business.id, status: "booked" }, data: { status: "done" } });
      await writeAudit(tx, ctx, "create_invoice", `invoice:${row.id}`, null, { number, businessId: business.id, planKey: plan.key, interval, currency: row.currency, totalMinor: totals.totalMinor, activation: true });
      return row;
    });
    return { id: created.id, number: created.number, created: true };
  } catch (error) {
    if (!isUnique(error)) throw error;
    // Another click made the draft a moment ago (one draft per company): open that one.
    const other = await prisma.invoice.findFirst({ where: { businessId: business.id, status: "draft" }, orderBy: { createdAt: "desc" } });
    if (other) return { id: other.id, number: other.number, created: false };
    throw error;
  }
}

/** Saves the editor: lines, due date, notes and the billing contact. Drafts only; totals are recomputed here. */
export async function updateInvoiceDraft(ctx: AdminContext, id: string, raw: unknown) {
  requireConsole(ctx);
  const row = await prisma.invoice.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No invoice with that id.");
  if (row.status !== "draft") throw new AdminError("conflict", `Invoice ${row.number} is ${row.status}: only drafts can be edited.`);
  const settings = await getInvoiceSettings();
  const checked = validateDraft(raw, ymdOf(row.issueDate), settings.vatRatePercent);
  if (!checked.ok) throw new AdminError("invalid", Object.values(checked.errors)[0] ?? "Check the invoice and try again.");
  const { lines, dueDate, notes, billingEmail } = checked.data;
  const data = { lines: lines as Prisma.InputJsonValue, ...checked.totals, taxRatePercent: settings.vatRatePercent, dueDate: dateOfYmd(dueDate), notes, billingEmail };
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.invoice.updateMany({ where: { id, status: "draft" }, data });
    if (count !== 1) throw new AdminError("conflict", "The invoice was sent or voided a moment ago. Nothing was changed.");
    await writeAudit(tx, ctx, "update_invoice", `invoice:${id}`, { lines: row.lines, totalMinor: row.totalMinor, dueDate: row.dueDate, notes: row.notes, billingEmail: row.billingEmail }, { lines, totalMinor: checked.totals.totalMinor, dueDate, notes, billingEmail });
  });
  return { id, number: row.number, totalMinor: checked.totals.totalMinor };
}

/**
 * Sends a draft: freezes the seller and bill-to details, sets the issue date to today, stores the PDF, and emails it to
 * the owner and the billing contact. The draft -> sent claim comes first, so a double click never emails twice; a
 * failed email leaves the invoice sent (Resend it from the editor). Audited.
 */
export async function sendInvoice(ctx: AdminContext, id: string, now: Date = new Date()) {
  requireConsole(ctx);
  const row = await prisma.invoice.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No invoice with that id.");
  if (row.status !== "draft") throw new AdminError("conflict", `Invoice ${row.number} is already ${row.status}${row.status === "sent" ? ". Use Resend email to send it again" : ""}.`);
  const lines = readLines(row.lines);
  if (lines.length === 0 || row.totalMinor <= 0) throw new AdminError("invalid", "Add at least one line with a price before sending.");
  const today = invoiceToday(now);
  if (ymdOf(row.dueDate) < today) throw new AdminError("invalid", "The due date has passed. Set a new due date, save, then send.");
  const [{ billTo, ownerEmail }, snapshot] = await Promise.all([billToOf(row.businessId), sellerSnapshot()]);
  const to = [...new Set([ownerEmail, row.billingEmail].filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase()))];
  if (to.length === 0) throw new AdminError("conflict", "The company has no email address to send the invoice to. Add a billing contact.");
  const data = { status: "sent", sentAt: now, sentTo: to, issueDate: dateOfYmd(today), billTo: billTo as Prisma.InputJsonValue, seller: snapshot as unknown as Prisma.InputJsonValue };
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.invoice.updateMany({ where: { id, status: "draft" }, data });
    if (count !== 1) throw new AdminError("conflict", "The invoice was sent or voided a moment ago. Nothing was sent.");
    await writeAudit(tx, ctx, "send_invoice", `invoice:${id}`, { status: "draft" }, { status: "sent", number: row.number, to, totalMinor: row.totalMinor, currency: row.currency, dueDate: ymdOf(row.dueDate) });
  });
  const sent: Row = { ...row, ...data, billTo: billTo as Prisma.JsonValue, seller: snapshot as unknown as Prisma.JsonValue };
  const result = await deliverSentInvoice(sent, billTo, snapshot, to);
  return { id, number: row.number, to, emailed: result.sent, failed: result.failed };
}

/** After the sent claim: draws the PDF, archives it, and emails it. Neither storage nor email can undo the send. */
async function deliverSentInvoice(sent: Row, billTo: BillTo, snapshot: SellerSnapshot, to: string[]) {
  const pdf = await renderInvoice(sent);
  // The archive copy. Storage being down never stops the invoice: downloads draw it again from the frozen details.
  try {
    const path = invoicePdfPath(sent.businessId, sent.number);
    await putInvoiceObject(path, pdf, "application/pdf");
    await prisma.invoice.update({ where: { id: sent.id }, data: { pdfPath: path } });
  } catch (error) {
    await logError(error, { source: "invoices.store-pdf", invoiceId: sent.id });
  }
  return sendInvoiceEmail(to, { number: sent.number, totalMinor: sent.totalMinor, currency: sent.currency, dueDate: sent.dueDate, sellerName: snapshot.seller.businessName, billToName: billTo.businessName, payUrl: payUrlOf(sent.number), recipientName: billTo.ownerName }, pdf);
}

/**
 * An invoice issued straight away, without a draft: a client who accepted a custom plan offer and chose "Pay by
 * invoice" (docs/OFFERS.md). It activates `planKey` / `interval` when paid, exactly like an activation invoice (Mobile
 * Money with the invoice number, Mark as paid). No tax line: the offer's price is final. Sent at once to the company owner, due in DEFAULT_DUE_DAYS. `ctx` is the
 * client's context ("client:<user id>"), so the audit says who asked for it. Returns the sent invoice.
 */
export async function issuePlanInvoice(ctx: AdminContext, input: { businessId: string; currency: string; lines: InvoiceLine[]; planKey: string; interval: BillingInterval; notes?: string | null }, now: Date = new Date()): Promise<Row> {
  if (input.lines.length === 0) throw new AdminError("invalid", "An invoice needs at least one line.");
  // The price on an offer is the final amount the client pays: never a tax line, whatever the VAT setting.
  const totals = computeTotals(input.lines, null);
  if (totals.totalMinor <= 0) throw new AdminError("invalid", "An invoice needs a price.");
  const [{ billTo, ownerEmail }, snapshot] = await Promise.all([billToOf(input.businessId), sellerSnapshot()]);
  if (!ownerEmail) throw new AdminError("conflict", "The company has no email address to send the invoice to.");
  const today = invoiceToday(now);
  const number = await nextInvoiceNumber();
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        number,
        businessId: input.businessId,
        status: "sent",
        currency: input.currency.toUpperCase(),
        lines: input.lines as Prisma.InputJsonValue,
        ...totals,
        taxRatePercent: null,
        issueDate: dateOfYmd(today),
        dueDate: dateOfYmd(addDaysYmd(today, DEFAULT_DUE_DAYS)),
        notes: input.notes ?? null,
        planKey: input.planKey,
        interval: input.interval,
        billTo: billTo as Prisma.InputJsonValue,
        seller: snapshot as unknown as Prisma.InputJsonValue,
        sentAt: now,
        sentTo: [ownerEmail.toLowerCase()],
        createdBy: ctx.actor,
      },
    });
    await writeAudit(tx, ctx, "issue_invoice", `invoice:${created.id}`, null, { number, businessId: input.businessId, planKey: input.planKey, interval: input.interval, currency: created.currency, totalMinor: totals.totalMinor });
    return created;
  });
  await deliverSentInvoice(row, billTo, snapshot, row.sentTo).catch((error) => logError(error, { source: "invoices.issue-email", invoiceId: row.id }));
  return row;
}

/** Emails a sent invoice again (the stored PDF). Audited. */
export async function resendInvoice(ctx: AdminContext, id: string) {
  requireConsole(ctx);
  const row = await prisma.invoice.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No invoice with that id.");
  if (row.status !== "sent") throw new AdminError("conflict", `Invoice ${row.number} is ${row.status}: only a sent, unpaid invoice can be emailed again.`);
  const to = row.sentTo.length ? row.sentTo : [row.billingEmail].filter((v): v is string => Boolean(v));
  if (to.length === 0) throw new AdminError("conflict", "There is no address to send this invoice to.");
  const { doc } = await invoiceDocument(row);
  const pdf = await invoicePdf(row);
  const result = await sendInvoiceEmail(to, { number: row.number, totalMinor: row.totalMinor, currency: row.currency, dueDate: row.dueDate, sellerName: doc.seller.businessName, billToName: doc.billTo.businessName, payUrl: doc.payment.payUrl, recipientName: doc.billTo.ownerName }, pdf);
  await writeAudit(prisma, ctx, "resend_invoice", `invoice:${id}`, null, { number: row.number, to, emailed: result.sent });
  return { id, number: row.number, to, emailed: result.sent, failed: result.failed };
}

/**
 * The transaction id stored for a payment marked paid by hand. A Mobile Money id (MTN, Airtel) is stored as it is, so
 * the replay guard (one live use per network and id, across every company) still catches the same SMS used twice. A
 * bank or cash receipt is the admin's own text ("R-0001", "Deposit"): it is scoped to the invoice
 * ("BP-INV-0001/R-0001"), so the same words on two invoices are not taken for a replay.
 */
export function manualTransactionId(method: ManualPayMethod, reference: string, invoiceNumber: string): string {
  return method === "MTN" || method === "AIRTEL" ? reference : `${invoiceNumber}/${reference}`;
}

export const MANUAL_PAY_METHODS = ["MTN", "AIRTEL", "BANK", "CASH"] as const;
export type ManualPayMethod = (typeof MANUAL_PAY_METHODS)[number];
export const MANUAL_PAY_LABEL: Record<ManualPayMethod, string> = { MTN: "MTN Mobile Money", AIRTEL: "Airtel Money", BANK: "Bank transfer", CASH: "Cash" };

/**
 * The money arrived some other way (a MoMo payment made without the pay screen, a bank transfer, cash): the admin marks
 * the invoice paid with the transaction id or receipt number. An invoice with a plan goes through the Mobile Money
 * confirmation itself (a ManualPayment row with the invoice number as the reference, confirmed at once), so the plan,
 * the period, the revenue event, the replay guard on the transaction id and the client's email are exactly the same.
 * A plain invoice is only marked paid. Audited; a second click is refused.
 */
export async function markInvoicePaid(ctx: AdminContext, id: string, input: { method: string; reference: string }, now: Date = new Date()) {
  requireConsole(ctx);
  const method = MANUAL_PAY_METHODS.find((m) => m === input.method);
  if (!method) throw new AdminError("invalid", "Choose how the client paid.");
  const ref = transactionIdSchema.safeParse(input.reference);
  if (!ref.success) throw new AdminError("invalid", "Enter the transaction id or receipt number (letters, digits, dots and dashes; 4 to 40 characters).");
  const row = await prisma.invoice.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No invoice with that id.");
  if (row.status !== "sent") throw new AdminError("conflict", row.status === "draft" ? `Send invoice ${row.number} first, then mark it paid.` : `Invoice ${row.number} is already ${row.status}.`);

  // Payments already recorded on the invoice (Invoice.paymentReview) have switched the plan on: the admin only confirms
  // the money, so the invoice is marked paid without a second payment or period. The admin's own method and reference
  // go into the audit row beside the payments they confirm.
  const reviewed = readPaymentReviews(row.paymentReview);
  if (!row.planKey || !row.interval || reviewed.length > 0) {
    const first = reviewed[0];
    // A card payment that Paddle has since refunded (an approved refund adjustment is on file) is not money received.
    if (first?.source === "paddle" && (await paddleTransactionRefunded(first.reference))) {
      throw new AdminError("conflict", `Paddle shows transaction ${first.reference} as refunded, so the money is not with us. Check Paddle before marking ${row.number} paid; void the invoice (acknowledging the payment) if it was refunded.`);
    }
    const paidBy = first ? `${first.source}:${first.reference}` : `manual:${method}:${ref.data}`;
    // Money that no other event recorded (no MoMo or card payment on file): one revenue event for the roll-up and the
    // Money pages, in USD at today's rate. Kept after the account is deleted (BillingEvent has no foreign key).
    const usdCents = first ? null : usdCentsOf(row.totalMinor, row.currency.toUpperCase(), await getSetting("usdToRwf"));
    const payer = first ? null : ((await prisma.business.findUnique({ where: { id: row.businessId }, select: { userId: true } }))?.userId ?? null);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.invoice.updateMany({ where: { id, status: "sent" }, data: { status: "paid", paidAt: now, paidBy } });
      if (count !== 1) throw new AdminError("conflict", "The invoice was paid or voided a moment ago. Nothing was changed.");
      await writeAudit(tx, ctx, "invoice_paid", `invoice:${id}`, { status: "sent" }, { status: "paid", number: row.number, paidBy, amountMinor: row.totalMinor, currency: row.currency, ...(reviewed.length ? { confirmedPayments: reviewed, adminMethod: method, adminReference: ref.data } : {}) });
      if (usdCents !== null) {
        await tx.billingEvent.create({
          data: {
            provider: "MANUAL_MOMO",
            eventId: `invoice:${id}`,
            type: INVOICE_PAID_EVENT,
            userId: payer,
            processedAt: now,
            payload: { event_type: INVOICE_PAID_EVENT, occurred_at: now.toISOString(), data: { id: row.number, invoice_id: id, amount_minor: row.totalMinor, currency: row.currency, method, usd_cents: usdCents, plan: row.planKey } },
          },
        });
      }
    });
    return { id, number: row.number, status: "paid" as const, periodEnd: null as Date | null, emailed: false };
  }

  const { userId } = await billToOf(row.businessId);
  // The client's own open payment: one they have reported is the admin's to decide in Payments; one they only opened
  // gives way to this one (one pending payment per company).
  const open = await prisma.manualPayment.findFirst({ where: { userId, status: "pending" } });
  if (open?.submittedAt) throw new AdminError("conflict", `The client has reported a payment (${open.reference}) that is waiting in Payments. Confirm or reject it there first.`);
  if (open) await prisma.manualPayment.updateMany({ where: { id: open.id, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: ctx.actor } });
  let paymentId: string;
  try {
    const payment = await prisma.manualPayment.create({
      data: { userId, planKey: row.planKey, interval: row.interval, amountMinor: row.totalMinor, currency: row.currency, reference: row.number, invoiceId: row.id, network: method, transactionId: manualTransactionId(method, ref.data, row.number), submittedAt: now },
    });
    paymentId = payment.id;
  } catch (error) {
    if (isUnique(error)) throw new AdminError("conflict", "This invoice already has a payment in progress or confirmed, or that transaction id was used before. Look in Payments.");
    throw error;
  }
  try {
    const done = await confirmManualPayment(ctx, paymentId, now);
    return { id, number: row.number, status: "paid" as const, periodEnd: done.periodEnd as Date | null, emailed: done.emailed };
  } catch (error) {
    // Nothing was confirmed: close the helper payment so it never shows as waiting.
    await prisma.manualPayment.updateMany({ where: { id: paymentId, status: "pending" }, data: { status: "expired", decidedAt: now, decidedBy: ctx.actor } }).catch(() => undefined);
    throw error;
  }
}

/** Cancels a draft or an unpaid invoice with a reason. A paid invoice is refunded instead, never voided. Audited. */
export async function voidInvoice(ctx: AdminContext, id: string, reason: string, now: Date = new Date(), opts: { acknowledgePayment?: boolean } = {}) {
  requireConsole(ctx);
  const why = reason.trim();
  if (why.length < 3 || why.length > 300) throw new AdminError("invalid", "Give a short reason (3 to 300 characters).");
  const row = await prisma.invoice.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No invoice with that id.");
  if (row.status === "paid") throw new AdminError("conflict", `Invoice ${row.number} is paid. Refund the client instead of voiding it.`);
  if (row.status === "void") throw new AdminError("conflict", `Invoice ${row.number} is already void.`);
  // Money was received for it (a card payment or Mobile Money that did not match the total): voiding hides the invoice
  // while the client has paid, so the admin must say they know (and refund or settle it).
  const received = readPaymentReviews(row.paymentReview);
  if (received.length > 0 && !opts.acknowledgePayment) {
    throw new AdminError("conflict", `Money was received for ${row.number} (${received.map((r) => `${formatInvoiceMoney(r.amountMinor, r.currency)} ${r.source === "paddle" ? "by card" : "by Mobile Money"}, ${r.reference}`).join("; ")}). Mark it paid, or refund the client, before voiding. To void it anyway, confirm that you know about the payment.`);
  }
  const reported = await prisma.manualPayment.findFirst({ where: { invoiceId: id, status: "pending", submittedAt: { not: null } } });
  if (reported) throw new AdminError("conflict", `The client has reported a payment for ${row.number}. Confirm or reject it in Payments first.`);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.invoice.updateMany({ where: { id, status: { in: ["draft", "sent"] } }, data: { status: "void", voidedAt: now, voidReason: why } });
    if (count !== 1) throw new AdminError("conflict", "The invoice was paid or voided a moment ago. Nothing was changed.");
    // A payment the client only opened for this invoice is closed with it.
    await tx.manualPayment.updateMany({ where: { invoiceId: id, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: ctx.actor } });
    await writeAudit(tx, ctx, "void_invoice", `invoice:${id}`, { status: row.status }, { status: "void", number: row.number, reason: why, ...(received.length ? { acknowledgedPayments: received } : {}) });
  });
  return { id, number: row.number, status: "void" as const };
}

/**
 * Whether Paddle told us (an `adjustment.*` event, if the notification destination includes them) that this transaction
 * was refunded. Without those events nothing is known here, and the admin checks in Paddle (docs/INVOICES.md).
 */
async function paddleTransactionRefunded(transactionId: string): Promise<boolean> {
  const events = await prisma.billingEvent.findMany({ where: { provider: "PADDLE", type: { in: ["adjustment.created", "adjustment.updated"] } }, orderBy: { createdAt: "desc" }, take: 500 });
  return events.some((e) => {
    const d = (e.payload as { data?: { transaction_id?: unknown; action?: unknown; status?: unknown } } | null)?.data;
    return d?.transaction_id === transactionId && d?.action === "refund" && d?.status === "approved";
  });
}

// ---- card payments (Paddle) ----------------------------------------------------------------------------------

/**
 * A completed card payment (Paddle `transaction.completed`, the event that records money received) settles at most
 * one open invoice of that company: for the plan and interval paid, sent before the payment, matched on amount and
 * currency or, for a first purchase at the plan's card price, the newest one (`invoiceForCardPayment`). Subscription
 * events (renewals, edits) never settle anything. Idempotent: only a sent invoice moves to paid.
 */
export async function settleInvoiceFromCardPayment(pay: CardPayment): Promise<string | null> {
  const sub = pay.subscriptionId ? await prisma.subscription.findFirst({ where: { providerSubscriptionId: pay.subscriptionId }, select: { userId: true, plan: true, interval: true } }) : null;
  const userId = sub?.userId ?? pay.userId;
  if (!userId) return null;
  const plan = sub ? { plan: sub.plan, interval: sub.interval } : pay.priceId ? await planForAnyPriceId("PADDLE", pay.priceId) : null;
  if (!plan) return null;
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  if (!business) return null;
  const open = await prisma.invoice.findMany({ where: { businessId: business.id, status: "sent" } });
  const { settle: target, review } = matchInvoicePayment(open, pay, plan);
  if (!target) {
    if (review) await flagPaymentForReview(review, { source: "paddle", reference: pay.transactionId, amountMinor: pay.amountMinor, currency: pay.currency, receivedAt: pay.paidAt, planKey: plan.plan, interval: plan.interval }, "system:paddle", business.id);
    return null;
  }
  const paidBy = `paddle:${pay.transactionId}`;
  const { count } = await prisma.invoice.updateMany({ where: { id: target.id, status: "sent" }, data: { status: "paid", paidAt: pay.paidAt, paidBy } });
  if (count !== 1) return null;
  await writeAudit(prisma, { ...consoleContext(null), actor: "system:paddle" }, "invoice_paid", `invoice:${target.id}`, { status: "sent" }, { status: "paid", number: target.number, paidBy, amountMinor: pay.amountMinor, currency: pay.currency, subscriptionId: pay.subscriptionId }).catch(() => undefined);
  return target.id;
}

/**
 * A payment arrived for this invoice but did not match its total: record it on the invoice (it stays "sent", so the
 * reminders keep running), audit it and alert the admins. An admin checks the money and marks the invoice paid.
 */
async function flagPaymentForReview(invoice: Row, pay: Omit<PaymentReview, "receivedAt"> & { receivedAt: Date }, actor: string, businessId: string) {
  // Never overwrites: every payment received is appended, so a second one (a possible double payment) is seen too.
  const fresh = await prisma.invoice.findUnique({ where: { id: invoice.id }, select: { status: true, paymentReview: true } });
  if (!fresh || fresh.status !== "sent") return;
  const entry: PaymentReview = { ...pay, receivedAt: pay.receivedAt.toISOString() };
  const { list, added } = withPaymentReview(fresh.paymentReview, entry);
  if (!added) return; // a replay of a payment already on the invoice
  const { count } = await prisma.invoice.updateMany({ where: { id: invoice.id, status: "sent" }, data: { paymentReview: list as unknown as Prisma.InputJsonValue } });
  if (count !== 1) return;
  const second = list.length > 1;
  await writeAudit(prisma, { ...consoleContext(null), actor }, "invoice_payment_review", `invoice:${invoice.id}`, { status: "sent", payments: list.length - 1 }, { number: invoice.number, ...entry, payments: list.length, invoiceTotalMinor: invoice.totalMinor, invoiceCurrency: invoice.currency }).catch(() => undefined);
  const company = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }).catch(() => null);
  await sendInvoiceReviewAlertEmail({ second, number: invoice.number, company: company?.name ?? "A company", invoiceId: invoice.id, source: entry.source, reference: entry.reference, paidMinor: entry.amountMinor, paidCurrency: entry.currency, invoiceMinor: invoice.totalMinor, invoiceCurrency: invoice.currency }).catch(() => false);
}

// ---- reminders (daily, from the Mobile Money renewals job) --------------------------------------------------

/**
 * On the due date (or the first run after it), one reminder per sent invoice: claimed first (reminderSentAt), released
 * when the email could not go out so the next run tries again. Nothing else changes: the account stays as the paywall
 * says (docs/INVOICES.md, "Overdue").
 */
export async function sendInvoiceReminders(now: Date = new Date(), limit = 100): Promise<number> {
  if (!(await isServiceEnabled("resend"))) return 0;
  const due = await prisma.invoice.findMany({ where: { status: "sent", reminderSentAt: null, dueDate: { lte: dateOfYmd(invoiceToday(now)) } }, orderBy: { dueDate: "asc" }, take: limit });
  let sent = 0;
  for (const row of due) {
    const { count } = await prisma.invoice.updateMany({ where: { id: row.id, status: "sent", reminderSentAt: null }, data: { reminderSentAt: now } });
    if (count !== 1) continue;
    try {
      const to = row.sentTo.length ? row.sentTo : [];
      const { doc } = await invoiceDocument(row);
      const pdf = to.length ? await invoicePdf(row).catch(() => null) : null;
      const result = to.length ? await sendInvoiceReminderEmail(to, { number: row.number, totalMinor: row.totalMinor, currency: row.currency, dueDate: row.dueDate, sellerName: doc.seller.businessName, billToName: doc.billTo.businessName, payUrl: doc.payment.payUrl, recipientName: doc.billTo.ownerName }, pdf) : { sent: 0, failed: 0 };
      if (result.sent === 0) {
        await prisma.invoice.updateMany({ where: { id: row.id, reminderSentAt: now }, data: { reminderSentAt: null } });
        continue;
      }
      sent++;
    } catch (error) {
      await prisma.invoice.updateMany({ where: { id: row.id, reminderSentAt: now }, data: { reminderSentAt: null } }).catch(() => undefined);
      await logError(error, { source: "invoices.reminder", invoiceId: row.id });
    }
  }
  return sent;
}

// ---- reads ---------------------------------------------------------------------------------------------------

export type InvoiceListItem = {
  id: string;
  number: string;
  status: InvoiceStatus;
  overdue: boolean;
  businessId: string;
  company: string;
  currency: string;
  totalMinor: number;
  total: string;
  issueDate: string;
  dueDate: string;
  planLabel: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
};

async function listItems(rows: Row[], now: Date): Promise<InvoiceListItem[]> {
  const ids = [...new Set(rows.map((r) => r.businessId))];
  const businesses = ids.length ? await prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(businesses.map((b) => [b.id, b.name]));
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      number: r.number,
      status: r.status as InvoiceStatus,
      overdue: isOverdue(r, now),
      businessId: r.businessId,
      company: name.get(r.businessId) ?? "A company",
      currency: r.currency,
      totalMinor: r.totalMinor,
      total: formatInvoiceMoney(r.totalMinor, r.currency),
      issueDate: ymdOf(r.issueDate),
      dueDate: ymdOf(r.dueDate),
      planLabel: await planLabelOf(r),
      sentAt: r.sentAt,
      paidAt: r.paidAt,
      createdAt: r.createdAt,
    })),
  );
}

/** The admin list: newest first, filtered by status ("overdue" = sent and past due), company and a search on number or company name. */
export async function listInvoices(opts: { status?: string; q?: string; businessId?: string; limit?: number } = {}, now: Date = new Date()): Promise<InvoiceListItem[]> {
  const q = opts.q?.trim().slice(0, 80) ?? "";
  const overdue = opts.status === "overdue";
  const status = overdue ? "sent" : isInvoiceStatus(opts.status) ? opts.status : undefined;
  let or: Prisma.InvoiceWhereInput[] | undefined;
  if (q) {
    const companies = await prisma.business.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 200 });
    or = [{ number: { contains: q.toUpperCase() } }, ...(companies.length ? [{ businessId: { in: companies.map((c) => c.id) } }] : [])];
  }
  const rows = await prisma.invoice.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(overdue ? { dueDate: { lt: dateOfYmd(invoiceToday(now)) } } : {}),
      ...(opts.businessId ? { businessId: opts.businessId } : {}),
      ...(or ? { OR: or } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(opts.limit ?? 100, 1), 500),
  });
  return listItems(rows, now);
}

export async function getInvoiceRow(id: string): Promise<Row> {
  const row = await prisma.invoice.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No invoice with that id.");
  return row;
}

/** The payments made against an invoice (any status), for the editor's history. */
export async function invoicePayments(invoiceId: string) {
  return prisma.manualPayment.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, reference: true, status: true, transactionId: true, network: true, amountMinor: true, currency: true, submittedAt: true, decidedAt: true, decidedBy: true } });
}

// ---- client side (always scoped to the caller's company) -----------------------------------------------------

export type ClientInvoice = InvoiceListItem & { dueText: string; payable: boolean };

/** The company's invoices the client may see: sent, paid and void ones (never drafts), newest first. */
export async function clientInvoices(businessId: string, now: Date = new Date()): Promise<ClientInvoice[]> {
  if (!businessId) return [];
  const rows = await prisma.invoice.findMany({ where: { businessId, status: { in: ["sent", "paid", "void"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
  const items = await listItems(rows, now);
  return items.map((i) => ({ ...i, dueText: i.dueDate, payable: i.status === "sent" && i.totalMinor > 0 }));
}

/** One invoice of the caller's company by id or number, or null (another company's invoice is simply not found). */
export async function clientInvoiceRow(businessId: string, idOrNumber: string): Promise<Row | null> {
  if (!businessId || !idOrNumber || idOrNumber.length > 64) return null;
  const where = isInvoiceNumber(idOrNumber) ? { number: idOrNumber } : { id: idOrNumber };
  const row = await prisma.invoice.findFirst({ where: { ...where, businessId, status: { in: ["sent", "paid", "void"] } } });
  return row ?? null;
}

/** The newest open (sent, unpaid) invoice of a company: the lock screen and Billing show it with Pay buttons. */
export async function openInvoiceOf(businessId: string): Promise<Row | null> {
  if (!businessId) return null;
  return prisma.invoice.findFirst({ where: { businessId, status: "sent" }, orderBy: { createdAt: "desc" } });
}

/** A made-up invoice drawn with the current settings, for the settings page preview. */
export async function sampleInvoiceDocument(now: Date = new Date()): Promise<{ doc: InvoiceDocument; logo: { path: string; type: string } }> {
  const [snap, settings] = await Promise.all([sellerSnapshot(), getInvoiceSettings()]);
  const lines: InvoiceLine[] = [{ description: "BuPulse Business plan, monthly (1 month)", quantity: 1, unitMinor: 35000 }];
  const totals = computeTotals(lines, settings.vatRatePercent);
  const today = invoiceToday(now);
  return {
    doc: {
      number: "BP-INV-0000",
      status: "sent",
      currency: "RWF",
      issueDate: today,
      dueDate: addDaysYmd(today, DEFAULT_DUE_DAYS),
      lines,
      ...totals,
      taxRatePercent: settings.vatRatePercent,
      notes: null,
      planLabel: "Business, monthly",
      seller: snap.seller,
      billTo: { businessName: "Example Shop Ltd", ownerName: "Aline Uwase", email: "owner@example.rw", phone: "+250 788 123 456", address: "M Peace Plaza, 3rd floor — KN 4 Avenue, Kigali", country: "Rwanda" },
      payment: { ...snap.payment, reference: "BP-INV-0000", payUrl: payUrlOf("BP-INV-0000") },
      paidAt: null,
    },
    logo: { path: snap.logoPath, type: snap.logoType },
  };
}

/** What the client's pay card shows about an open invoice. */
export async function payableView(row: Row, now: Date = new Date()) {
  return {
    id: row.id,
    number: row.number,
    total: formatInvoiceMoney(row.totalMinor, row.currency),
    dueDate: longInvoiceDateOf(row.dueDate),
    overdue: isOverdue(row, now),
    planLabel: await planLabelOf(row),
    planKey: row.planKey,
    interval: row.interval,
  };
}
