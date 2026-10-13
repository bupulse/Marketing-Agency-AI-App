import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { STALE_ADDITION_REASON } from "./shared";

// The step that switches a custom plan on (docs/OFFERS.md). Called by the Mobile Money confirmation
// (lib/billing/momo.ts confirmManualPayment), inside its transaction, for a payment of an offer: directly (offerId) or
// through the invoice made from the offer (Mark as paid goes through the same confirmation). The subscription write
// (plan, ACTIVE, period, usage reset) is the confirmation's own; this part settles the offer. Kept apart from
// lib/offers/service.ts so the payment code does not import the offer flows that import it.

type Tx = Prisma.TransactionClient;
type OfferRow = Prisma.PlanOfferGetPayload<object>;

/** The offer a payment settles: its own offerId, or the offer whose invoice it pays. Null for every other payment. */
export async function offerForPayment(payment: { offerId?: string | null; invoiceId: string | null }, db: Pick<typeof prisma, "planOffer"> = prisma): Promise<OfferRow | null> {
  if (payment.offerId) return db.planOffer.findUnique({ where: { id: payment.offerId } });
  if (payment.invoiceId) return db.planOffer.findFirst({ where: { invoiceId: payment.invoiceId } });
  return null;
}

/** The money must be exactly the offer's price, in its currency (also checked before the confirmation starts). */
export function assertOfferAmount(offer: Pick<OfferRow, "adjustedMinor" | "currency">, paid: { amountMinor: number; currency: string }) {
  if (paid.amountMinor !== offer.adjustedMinor || paid.currency.toUpperCase() !== offer.currency.toUpperCase()) {
    throw new AdminError("conflict", `This payment is ${paid.amountMinor} ${paid.currency.toUpperCase()}, but the custom plan offer costs ${offer.adjustedMinor} ${offer.currency.toUpperCase()}. Reject it (refund the difference if the money arrived), then ask the client to pay the offer's price from Billing.`);
  }
}

/**
 * accepted -> paid, once (a conditional write: a replay or a second confirmation finds it paid and stops the whole
 * transaction). The company's older custom plans are retired (their payments keep pointing at them), an open invoice
 * of the offer that this payment did not pay is voided (so the client cannot pay twice), unsubmitted Mobile Money
 * payments of the offer are closed, and the request behind it is marked offered. Audited.
 */
export async function markOfferPaidInTx(tx: Tx, ctx: AdminContext, input: { offer: OfferRow; paymentId: string; invoiceId: string | null; planKey: string; amountMinor: number; currency: string }, now: Date) {
  const { offer } = input;
  if (offer.customPlanKey !== input.planKey) throw new AdminError("conflict", "This payment is for a different plan than the offer's custom plan. Reject it and ask the client to pay again from Billing.");
  assertOfferAmount(offer, input);
  const paidBy = `manual_payment:${input.paymentId}`;
  const claim = await tx.planOffer.updateMany({ where: { id: offer.id, status: "accepted" }, data: { status: "paid", paidAt: now, paidBy } });
  if (claim.count !== 1) throw new AdminError("conflict", "This offer was paid or withdrawn a moment ago. Nothing was changed.");
  const retired = await tx.planDefinition.updateMany({ where: { businessId: offer.businessId, isCustom: true, key: { not: input.planKey }, status: { not: "retired" } }, data: { status: "retired" } });
  if (offer.invoiceId && offer.invoiceId !== input.invoiceId) {
    await tx.invoice.updateMany({ where: { id: offer.invoiceId, status: "sent" }, data: { status: "void", voidedAt: now, voidReason: "The custom plan offer was paid by Mobile Money." } });
  }
  await tx.manualPayment.updateMany({ where: { offerId: offer.id, status: "pending", submittedAt: null, id: { not: input.paymentId } }, data: { status: "expired", decidedAt: now, decidedBy: ctx.actor } });
  if (offer.requestId) await tx.customPlanRequest.updateMany({ where: { id: offer.requestId, status: { in: ["new", "contacted"] } }, data: { status: "offered" } });
  await writeAudit(tx, ctx, "offer_paid", `offer:${offer.id}`, { status: "accepted" }, { status: "paid", paidBy, plan: input.planKey, businessId: offer.businessId, amountMinor: offer.adjustedMinor, currency: offer.currency, retiredPlans: retired.count });
}

/**
 * An add-features quote whose period changed before it was paid (lib/offers/shared.ts additionFits): withdrawn with a
 * reason the client sees on Billing (add the features again for a new quote), its invoice voided, its unsubmitted
 * payments closed and its prepared plan retired. A payment the client already reported stays pending for the owner to
 * reject (and refund). Audited as the system; a second call changes nothing.
 */
export async function withdrawStaleAddition(offer: Pick<OfferRow, "id" | "status" | "invoiceId" | "customPlanKey">, now: Date): Promise<boolean> {
  const ctx: AdminContext = { actor: "system:offers", ip: null, viaApi: false };
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.planOffer.updateMany({ where: { id: offer.id, status: { in: ["sent", "accepted"] } }, data: { status: "withdrawn", withdrawnAt: now, withdrawReason: STALE_ADDITION_REASON } });
    if (count !== 1) return false;
    await tx.manualPayment.updateMany({ where: { offerId: offer.id, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: ctx.actor } });
    if (offer.invoiceId && !offer.invoiceId.startsWith("claim:")) {
      await tx.manualPayment.updateMany({ where: { invoiceId: offer.invoiceId, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: ctx.actor } });
      await tx.invoice.updateMany({ where: { id: offer.invoiceId, status: "sent" }, data: { status: "void", voidedAt: now, voidReason: "The plan's period changed before these added features were paid: priced again on request." } });
    }
    if (offer.customPlanKey) await tx.planDefinition.updateMany({ where: { key: offer.customPlanKey, isCustom: true, status: { not: "retired" } }, data: { status: "retired" } });
    await writeAudit(tx, ctx, "withdraw_offer", `offer:${offer.id}`, { status: offer.status }, { status: "withdrawn", reason: "stale_addition" });
    return true;
  });
}
