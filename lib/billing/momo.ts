import "server-only";
import type { BillingInterval, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext, type Page } from "@/lib/admin/types";
import { trackEvent } from "@/lib/analytics/events";
import { subscriptionEventsFor } from "@/lib/analytics/math";
import { getSetting } from "@/lib/admin/settings";
import { clearPlanCache, getPlan, getPlans, priceCents } from "@/lib/plan-catalog";
import { assertOfferAmount, markOfferPaidInTx, offerForPayment } from "@/lib/offers/activate";
import { readAddition } from "@/lib/offers/shared";
import { companyPlans } from "@/lib/region-prices";
import { matchInvoicePayment, readPaymentReviews, withPaymentReview, type PaymentReview } from "@/lib/invoices/shared";
import { sendInvoiceReviewAlertEmail, sendPaymentRejectedEmail, sendPaymentToCheckEmail, sendPlanActiveEmail } from "./momo-emails";
import { getMomoPrice, getMomoSettings } from "./momo-settings";
import { earlyRenewalMessage, tooEarlyToRenew } from "./renewal";
import { checkProofObject, createProofUpload, ProofFileError, removeProofObjects, verifiedProofPath } from "./momo-proofs";
import {
  DAY_MS,
  isProofPathOf,
  isProofType,
  isReference,
  makeReference,
  MANUAL_PAYMENT_STATUSES,
  momoConfigured,
  planManualPeriod,
  proofFileProblem,
  proofObjectPath,
  proofSchema,
  REJECTED_SHOWN_DAYS,
  transactionIdSchema,
  usdCentsOf,
  type ManualPaymentStatus,
  type ManualPaymentView,
  type MomoNetwork,
  type PeriodNote,
  type ProofInput,
} from "./momo-shared";

// Manual Mobile Money payments (docs/MOMO.md). The client side (start, submit the proof, cancel) is keyed on the
// company account id; the owner side (confirm, reject) runs in the admin console only and is audited. Every state
// change is one conditional write on the status, so a double click or two tabs cannot confirm or submit twice, and
// two partial unique indexes back it up: one pending payment per company, one live use of a transaction id.

/** The client-facing message thrown by the client-side functions. Safe to show. */
export class ManualPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualPaymentError";
  }
}

const LIVE = new Set(["ACTIVE", "PAST_DUE", "TRIALING"]);
const REFERENCE_TRIES = 6;
/** New Mobile Money payments a company may start in 24 hours. */
export const MOMO_DAILY_PAYMENTS = 10;
const TRANSACTION_REUSED = "This transaction id has already been used for another payment. Check the id in your Mobile Money message, or contact support.";

type Row = Prisma.ManualPaymentGetPayload<object>;
type Sub = Prisma.SubscriptionGetPayload<object>;

