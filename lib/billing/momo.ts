import "server-only";
import type { BillingInterval, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext, type Page } from "@/lib/admin/types";
import { trackEvent } from "@/lib/analytics/events";
import { subscriptionEventsFor } from "@/lib/analytics/math";
import { getPlan } from "@/lib/plan-catalog";
import { sendPaymentRejectedEmail, sendPaymentToCheckEmail, sendPlanActiveEmail } from "./momo-emails";
import { getMomoPrice, getMomoSettings } from "./momo-settings";
import {
  DAY_MS,
  isReference,
  makeReference,
  MANUAL_PAYMENT_STATUSES,
  momoConfigured,
  nextManualPeriod,
  proofSchema,
  REJECTED_SHOWN_DAYS,
  usdCentsOf,
  type ManualPaymentStatus,
  type ManualPaymentView,
  type MomoNetwork,
  type ProofInput,
} from "./momo-shared";

// Manual Mobile Money payments (docs/MOMO.md). The client side (start, submit the proof, cancel) is keyed on the
// company account id; the owner side (confirm, reject) runs in the admin console only and is audited. Every state
// change is one conditional write on the status, so a double click or two tabs cannot confirm or submit twice.

/** The client-facing message thrown by the client-side functions. Safe to show. */
export class ManualPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualPaymentError";
  }
}

const LIVE = new Set(["ACTIVE", "PAST_DUE", "TRIALING"]);
const REFERENCE_TRIES = 6;

type Row = Prisma.ManualPaymentGetPayload<object>;

async function toView(row: Row): Promise<ManualPaymentView> {
  return {
    id: row.id,
    planKey: row.planKey,
    planName: (await getPlan(row.planKey))?.name ?? row.planKey,
    interval: row.interval,
    amountMinor: row.amountMinor,
    currency: row.currency,
    reference: row.reference,
    status: row.status as ManualPaymentStatus,
    submitted: row.submittedAt !== null,
    transactionId: row.transactionId,
    payerPhone: row.payerPhone,
    network: (row.network as MomoNetwork | null) ?? null,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
  };
}

// ---- client side -------------------------------------------------------------------------------------------

/** The client's open payment, or their last rejected one (for a week), so the Billing page can show where they are. */
export async function currentManualPayment(userId: string, now: Date = new Date()): Promise<ManualPaymentView | null> {
  const pending = await prisma.manualPayment.findFirst({ where: { userId, status: "pending" }, orderBy: { createdAt: "desc" } });
  if (pending) return toView(pending);
  const rejected = await prisma.manualPayment.findFirst({ where: { userId, status: "rejected", decidedAt: { gte: new Date(now.getTime() - REJECTED_SHOWN_DAYS * DAY_MS) } }, orderBy: { decidedAt: "desc" } });
  if (!rejected) return null;
  // Only until the client pays again: a newer confirmed payment hides an old rejection.
  const newer = await prisma.manualPayment.findFirst({ where: { userId, status: "confirmed", createdAt: { gt: rejected.createdAt } }, select: { id: true } });
  return newer ? null : toView(rejected);
}

/**
 * Starts a payment: a pending row with a fresh reference and the plan's RWF price, for the client to quote when
 * paying. One pending payment per company: starting again returns the open one, so a reload or a second tab never
 * makes a second reference.
 */
export async function startManualPayment(input: { userId: string; plan: string; interval: BillingInterval; now?: Date }): Promise<ManualPaymentView> {
  const now = input.now ?? new Date();
  const settings = await getMomoSettings();
  if (!momoConfigured(settings)) throw new ManualPaymentError("Mobile Money payments are not available right now. Please pay by card or contact support.");
  const plan = await getPlan(input.plan);
  if (!plan || plan.isTrial || plan.status !== "active") throw new ManualPaymentError("That plan is not available. Choose one of the plans shown.");
  const sub = await prisma.subscription.findUnique({ where: { userId: input.userId } });
  if (!sub) throw new ManualPaymentError("Your account is still being set up. Please try again in a moment.");
  // A live card subscription renews by itself; paying by MoMo on top would pay twice and the card webhooks would
  // overwrite the MoMo period. The client cancels the card plan first (it stays active until its period end).
  if (sub.provider === "PADDLE" && sub.providerSubscriptionId && LIVE.has(sub.status) && sub.plan !== "TRIAL") {
    throw new ManualPaymentError("You pay by card at the moment. Cancel the card plan first (it stays active until the end of the period you paid for), then pay by Mobile Money.");
  }
  const open = await prisma.manualPayment.findFirst({ where: { userId: input.userId, status: "pending" }, orderBy: { createdAt: "desc" } });
  if (open) {
    if (open.submittedAt) return toView(open);
    // Not paid yet: the client may still change their mind about the plan. Same plan and period: keep the reference.
    if (open.planKey === plan.key && open.interval === input.interval) return toView(open);
    await prisma.manualPayment.updateMany({ where: { id: open.id, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: "client" } });
  }
  const price = await getMomoPrice(plan.key, input.interval);
  if (!price || price.amountMinor <= 0) throw new ManualPaymentError("This plan has no Mobile Money price yet. Please pay by card or contact support.");
  for (let attempt = 0; attempt < REFERENCE_TRIES; attempt++) {
    try {
      const row = await prisma.manualPayment.create({
        data: { userId: input.userId, planKey: plan.key, interval: input.interval, amountMinor: price.amountMinor, currency: price.currency, reference: makeReference(attempt < 3 ? 4 : 6) },
      });
      return toView(row);
    } catch (error) {
      // A reference already in use: try another. Anything else is a real problem.
      if (!(error && typeof error === "object" && (error as { code?: string }).code === "P2002")) throw error;
    }
  }
  throw new ManualPaymentError("We could not create a payment reference. Please try again.");
}