const isUnique = (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");

/** How a pending payment meets the client's running period (nothing once it is decided, or nothing is running). */
function periodNoteOf(row: Row, sub: Sub | null, now: Date): PeriodNote | null {
  if (row.status !== "pending" || !sub) return null;
  const plan = planManualPeriod(sub, row.planKey, row.interval, now);
  return plan.mode === "fresh" ? null : { mode: plan.mode, daysLeft: plan.daysLeft, currentEnd: (sub.currentPeriodEnd as Date).toISOString() };
}

/** A plan by key, re-reading the catalog once when this isolate's copy does not have it yet (a custom plan made a moment ago). */
async function freshPlan(key: string) {
  return (await getPlan(key)) ?? (await getPlans({ force: true })).find((p) => p.key === key) ?? null;
}

async function toView(row: Row, sub: Sub | null, now: Date = new Date()): Promise<ManualPaymentView> {
  // Features added to the running plan keep its period: no "replaces the current period" note for them.
  const keeps = row.status === "pending" && (row.offerId || row.invoiceId) ? Boolean(readAddition((await offerForPayment(row))?.options)) : false;
  return {
    id: row.id,
    planKey: row.planKey,
    planName: (await freshPlan(row.planKey))?.name ?? row.planKey,
    interval: row.interval,
    amountMinor: row.amountMinor,
    currency: row.currency,
    reference: row.reference,
    invoiceId: row.invoiceId ?? null,
    offerId: row.offerId ?? null,
    status: row.status as ManualPaymentStatus,
    submitted: row.submittedAt !== null,
    transactionId: row.transactionId,
    payerPhone: row.payerPhone,
    network: (row.network as MomoNetwork | null) ?? null,
    // Only a screenshot that passed the checks at submit time (proofBytes is set then).
    proofType: row.proofBytes != null && isProofType(row.proofType) ? row.proofType : null,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    periodNote: keeps ? null : periodNoteOf(row, sub, now),
  };
}

const subOf = (userId: string) => prisma.subscription.findUnique({ where: { userId } });
const openOf = (userId: string) => prisma.manualPayment.findFirst({ where: { userId, status: "pending" }, orderBy: { createdAt: "desc" } });

/**
 * A payment that already used this transaction id on this network. `live` only looks at pending and confirmed ones,
 * which is what the unique index enforces; without it, rejected and expired ones count too (the admin's "seen before"
 * note).
 */
async function transactionUse(network: string, transactionId: string, opts: { live: boolean; except?: string; db?: Prisma.TransactionClient }) {
  const db = opts.db ?? prisma;
  return db.manualPayment.findFirst({
    where: {
      network,
      transactionId: { equals: transactionId, mode: "insensitive" },
      ...(opts.live ? { status: { in: ["pending", "confirmed"] } } : {}),
      ...(opts.except ? { id: { not: opts.except } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, reference: true, status: true, userId: true },
  });
}

// ---- client side -------------------------------------------------------------------------------------------

/** The client's open payment, or their last rejected one (for a week), so the Billing page can show where they are. */
export async function currentManualPayment(userId: string, now: Date = new Date()): Promise<ManualPaymentView | null> {
  const pending = await openOf(userId);
  if (pending) return toView(pending, await subOf(userId), now);
  const rejected = await prisma.manualPayment.findFirst({ where: { userId, status: "rejected", decidedAt: { gte: new Date(now.getTime() - REJECTED_SHOWN_DAYS * DAY_MS) } }, orderBy: { decidedAt: "desc" } });
  if (!rejected) return null;
  // Only until the client pays again: a newer confirmed payment hides an old rejection.
  const newer = await prisma.manualPayment.findFirst({ where: { userId, status: "confirmed", createdAt: { gt: rejected.createdAt } }, select: { id: true } });
  return newer ? null : toView(rejected, null, now);
}

/**
 * Starts a payment: a pending row with a fresh reference and the plan's price in the company's region (RWF in Rwanda),
 * for the client to quote when paying. One pending payment per company (also a partial unique index): starting again returns the open one, so a
 * reload or a second tab never makes a second reference.
 */
export async function startManualPayment(input: { userId: string; plan: string; interval: BillingInterval; now?: Date }): Promise<ManualPaymentView> {
  const now = input.now ?? new Date();
  const settings = await getMomoSettings();
  if (!momoConfigured(settings)) throw new ManualPaymentError("Mobile Money payments are not available right now. Please pay by card or contact support.");
  const plan = await freshPlan(input.plan);
  const [sub, business] = await Promise.all([subOf(input.userId), prisma.business.findUnique({ where: { userId: input.userId }, select: { id: true } })]);
  // The company's own custom plan (docs/OFFERS.md) is renewed at its own price; nobody else can buy it.
  const ownCustom = Boolean(plan?.isCustom && business && plan.businessId === business.id && plan.status !== "retired");
  if (!plan || plan.isTrial || (plan.status !== "active" && !ownCustom) || (plan.isCustom && !ownCustom)) throw new ManualPaymentError("That plan is not available. Choose one of the plans shown.");
  if (!sub || !business) throw new ManualPaymentError("Your account is still being set up. Please try again in a moment.");
  // A custom plan is switched on by paying its offer first: an accepted offer is paid through the offer (same pay
  // screen, payment tied to it, its price and interval); a withdrawn or expired one cannot be paid at all. Plain
  // renewals are for a custom plan whose offer is paid.
  if (ownCustom) {
    const offer = await prisma.planOffer.findFirst({ where: { customPlanKey: plan.key, businessId: business.id }, select: { id: true, status: true } });
    if (offer?.status === "accepted") return startOfferPayment({ userId: input.userId, offerId: offer.id, now });
    if (offer?.status !== "paid") throw new ManualPaymentError("This custom plan offer is no longer open. Ask us for a new one.");
  }
  // Renewing the plan the client is on opens in the last RENEWAL_WINDOW_DAYS days of the paid period (docs/BILLING.md,
  // "Renewing"); the new period then starts when the current one ends. Another plan or interval is a switch, not a renewal.
  const early = sub.plan === plan.key && sub.interval === input.interval ? tooEarlyToRenew(sub, now) : null;
  if (early) throw new ManualPaymentError(earlyRenewalMessage(early));
  // The amount is the plan's price in the company's region (docs/REGIONS.md); a region without Mobile Money, or a plan
  // not offered there, cannot be paid this way. Checked before anything is written.
  const price = ownCustom ? await customPlanMomoPrice(business.id, plan, input.interval) : await getMomoPrice(business.id, plan.key, input.interval);
  if (!price || price.amountMinor <= 0) throw new ManualPaymentError("Mobile Money is not available for this plan where your business is. Choose one of the plans shown, pay by card, or contact support.");
  return openPayment(input.userId, sub, { planKey: plan.key, interval: input.interval, amountMinor: price.amountMinor, currency: price.currency, invoiceId: null, offerId: null, reference: null }, now);
}

/**
 * Starts the Mobile Money payment of an invoice (docs/INVOICES.md): the amount is the invoice total, the reference the
 * invoice number, and confirming it activates the invoice's plan and interval and marks the invoice paid. Only an
 * invoice of the client's own company that has been sent and not paid or voided; the region must take Mobile Money.
 */
export async function startInvoicePayment(input: { userId: string; invoiceId: string; now?: Date }): Promise<ManualPaymentView> {
  const now = input.now ?? new Date();
  const settings = await getMomoSettings();
  if (!momoConfigured(settings)) throw new ManualPaymentError("Mobile Money payments are not available right now. Please pay by card or contact support.");
  const [sub, business] = await Promise.all([subOf(input.userId), prisma.business.findUnique({ where: { userId: input.userId }, select: { id: true } })]);
  if (!sub || !business) throw new ManualPaymentError("Your account is still being set up. Please try again in a moment.");
  const invoice = await prisma.invoice.findFirst({ where: { id: input.invoiceId, businessId: business.id } });
  if (!invoice || invoice.status === "draft") throw new ManualPaymentError("We could not find that invoice. Open it again from the Billing page.");
  if (invoice.status === "paid") throw new ManualPaymentError("This invoice is already paid.");
  if (invoice.status !== "sent") throw new ManualPaymentError("This invoice was cancelled. Contact support if you still want to pay it.");
  // A payment for it already arrived and waits for the owner to check: a second one would be a double payment.
  if (readPaymentReviews(invoice.paymentReview).length > 0) throw new ManualPaymentError("A payment for this invoice is being checked. We'll confirm shortly.");
  if (!invoice.planKey || !invoice.interval || invoice.totalMinor <= 0) throw new ManualPaymentError("This invoice cannot be paid by Mobile Money here. Contact support and we will help you.");
  const { region } = await companyPlans(business.id);
  if (!region.paymentMethods.includes("momo")) throw new ManualPaymentError("Mobile Money is not available where your business is. Pay by card, or contact support.");
  return openPayment(input.userId, sub, { planKey: invoice.planKey, interval: invoice.interval, amountMinor: invoice.totalMinor, currency: invoice.currency, invoiceId: invoice.id, offerId: null, reference: invoice.number }, now);
}

/** A custom plan's Mobile Money price: its own amount in its own currency, when the company's region takes Mobile Money. */
async function customPlanMomoPrice(businessId: string, plan: { monthlyPriceCents: number; yearlyPriceCents: number; currency: string }, interval: BillingInterval) {
  const { region } = await companyPlans(businessId);
  if (!region.paymentMethods.includes("momo") || plan.currency.toUpperCase() !== region.currency.toUpperCase()) return null;
  return { amountMinor: priceCents(plan, interval), currency: plan.currency.toUpperCase() };
}

/**
 * Starts the Mobile Money payment of an accepted custom plan offer (docs/OFFERS.md): the amount is the offer's price,
 * the plan its prepared custom plan, a fresh BP-XXXX reference. Confirming it marks the offer paid and switches the
 * company onto the custom plan. Only an accepted offer of the client's own company; the region must take Mobile Money.
 */
export async function startOfferPayment(input: { userId: string; offerId: string; now?: Date }): Promise<ManualPaymentView> {
  const now = input.now ?? new Date();
  const settings = await getMomoSettings();
  if (!momoConfigured(settings)) throw new ManualPaymentError("Mobile Money payments are not available right now. Choose Pay by invoice, or contact support.");
  const [sub, business] = await Promise.all([subOf(input.userId), prisma.business.findUnique({ where: { userId: input.userId }, select: { id: true } })]);
  if (!sub || !business) throw new ManualPaymentError("Your account is still being set up. Please try again in a moment.");
  const offer = await prisma.planOffer.findFirst({ where: { id: input.offerId, businessId: business.id } });
  if (!offer || offer.status === "draft") throw new ManualPaymentError("We could not find that offer. Open it again from the Billing page.");
  if (offer.status === "paid") throw new ManualPaymentError("This offer is already paid.");
  if (offer.status !== "accepted" || !offer.customPlanKey) throw new ManualPaymentError("This offer is no longer open. Ask us for a new one.");
  const { region } = await companyPlans(business.id);
  if (!region.paymentMethods.includes("momo")) throw new ManualPaymentError("Mobile Money is not available where your business is. Choose Pay by invoice, or contact support.");
  return openPayment(input.userId, sub, { planKey: offer.customPlanKey, interval: offer.interval, amountMinor: offer.adjustedMinor, currency: offer.currency, invoiceId: null, offerId: offer.id, reference: null }, now);
}

type PaymentTarget = { planKey: string; interval: BillingInterval; amountMinor: number; currency: string; invoiceId: string | null; offerId: string | null; reference: string | null };

/** The open payment for this target, or a new one (replacing an unsubmitted payment of something else). */
async function openPayment(userId: string, sub: Sub, target: PaymentTarget, now: Date): Promise<ManualPaymentView> {
  // A card subscription that still renews by itself would pay twice. Once the client has cancelled it (it stays active
  // until its period end), Mobile Money takes over from that end.
  if (sub.provider === "PADDLE" && sub.providerSubscriptionId && LIVE.has(sub.status) && sub.plan !== "TRIAL" && !sub.cancelAtPeriodEnd) {
    throw new ManualPaymentError("You pay by card at the moment. Cancel the card plan first (it stays active until the end of the period you paid for); your Mobile Money plan then starts from that date.");
  }
  const open = await openOf(userId);
  if (open) {
    if (open.submittedAt) return toView(open, sub, now);
    // Not paid yet: the client may still change their mind about the plan. Same plan, period and invoice: keep the reference.
    if (open.planKey === target.planKey && open.interval === target.interval && (open.invoiceId ?? null) === target.invoiceId && (open.offerId ?? null) === target.offerId) return toView(open, sub, now);
    const { count } = await prisma.manualPayment.updateMany({ where: { id: open.id, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: "client" } });
    // Submitted or replaced from another tab meanwhile: whatever is open now is the payment.
    if (count !== 1) {
      const current = await openOf(userId);
      if (current) return toView(current, sub, now);
    }
  }
  // A new payment row (the open one was returned above): at most MOMO_DAILY_PAYMENTS a day per company, so a loop of
  // start / cancel cannot fill the table or the admin queue.
  const recent = await prisma.manualPayment.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
  if (recent >= MOMO_DAILY_PAYMENTS) throw new ManualPaymentError("You have started many Mobile Money payments today. Please try again tomorrow, or contact support.");
  for (let attempt = 0; attempt < REFERENCE_TRIES; attempt++) {
    try {
      const row = await prisma.manualPayment.create({
        data: { userId, planKey: target.planKey, interval: target.interval, amountMinor: target.amountMinor, currency: target.currency, invoiceId: target.invoiceId, offerId: target.offerId, reference: target.reference ?? makeReference(attempt < 3 ? 4 : 6) },
      });
      return toView(row, sub, now);
    } catch (error) {
      if (!isUnique(error)) throw error;
      // Either the company got a pending payment from another request (return it) or the reference is taken (try another).
      const current = await openOf(userId);
      if (current) return toView(current, sub, now);
      // An invoice's reference is fixed: the only other clash is a confirmed payment of that invoice.
      if (target.invoiceId) throw new ManualPaymentError("This invoice is already paid.");
      if (target.offerId) throw new ManualPaymentError("This offer is already paid.");
    }
  }
  throw new ManualPaymentError("We could not create a payment reference. Please try again.");
}

/**
 * Before "I've paid": a signed URL to upload the screenshot of the MoMo confirmation, for this client's own open
 * payment that is not submitted yet. The path is recorded on the payment (a new upload replaces the previous file), so
 * only the file the server issued can be attached, and an abandoned one is removed with the payment.
 */
export async function startProofUpload(userId: string, input: { paymentId: string; type: string; bytes: number }): Promise<{ path: string; token: string }> {
  const problem = proofFileProblem({ type: input.type, size: input.bytes });
  if (problem) throw new ManualPaymentError(problem);
  const paymentId = String(input.paymentId ?? "");
  const row = paymentId && paymentId.length <= 64 ? await prisma.manualPayment.findFirst({ where: { id: paymentId, userId } }) : null;
  if (!row) throw new ManualPaymentError("We could not find that payment. Start again from the Billing page.");
  if (row.status !== "pending" || row.submittedAt) throw new ManualPaymentError("This payment is already sent for approval.");
  const path = proofObjectPath(userId, row.id, input.type as Parameters<typeof proofObjectPath>[2], globalThis.crypto.randomUUID());
  const { count } = await prisma.manualPayment.updateMany({ where: { id: row.id, userId, status: "pending", submittedAt: null }, data: { proofPath: path, proofBytes: null, proofType: null } });
  if (count !== 1) throw new ManualPaymentError("This payment is already sent for approval.");
  if (row.proofPath && row.proofPath !== path) await removeProofObjects([row.proofPath]);
  try {
    return await createProofUpload(path);
  } catch (error) {
    await logError(error, { source: "billing.momo.proof", userId, paymentId: row.id });
    throw new ManualPaymentError("The screenshot could not be uploaded right now. Try again, or send the transaction id only.");
  }
}

/**
 * The client tapped "I've paid": records the transaction id, the phone, the network and the screenshot, and alerts the
 * owner. Only the open, not-yet-submitted payment of this company can be submitted, exactly once, and a transaction id
 * that already paid for a pending or confirmed payment of any company is refused (the unique index catches a race).
 * Without a transaction id ("I can't find it") the screenshot is required and the owner types the id on confirm. The
 * screenshot must be the file issued for this payment (startProofUpload) and pass the checks (size, first bytes).
 */
export async function submitManualProof(userId: string, raw: ProofInput, now: Date = new Date()): Promise<ManualPaymentView> {
  const parsed = proofSchema.safeParse(raw);
  if (!parsed.success) throw new ManualPaymentError(parsed.error.issues[0]?.message ?? "Check the details and try again.");
  const { paymentId, transactionId, payerPhone, network, proofPath } = parsed.data;
  const sub = await subOf(userId);
  if (transactionId && (await transactionUse(network, transactionId, { live: true, except: paymentId }))) throw new ManualPaymentError(TRANSACTION_REUSED);
  const open = await prisma.manualPayment.findFirst({ where: { id: paymentId, userId, status: "pending", submittedAt: null }, select: { proofPath: true } });
  let proof: { bytes: number; type: string; path: string } | null = null;
  if (open && proofPath) {
    if (!isProofPathOf(proofPath, userId, paymentId) || open.proofPath !== proofPath) throw new ManualPaymentError("That screenshot is not the one uploaded for this payment. Add it again.");
    try {
      proof = await checkProofObject(proofPath, verifiedProofPath(proofPath));
    } catch (error) {
      if (error instanceof ProofFileError) throw new ManualPaymentError(error.message);
      throw error;
    }
  }
  // A screenshot uploaded and then left out of the form is not kept.
  const dropped = open?.proofPath && !proof ? open.proofPath : null;
  let count = 0;
  try {
    ({ count } = await prisma.manualPayment.updateMany({
      // The screenshot must still be the file checked above (a second upload meanwhile is never attached unchecked).
      where: { id: paymentId, userId, status: "pending", submittedAt: null, proofPath: proof ? proofPath : (open?.proofPath ?? null) },
      // The payment points at the server's own copy of the checked bytes, never at the client's upload.
      data: { transactionId, payerPhone, network, submittedAt: now, ...(proof ? { proofPath: proof.path, proofBytes: proof.bytes, proofType: proof.type } : { proofPath: null, proofBytes: null, proofType: null }) },
    }));
  } catch (error) {
    if (isUnique(error)) throw new ManualPaymentError(TRANSACTION_REUSED);
    throw error;
  }
  const row = await prisma.manualPayment.findFirst({ where: { id: paymentId, userId } });
  if (!row) throw new ManualPaymentError("We could not find that payment. Start again from the Billing page.");
  if (count === 1 && dropped) await removeProofObjects([dropped]);
  // Not submitted after all (closed, or changed meanwhile): the server's copy goes too.
  if (count !== 1 && proof) await removeProofObjects([proof.path]);
  if (count !== 1) {
    if (row.status === "pending" && row.submittedAt) return toView(row, sub, now); // already submitted: nothing to redo
    if (row.status === "pending") throw new ManualPaymentError("The screenshot changed while sending (another tab?). Check it and send again.");
    throw new ManualPaymentError("This payment is closed. Start again from the Billing page.");
  }
  // The alert is best effort: the payment is on record and shows in the admin queue either way.
  try {
    const [user, business, plan] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      prisma.business.findUnique({ where: { userId }, select: { name: true } }),
      getPlan(row.planKey),
    ]);
    await sendPaymentToCheckEmail({
      reference: row.reference, amountMinor: row.amountMinor, currency: row.currency, planName: plan?.name ?? row.planKey, interval: row.interval,
      transactionId: transactionId ?? "not found by the client (see the screenshot)", payerPhone, network, company: business?.name ?? "A company", email: user?.email ?? "",
    });
  } catch (error) {
    await logError(error, { source: "billing.momo.alert", userId, paymentId });
  }
  await trackEvent("momo_payment_submitted", { userId, props: { plan: row.planKey, interval: row.interval, amountMinor: row.amountMinor, screenshot: proof !== null, transactionId: transactionId !== null } });
  return toView(row, sub, now);
}

/**
 * Screenshots of payments that were never submitted (cancelled, replaced by another plan, or closed after 48 hours):
 * the files are removed and the rows forget them. Best effort, run by the daily renewals job. Submitted payments keep
 * their screenshot as the record of the money; the account deletion removes those.
 */
export async function sweepUnsubmittedProofs(limit = 500): Promise<number> {
  const rows = await prisma.manualPayment.findMany({ where: { status: "expired", submittedAt: null, proofPath: { not: null } }, select: { id: true, proofPath: true }, take: limit });
  if (rows.length === 0) return 0;
  const removed = await removeProofObjects(rows.map((r) => r.proofPath as string));
  if (removed === 0) return 0;
  await prisma.manualPayment.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "expired", submittedAt: null }, data: { proofPath: null, proofBytes: null, proofType: null } });
  return removed;
}