/**
 * The client tapped "I've paid": records the transaction id and phone, and alerts the owner. Only the open,
 * not-yet-submitted payment of this company can be submitted, exactly once.
 */
export async function submitManualProof(userId: string, raw: ProofInput, now: Date = new Date()): Promise<ManualPaymentView> {
  const parsed = proofSchema.safeParse(raw);
  if (!parsed.success) throw new ManualPaymentError(parsed.error.issues[0]?.message ?? "Check the details and try again.");
  const { paymentId, transactionId, payerPhone, network } = parsed.data;
  const { count } = await prisma.manualPayment.updateMany({
    where: { id: paymentId, userId, status: "pending", submittedAt: null },
    data: { transactionId, payerPhone, network, submittedAt: now },
  });
  const row = await prisma.manualPayment.findFirst({ where: { id: paymentId, userId } });
  if (!row) throw new ManualPaymentError("We could not find that payment. Start again from the Billing page.");
  if (count !== 1) {
    if (row.status === "pending" && row.submittedAt) return toView(row); // already submitted: nothing to redo
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
      transactionId, payerPhone, network, company: business?.name ?? "A company", email: user?.email ?? "",
    });
  } catch (error) {
    await logError(error, { source: "billing.momo.alert", userId, paymentId });
  }
  trackEvent("momo_payment_submitted", { userId, props: { plan: row.planKey, interval: row.interval, amountMinor: row.amountMinor } });
  return toView(row);
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

/**
 * The owner saw the money arrive and clicked Confirm. Claims the payment (pending -> confirmed) and, in the same
 * transaction, writes the paid period onto the subscription: provider MANUAL_MOMO, the plan, ACTIVE, a period that
 * extends a running MoMo period or starts now, and no card ids. Usage counts from the new period start, so it resets.
 * Then the money is recorded for analytics (BillingEvent) and the client is emailed. Idempotent: a second click
 * finds the payment already confirmed and is refused without touching anything.
 */