/** The client changed their mind before paying. A submitted payment cannot be cancelled: the owner decides it. */
export async function cancelManualPayment(userId: string, paymentId: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await prisma.manualPayment.updateMany({ where: { id: paymentId, userId, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: "client" } });
  return count === 1;
}

// ---- owner side (admin console) ----------------------------------------------------------------------------

function requireConsole(ctx: AdminContext) {
  if (ctx.viaApi || ctx.actor !== "admin") throw new AdminError("forbidden", "Mobile Money payments are confirmed or rejected by the owner, in the admin console.");
}

async function clientOf(userId: string) {
  const [user, business] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.business.findUnique({ where: { userId }, select: { id: true, name: true, ceoName: true } }),
  ]);
  return { email: user?.email ?? null, name: user?.name ?? business?.ceoName ?? null, company: business?.name ?? null, businessId: business?.id ?? null };
}

/** Thrown inside the confirm transaction when the subscription moved under us; the caller re-reads and tries once more. */
class SubscriptionMoved extends Error {}

/**
 * The owner saw the money arrive and clicked Confirm. Claims the payment (pending -> confirmed) and, in the same
 * transaction, writes the paid period onto the subscription: provider MANUAL_MOMO, the plan the client paid for,
 * ACTIVE, the interval and no card ids. A company waiting for its demo (PENDING_DEMO), on its trial, expired or past
 * due all become ACTIVE this way: paying is always enough. The period follows planManualPeriod: extending a running period of the same plan only moves
 * currentPeriodEnd (currentPeriodStart, the usage anchor, is never set in the future); a different plan or interval,
 * or nothing running, starts a fresh period now. The payment keeps the exact period it bought. Then the money is
 * recorded for analytics (BillingEvent) and the client is emailed. Idempotent: a second click finds the payment
 * already confirmed and is refused without touching anything; a subscription that changed between the read and the
 * write is re-read and the period recomputed once.
 */