export async function confirmManualPayment(ctx: AdminContext, paymentId: string, now: Date = new Date()) {
  requireConsole(ctx);
  const payment = await prisma.manualPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AdminError("not_found", "No payment with that id.");
  if (payment.status !== "pending") throw new AdminError("conflict", `This payment is already ${payment.status}.`);
  if (!payment.submittedAt) throw new AdminError("conflict", "The client has not said they paid yet (no transaction id). Wait for them, or ask them to tap I've paid.");
  const sub = await prisma.subscription.findUnique({ where: { userId: payment.userId } });
  if (!sub) throw new AdminError("not_found", "This client has no subscription any more.");
  const plan = await getPlan(payment.planKey);
  if (!plan) throw new AdminError("conflict", "The plan of this payment no longer exists.");
  if (sub.provider === "PADDLE" && sub.providerSubscriptionId && LIVE.has(sub.status) && sub.plan !== "TRIAL") {
    throw new AdminError("conflict", "This client has a live card subscription. Cancel it in Paddle first, or reject this payment and refund it by MoMo.");
  }
  const period = nextManualPeriod(sub, payment.interval, now);
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
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
  };
  const settings = await getMomoSettings();
  const usdCents = usdCentsOf(payment.amountMinor, payment.currency, settings.usdToRwf);
  await prisma.$transaction(async (tx) => {
    // The claim: only a pending, submitted payment moves to confirmed, once.
    const claim = await tx.manualPayment.updateMany({
      where: { id: paymentId, status: "pending", submittedAt: { not: null } },
      data: { status: "confirmed", decidedAt: now, decidedBy: ctx.actor, periodStart: period.start, periodEnd: period.end },
    });
    if (claim.count !== 1) throw new AdminError("conflict", "This payment was decided a moment ago. Nothing was changed.");
    // Guarded on the state we read, so a card webhook landing meanwhile cannot be overwritten blindly.
    const written = await tx.subscription.updateMany({ where: { userId: payment.userId, providerSubscriptionId: sub.providerSubscriptionId, status: sub.status }, data: after });
    if (written.count !== 1) throw new AdminError("conflict", "The subscription changed while confirming. Look at the client and try again.");
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
          data: { id: payment.reference, amount_minor: payment.amountMinor, currency: payment.currency, usd_cents: usdCents, plan: plan.key, interval: payment.interval, transaction_id: payment.transactionId, payer_phone: payment.payerPhone, network: payment.network, period_start: period.start.toISOString(), period_end: period.end.toISOString() },
        },
      },
    });
    await writeAudit(tx, ctx, "confirm_momo_payment", `payment:${paymentId}`, { status: "pending", subscription: before }, { status: "confirmed", reference: payment.reference, amountMinor: payment.amountMinor, currency: payment.currency, subscription: after });
  });
  // After the commit: analytics and the client's email. Neither can undo the confirmation.
  const client = await clientOf(payment.userId);
  for (const name of subscriptionEventsFor(before, after, false)) {
    trackEvent(name, { userId: payment.userId, businessId: client.businessId, props: { plan: plan.key, interval: payment.interval, from: before.plan, method: "momo" } });
  }
  let emailed = false;
  if (client.email) {
    emailed = await sendPlanActiveEmail({ email: client.email, name: client.name }, { planName: plan.name, interval: payment.interval, amountMinor: payment.amountMinor, currency: payment.currency, reference: payment.reference, periodEnd: period.end }).catch(() => false);
  }
  return { id: paymentId, status: "confirmed" as const, plan: plan.key, periodStart: period.start, periodEnd: period.end, emailed };
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
};

async function adminViews(rows: Row[]): Promise<ManualPaymentAdminView[]> {
  const ids = [...new Set(rows.map((r) => r.userId))];
  const [users, businesses] = ids.length
    ? await Promise.all([
        prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
        prisma.business.findMany({ where: { userId: { in: ids } }, select: { userId: true, name: true } }),
      ])
    : [[], []];
  const email = new Map(users.map((u) => [u.id, u.email]));
  const company = new Map(businesses.map((b) => [b.userId, b.name]));
  return Promise.all(rows.map(async (r) => ({ ...(await toView(r)), userId: r.userId, company: company.get(r.userId) ?? null, email: email.get(r.userId) ?? null, decidedBy: r.decidedBy })));
}

/** Payments waiting for the owner: submitted ones first (oldest first, they have waited longest), then started-only ones. */
export async function listManualPayments(opts: { status?: string; userId?: string; reference?: string; cursor?: string; limit?: number } = {}): Promise<Page<ManualPaymentAdminView>> {
  const status = opts.status && (MANUAL_PAYMENT_STATUSES as readonly string[]).includes(opts.status) ? (opts.status as ManualPaymentStatus) : undefined;
  if (opts.status && !status) throw new AdminError("invalid", `status must be one of: ${MANUAL_PAYMENT_STATUSES.join(", ")}.`);
  if (opts.reference && !isReference(opts.reference.toUpperCase())) throw new AdminError("invalid", "A reference looks like BP-7K3Q.");
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 25) || 25, 1), 100);
  const rows = await prisma.manualPayment.findMany({
    where: { ...(status ? { status } : {}), ...(opts.userId ? { userId: opts.userId } : {}), ...(opts.reference ? { reference: opts.reference.toUpperCase() } : {}), ...(opts.cursor ? { id: { lt: opts.cursor } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const items = await adminViews(page);
  if (status === "pending") items.sort((a, b) => Number(b.submitted) - Number(a.submitted) || (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt));
  return { items, nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

export async function getManualPayment(id: string): Promise<ManualPaymentAdminView> {
  const row = await prisma.manualPayment.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No payment with that id.");
  return (await adminViews([row]))[0];
}

/** Submitted payments waiting for a decision (sidebar badge and the Overview attention list). */
export async function pendingManualPaymentCount(): Promise<number> {
  return prisma.manualPayment.count({ where: { status: "pending", submittedAt: { not: null } } });
}