export async function confirmManualPayment(ctx: AdminContext, paymentId: string, now: Date = new Date(), input: { transactionId?: string | null } = {}) {
  requireConsole(ctx);
  const payment = await prisma.manualPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AdminError("not_found", "No payment with that id.");
  if (payment.status !== "pending") throw new AdminError("conflict", `This payment is already ${payment.status}.`);
  if (!payment.submittedAt || !payment.network) throw new AdminError("conflict", "The client has not said they paid yet. Wait for them, or ask them to tap I've paid.");
  // The client could not find the transaction id and sent a screenshot: the owner reads it from their own MoMo message
  // and types it here, so the replay guard (one live use per id and network) holds for every confirmed payment.
  let transactionId = payment.transactionId;
  if (!transactionId) {
    const typed = transactionIdSchema.safeParse(input.transactionId ?? "");
    if (!typed.success) throw new AdminError("invalid", "The client could not find the transaction id: type it from your Mobile Money message before confirming.");
    transactionId = typed.data;
  }
  const plan = await freshPlan(payment.planKey);
  if (!plan) throw new AdminError("conflict", "The plan of this payment no longer exists.");
  // A payment of a custom plan offer (directly, or through the invoice made from it) also settles the offer.
  const offer = await offerForPayment(payment);
  if (offer && offer.status !== "accepted") throw new AdminError("conflict", `The custom plan offer this payment is for is ${offer.status}. Reject this payment (and refund it if the money arrived) instead.`);
  if (offer) assertOfferAmount(offer, payment);
  // Features added to the running plan (docs/OFFERS.md): the plan they were priced on must still be the one running;
  // the subscription moves to the new custom plan and its period does not change.
  const addition = offer ? readAddition(offer.options) : null;
  if (payment.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: payment.invoiceId }, select: { status: true } });
    if (invoice?.status !== "sent") throw new AdminError("conflict", `Invoice ${payment.reference} is ${invoice ? `already ${invoice.status}` : "gone"}. Reject this payment (and refund it if the money arrived) instead.`);
  }
  // The revenue roll-up is in USD: the one USD->RWF rate of Admin -> Settings (also used for card prices).
  const usdCents = usdCentsOf(payment.amountMinor, payment.currency, await getSetting("usdToRwf"));

  for (let attempt = 0; ; attempt++) {
    let flagged: { invoice: { id: string; number: string; totalMinor: number; currency: string }; company: string; second: boolean } | null = null;
    const sub = await subOf(payment.userId);
    if (!sub) throw new AdminError("not_found", "This client has no subscription any more.");
    if (sub.provider === "PADDLE" && sub.providerSubscriptionId && LIVE.has(sub.status) && sub.plan !== "TRIAL" && !sub.cancelAtPeriodEnd) {
      throw new AdminError("conflict", "This client has a card subscription that still renews. Cancel it in Paddle first, or reject this payment and refund it by MoMo.");
    }
    if (addition && (sub.provider !== "MANUAL_MOMO" || sub.status !== "ACTIVE" || !sub.currentPeriodEnd || sub.currentPeriodEnd <= now || sub.plan !== addition.currentPlanKey || sub.interval !== payment.interval)) {
      throw new AdminError("conflict", `The client's plan changed since they added these features (they were priced on ${addition.currentPlanName}, running until ${addition.periodEnd.slice(0, 10)}). Reject this payment (refund it if the money arrived) and make a new offer.`);
    }
    const period: { mode: "extend" | "replace" | "fresh" | "keep"; start: Date; end: Date } = addition ? { mode: "keep", start: now, end: sub.currentPeriodEnd as Date } : planManualPeriod(sub, plan.key, payment.interval, now);
    const before = { plan: sub.plan, status: sub.status, provider: sub.provider, interval: sub.interval, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd };
    const after = {
      plan: plan.key,
      status: "ACTIVE" as const,
      provider: "MANUAL_MOMO" as const,
      interval: payment.interval,
      providerSubscriptionId: null,
      providerCustomerId: null,
      providerPriceId: null,
      providerUpdatedAt: now,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      // Extending (and adding features) keeps the usage anchor; a fresh or replacing period starts counting now.
      ...(period.mode === "extend" || period.mode === "keep" ? {} : { currentPeriodStart: period.start }),
      currentPeriodEnd: period.end,
    };
    try {
      await prisma.$transaction(async (tx) => {
        // The transaction id must still be unused by any other live payment (the index refuses too; this says why).
        if (await transactionUse(payment.network as string, transactionId, { live: true, except: paymentId, db: tx })) {
          throw new AdminError("conflict", payment.transactionId ? "This transaction id was confirmed on another payment meanwhile. Reject this one." : "That transaction id is already used on another payment. Check the id, or reject this one.");
        }
        // The claim: only a pending, submitted payment moves to confirmed, once (with the id the owner typed, if any).
        const claim = await tx.manualPayment.updateMany({
          where: { id: paymentId, status: "pending", submittedAt: { not: null } },
          data: { status: "confirmed", decidedAt: now, decidedBy: ctx.actor, periodStart: period.start, periodEnd: period.end, ...(payment.transactionId ? {} : { transactionId }) },
        });
        if (claim.count !== 1) throw new AdminError("conflict", "This payment was decided a moment ago. Nothing was changed.");
        // A payment of an invoice (its number is the reference) pays that invoice, once: only a sent invoice moves to
        // paid. A voided or already paid invoice stops the confirmation (nothing is written).
        if (payment.invoiceId) {
          const paid = await tx.invoice.updateMany({ where: { id: payment.invoiceId, status: "sent" }, data: { status: "paid", paidAt: now, paidBy: `manual_payment:${payment.id}` } });
          if (paid.count !== 1) throw new AdminError("conflict", `Invoice ${payment.reference} is no longer open (voided or already paid). Reject this payment and refund it, or look at the invoice first.`);
          await writeAudit(tx, ctx, "invoice_paid", `invoice:${payment.invoiceId}`, { status: "sent" }, { status: "paid", number: payment.reference, paidBy: `manual_payment:${payment.id}`, amountMinor: payment.amountMinor, currency: payment.currency });
        } else if (!offer) {
          // An offer's own payment never settles or flags another invoice: markOfferPaidInTx below voids the offer's
          // invoice instead. A plain payment (the pay screen's BP- reference) for a plan the client was also invoiced for: the invoice is
          // marked paid only when the payment provably is for it (matchInvoicePayment: the same total, or a single plan
          // line of that amount). Otherwise it is recorded on the newest candidate for an admin to check and mark paid.
          const business = await tx.business.findUnique({ where: { userId: payment.userId }, select: { id: true, name: true } });
          const open = business ? await tx.invoice.findMany({ where: { businessId: business.id, status: "sent" } }) : [];
          const { settle, review } = matchInvoicePayment(open, { amountMinor: payment.amountMinor, currency: payment.currency.toUpperCase(), paidAt: now, origin: period.mode === "extend" ? "subscription_recurring" : "web" }, { plan: plan.key, interval: payment.interval });
          if (settle) {
            const paidBy = `momo:${payment.reference}`;
            const settled = await tx.invoice.updateMany({ where: { id: settle.id, status: "sent" }, data: { status: "paid", paidAt: now, paidBy } });
            if (settled.count === 1) await writeAudit(tx, ctx, "invoice_paid", `invoice:${settle.id}`, { status: "sent" }, { status: "paid", number: settle.number, paidBy, amountMinor: payment.amountMinor, currency: payment.currency });
          } else if (review) {
            // Appended, never overwritten: a second payment for the same invoice is a possible double payment.
            const note: PaymentReview = { source: "momo", reference: payment.reference, amountMinor: payment.amountMinor, currency: payment.currency, receivedAt: now.toISOString(), planKey: plan.key, interval: payment.interval };
            const { list, added } = withPaymentReview((review as { paymentReview?: unknown }).paymentReview, note);
            const marked = added ? await tx.invoice.updateMany({ where: { id: review.id, status: "sent" }, data: { paymentReview: list } }) : { count: 0 };
            if (marked.count === 1) {
              await writeAudit(tx, ctx, "invoice_payment_review", `invoice:${review.id}`, { status: "sent", payments: list.length - 1 }, { number: review.number, ...note, payments: list.length, invoiceTotalMinor: review.totalMinor, invoiceCurrency: review.currency });
              flagged = { invoice: review, company: business?.name ?? "A company", second: list.length > 1 };
            }
          }
        }
        // Guarded on the state we read (ids, status and period end), so a card webhook or another confirmation landing
        // meanwhile is never overwritten blindly.
        const written = await tx.subscription.updateMany({
          where: { userId: payment.userId, providerSubscriptionId: sub.providerSubscriptionId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
          data: after,
        });
        if (written.count !== 1) throw new SubscriptionMoved();
        // The offer is paid and its custom plan replaces any older one of the company (in the same transaction).
        if (offer) await markOfferPaidInTx(tx, ctx, { offer, paymentId: payment.id, invoiceId: payment.invoiceId, planKey: plan.key, amountMinor: payment.amountMinor, currency: payment.currency }, now);
        // The money, for the revenue roll-up and the activity feed (same shape of row as a Paddle payment event).
        await tx.billingEvent.create({
          data: {
            provider: "MANUAL_MOMO",
            eventId: payment.id,
            type: "manual_payment.confirmed",
            userId: payment.userId,
            processedAt: now,
            payload: {
              event_type: "manual_payment.confirmed",
              occurred_at: now.toISOString(),
              data: { id: payment.reference, invoice_id: payment.invoiceId, amount_minor: payment.amountMinor, currency: payment.currency, usd_cents: usdCents, plan: plan.key, interval: payment.interval, transaction_id: transactionId, payer_phone: payment.payerPhone, network: payment.network, period_mode: period.mode, period_start: period.start.toISOString(), period_end: period.end.toISOString() },
            },
          },
        });
        await writeAudit(tx, ctx, "confirm_momo_payment", `payment:${paymentId}`, { status: "pending", subscription: before }, { status: "confirmed", reference: payment.reference, invoiceId: payment.invoiceId, amountMinor: payment.amountMinor, currency: payment.currency, period: period.mode, subscription: after, transactionId, ...(payment.transactionId ? {} : { transactionIdBy: "admin" }), screenshot: payment.proofBytes != null });
      });
    } catch (error) {
      // The subscription changed under us (a webhook, another admin): read it again and recompute the period, once.
      if (error instanceof SubscriptionMoved && attempt === 0) continue;
      if (error instanceof SubscriptionMoved) throw new AdminError("conflict", "The subscription keeps changing while confirming. Look at the client and try again.");
      // The partial unique index (network + transaction id) caught a confirmation racing this one.
      if (isUnique(error)) throw new AdminError("conflict", "That transaction id is already used on another payment. Nothing was changed.");
      throw error;
    }
    // After the commit: analytics and the emails. None of them can undo the confirmation.
    if (offer) clearPlanCache();
    const review = flagged as { invoice: { id: string; number: string; totalMinor: number; currency: string }; company: string; second: boolean } | null;
    if (review) await sendInvoiceReviewAlertEmail({ second: review.second, number: review.invoice.number, company: review.company, invoiceId: review.invoice.id, source: "momo", reference: payment.reference, paidMinor: payment.amountMinor, paidCurrency: payment.currency, invoiceMinor: review.invoice.totalMinor, invoiceCurrency: review.invoice.currency }).catch(() => false);
    const client = await clientOf(payment.userId);
    for (const name of subscriptionEventsFor(before, after, false)) {
      await trackEvent(name, { userId: payment.userId, businessId: client.businessId, props: { plan: plan.key, interval: payment.interval, from: before.plan, method: "momo" } });
    }
    let emailed = false;
    if (client.email) {
      emailed = await sendPlanActiveEmail({ email: client.email, name: client.name }, { planName: plan.name, interval: payment.interval, amountMinor: payment.amountMinor, currency: payment.currency, reference: payment.reference, periodEnd: period.end }).catch(() => false);
    }
    return { id: paymentId, status: "confirmed" as const, plan: plan.key, periodMode: period.mode, periodStart: period.start, periodEnd: period.end, emailed };
  }
}

/** The money did not arrive, or does not match: the owner says why, and the client sees it and can try again. */
export async function rejectManualPayment(ctx: AdminContext, paymentId: string, reason: string, now: Date = new Date()) {
  requireConsole(ctx);
  const why = reason.trim();
  if (why.length < 3 || why.length > 300) throw new AdminError("invalid", "Give the client a short reason (3 to 300 characters).");
  const payment = await prisma.manualPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AdminError("not_found", "No payment with that id.");
  const { count } = await prisma.manualPayment.updateMany({ where: { id: paymentId, status: "pending" }, data: { status: "rejected", rejectReason: why, decidedAt: now, decidedBy: ctx.actor } });
  if (count !== 1) throw new AdminError("conflict", `This payment is already ${payment.status}.`);
  await writeAudit(prisma, ctx, "reject_momo_payment", `payment:${paymentId}`, { status: "pending", reference: payment.reference }, { status: "rejected", reason: why });
  const client = await clientOf(payment.userId);
  const plan = await getPlan(payment.planKey);
  let emailed = false;
  if (client.email && payment.submittedAt) {
    emailed = await sendPaymentRejectedEmail({ email: client.email, name: client.name }, { planName: plan?.name ?? payment.planKey, amountMinor: payment.amountMinor, currency: payment.currency, reference: payment.reference, reason: why }).catch(() => false);
  }
  return { id: paymentId, status: "rejected" as const, emailed };
}

// ---- reads (admin console and Jarvis) ----------------------------------------------------------------------

export type ManualPaymentAdminView = ManualPaymentView & {
  userId: string;
  company: string | null;
  email: string | null;
  decidedBy: string | null;
  /** The checked screenshot's object path in the private bucket (the console shows it through a short signed URL). */
  proofPath: string | null;
  /** An older payment (any status, any company) that used the same transaction id on the same network. */
  seenBefore: { id: string; reference: string; status: string; sameCompany: boolean } | null;
};

async function adminViews(rows: Row[], now: Date): Promise<ManualPaymentAdminView[]> {
  const ids = [...new Set(rows.map((r) => r.userId))];
  const [users, businesses, subs] = ids.length
    ? await Promise.all([
        prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
        prisma.business.findMany({ where: { userId: { in: ids } }, select: { userId: true, name: true } }),
        prisma.subscription.findMany({ where: { userId: { in: ids } } }),
      ])
    : [[], [], []];
  const email = new Map(users.map((u) => [u.id, u.email]));
  const company = new Map(businesses.map((b) => [b.userId, b.name]));
  const sub = new Map(subs.map((s) => [s.userId, s]));
  return Promise.all(
    rows.map(async (r) => {
      const seen = r.network && r.transactionId ? await transactionUse(r.network, r.transactionId, { live: false, except: r.id }) : null;
      return {
        ...(await toView(r, sub.get(r.userId) ?? null, now)),
        userId: r.userId,
        company: company.get(r.userId) ?? null,
        email: email.get(r.userId) ?? null,
        decidedBy: r.decidedBy,
        proofPath: r.proofBytes != null ? r.proofPath : null,
        seenBefore: seen ? { id: seen.id, reference: seen.reference, status: seen.status, sameCompany: seen.userId === r.userId } : null,
      };
    }),
  );
}

/** A (createdAt, id) cursor: rows are paged newest first without skipping two rows created in the same millisecond. */
const cursorOf = (r: Pick<Row, "createdAt" | "id">) => `${r.createdAt.getTime()}~${r.id}`;
function parseCursor(cursor: string | undefined): Prisma.ManualPaymentWhereInput | null {
  if (!cursor) return null;
  const i = cursor.indexOf("~");
  const ms = Number(cursor.slice(0, i));
  if (i < 1 || !Number.isFinite(ms) || cursor.length > 120) throw new AdminError("invalid", "That cursor is not one this list gave out.");
  const at = new Date(ms);
  return { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.slice(i + 1) } }] };
}

/**
 * Payments, newest first. `status: "pending"` lists the queue instead: submitted ones first and oldest first (they
 * have waited longest), then started-only ones; ordered by the database.
 */
export async function listManualPayments(opts: { status?: string; userId?: string; reference?: string; cursor?: string; limit?: number } = {}, now: Date = new Date()): Promise<Page<ManualPaymentAdminView>> {
  const status = opts.status && (MANUAL_PAYMENT_STATUSES as readonly string[]).includes(opts.status) ? (opts.status as ManualPaymentStatus) : undefined;
  if (opts.status && !status) throw new AdminError("invalid", `status must be one of: ${MANUAL_PAYMENT_STATUSES.join(", ")}.`);
  if (opts.reference && !isReference(opts.reference.toUpperCase())) throw new AdminError("invalid", "A reference looks like BP-7K3Q.");
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 25) || 25, 1), 100);
  const queue = status === "pending";
  const where: Prisma.ManualPaymentWhereInput = {
    ...(status ? { status } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.reference ? { reference: opts.reference.toUpperCase() } : {}),
    ...(!queue ? (parseCursor(opts.cursor) ?? {}) : {}),
  };
  const rows = await prisma.manualPayment.findMany({
    where,
    orderBy: queue ? [{ submittedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return { items: await adminViews(page, now), nextCursor: rows.length > limit && !queue ? cursorOf(page[page.length - 1]) : null };
}

export async function getManualPayment(id: string, now: Date = new Date()): Promise<ManualPaymentAdminView> {
  const row = await prisma.manualPayment.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No payment with that id.");
  return (await adminViews([row], now))[0];
}

/** Submitted payments waiting for a decision (sidebar badge and the Overview attention list). */
export async function pendingManualPaymentCount(): Promise<number> {
  return prisma.manualPayment.count({ where: { status: "pending", submittedAt: { not: null } } });
}
