"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isServiceEnabled, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";
import { requireActiveUser } from "@/lib/auth/require-user";
import { askMessage, can } from "@/lib/team/roles";
import { activeProvider, billingAdapter, isInterval } from "@/lib/billing";
import { getPlan, priceIdFor } from "@/lib/plan-catalog";
import { companyPlans, regionPriceIdFor } from "@/lib/region-prices";
import { invoiceUrl } from "@/lib/billing/paddle";
import { applyProviderSubscription } from "@/lib/billing/apply";
import { paymentMethod } from "@/lib/billing/methods";
import { cancelManualPayment, currentManualPayment, ManualPaymentError, startInvoicePayment } from "@/lib/billing/momo";
import type { ManualPaymentView } from "@/lib/billing/momo-shared";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { acceptOffer, OfferError } from "@/lib/offers/service";
import { noteRegionMismatch } from "@/lib/region-check";
import type { CheckoutConfig, Invoice, PaidPlan } from "@/lib/billing";
import type { BillingInterval } from "@/lib/generated/prisma/client";

export type BillingResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const planSchema = z.object({
  plan: z.string().min(1).max(64),
  interval: z.string().refine(isInterval, "Choose monthly or yearly."),
});

const NOT_READY = "Payments are not available right now. Please try again in a little while.";
const NOT_IN_REGION = "That plan is not offered where your business is. Choose one of the plans shown.";
// A region's card prices exist in Paddle only once they are synced (docs/REGIONS.md); until then the region's other method is the way.
const CARD_NOT_READY = "Card payments are not ready for your region yet. Pay by Mobile Money instead, or contact support.";
const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/** A paying subscription the customer can manage: has a provider subscription and is not cancelled. */
function managed<T extends { provider: unknown; providerSubscriptionId: string | null; status: string }>(sub: T | null) {
  if (!sub || !sub.provider || !sub.providerSubscriptionId) return null;
  if (sub.status === "CANCELED" || sub.status === "EXPIRED") return null;
  return sub;
}

function isNotConfigured(error: unknown) {
  return error instanceof Error && /not configured|not available/i.test(error.message);
}

// Paddle switched off in the admin console: cancelling, resuming, the card page and receipts cannot run, so say so plainly
// and point to support (a cancellation request is then handled by hand) instead of failing silently.
const BILLING_PAUSED = "Billing is temporarily unavailable. Please contact support and we will help you, including with cancelling.";

// Opens checkout for a first purchase (trial, or after a plan ended). Paying customers use changePlan.
export async function startCheckout(input: { plan: string; interval: string }): Promise<BillingResult<{ config: CheckoutConfig }>> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return { ok: false, error: askMessage("billing") };
  // Paddle switched off in the admin console: no new checkouts (webhooks still arrive).
  if (!(await isServiceEnabled("paddle"))) return { ok: false, error: UNAVAILABLE_MESSAGE };
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a plan." };
  const plan = parsed.data.plan as PaidPlan;
  const interval = parsed.data.interval as BillingInterval;
  // New purchases: only active, paid plans (hidden and retired ones are closed to new sign-ups).
  const target = await getPlan(plan);
  if (!target || target.isTrial || target.status !== "active") return { ok: false, error: "That plan is not available. Choose one of the plans shown." };

  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (managed(sub) && sub?.plan !== "TRIAL") {
    return { ok: false, error: "You already have a paid plan. Use Switch plan to change it." };
  }
  // A Mobile Money plan that is still paid for: the card would charge again for the same time. Switching to card
  // happens at the renewal, once the paid period has ended.
  if (sub?.provider === "MANUAL_MOMO" && sub.status === "ACTIVE" && sub.currentPeriodEnd && sub.currentPeriodEnd > new Date()) {
    return { ok: false, error: "Your plan is paid by Mobile Money until the end of the current period. You can switch to card after that." };
  }
  if (!user.email) return { ok: false, error: "Add an email address to your account first." };
  // Soft region check: a checkout from a dearer region's IP is flagged for the admin, never refused (docs/REGIONS.md).
  await noteRegionMismatch(user.businessId, "card");
  // The plan must be offered in the company's region, at the region's price. Billing never looks at the visitor's IP.
  const { region, plans } = await companyPlans(user.businessId);
  if (!plans.some((p) => p.key === plan)) return { ok: false, error: NOT_IN_REGION };
  const priceId = await regionPriceIdFor("PADDLE", plan, region.key, interval);
  if (!priceId) return { ok: false, error: region.paymentMethods.includes("momo") ? CARD_NOT_READY : NOT_READY };

  try {
    const adapter = billingAdapter(activeProvider());
    if (!adapter.isConfigured()) return { ok: false, error: NOT_READY };
    const config = await adapter.checkoutConfig({
      userId: user.id,
      email: user.email,
      plan,
      interval,
      providerCustomerId: sub?.provider === adapter.provider ? sub.providerCustomerId : null,
      priceId,
    });
    return { ok: true, config };
  } catch (error) {
    if (isNotConfigured(error)) return { ok: false, error: NOT_READY };
    console.error("startCheckout failed", error);
    return { ok: false, error: GENERIC };
  }
}

// Switches a paying customer to another plan or interval. The provider charges or credits the
// difference now, and our copy is updated straight away so limits change immediately.
export async function changePlan(input: { plan: string; interval: string }): Promise<BillingResult> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return { ok: false, error: askMessage("billing") };
  if (!(await isServiceEnabled("paddle"))) return { ok: false, error: UNAVAILABLE_MESSAGE };
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a plan." };
  const plan = parsed.data.plan as PaidPlan;
  const interval = parsed.data.interval as BillingInterval;

  const sub = managed(await prisma.subscription.findUnique({ where: { userId: user.id } }));
  if (!sub || sub.plan === "TRIAL" || !sub.provider || !sub.providerSubscriptionId) {
    return { ok: false, error: "You do not have a paid plan to change yet." };
  }
  if (sub.status === "PAST_DUE") {
    return { ok: false, error: "Update your payment method first, then you can change plan." };
  }
  // Switching to another plan needs it to be on sale; staying on the plan you have (even a retired one) only changes the interval.
  const target = await getPlan(plan);
  if (!target || target.isTrial || (target.status !== "active" && plan !== sub.plan)) {
    return { ok: false, error: "That plan is not available. Choose one of the plans shown." };
  }
  // Another plan must be offered in the company's region; staying on the current plan only changes the interval.
  const { region, plans } = await companyPlans(user.businessId);
  if (plan !== sub.plan && !plans.some((p) => p.key === plan)) return { ok: false, error: NOT_IN_REGION };
  const priceId = (await regionPriceIdFor(sub.provider, plan, region.key, interval)) ?? (plan === sub.plan ? await priceIdFor(sub.provider, plan, interval) : null);
  if (!priceId) return { ok: false, error: NOT_READY };
  if (priceId === sub.providerPriceId) return { ok: false, error: "You are already on that plan." };

  try {
    const updated = await billingAdapter(sub.provider).changePlan(sub.providerSubscriptionId, priceId);
    await applyProviderSubscription(sub.provider, updated);
  } catch (error) {
    if (isNotConfigured(error)) return { ok: false, error: NOT_READY };
    console.error("changePlan failed", error);
    return { ok: false, error: GENERIC };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

async function setCancellation(cancel: boolean): Promise<BillingResult> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return { ok: false, error: askMessage("billing") };
  const sub = managed(await prisma.subscription.findUnique({ where: { userId: user.id } }));
  if (!sub || !sub.provider || !sub.providerSubscriptionId) return { ok: false, error: "You do not have a paid plan." };
  if (!(await isServiceEnabled("paddle"))) return { ok: false, error: BILLING_PAUSED };

  try {
    const adapter = billingAdapter(sub.provider);
    const updated = cancel
      ? await adapter.cancelAtPeriodEnd(sub.providerSubscriptionId)
      : await adapter.resume(sub.providerSubscriptionId);
    await applyProviderSubscription(sub.provider, updated);
  } catch (error) {
    if (isNotConfigured(error)) return { ok: false, error: NOT_READY };
    console.error("setCancellation failed", error);
    return { ok: false, error: GENERIC };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// Cancels at the end of the paid period. The plan stays active until then and nothing is deleted.
export async function cancelSubscription(): Promise<BillingResult> {
  return setCancellation(true);
}

export async function resumeSubscription(): Promise<BillingResult> {
  return setCancellation(false);
}

// A link to the provider's secure page for updating the card or payment method.
export async function openPortal(): Promise<BillingResult<{ url: string }>> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return { ok: false, error: askMessage("billing") };
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (sub?.provider === "MANUAL_MOMO") return { ok: false, error: "You pay by Mobile Money, so there is no card to update. Renew from the Billing page when your plan ends." };
  if (!sub?.provider || !sub.providerCustomerId) return { ok: false, error: "You do not have a paid plan." };
  if (!(await isServiceEnabled("paddle"))) return { ok: false, error: BILLING_PAUSED };

  try {
    const url = await billingAdapter(sub.provider).portalUrl({
      providerCustomerId: sub.providerCustomerId,
      providerSubscriptionId: sub.providerSubscriptionId,
    });
    return { ok: true, url };
  } catch (error) {
    if (isNotConfigured(error)) return { ok: false, error: NOT_READY };
    console.error("openPortal failed", error);
    return { ok: false, error: "We could not open the payment page. Please try again." };
  }
}

// Receipts and invoices for the caller's own customer record. Empty when there are none or the provider is unreachable.
export async function getInvoices(): Promise<Invoice[]> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return [];
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (!sub?.provider || !sub.providerCustomerId) return [];
  if (!(await isServiceEnabled("paddle"))) return [];
  try {
    return await billingAdapter(sub.provider).listInvoices(sub.providerCustomerId);
  } catch (error) {
    console.error("getInvoices failed", error);
    return [];
  }
}

// A fresh receipt link (provider links expire), only for a payment in the caller's own list.
export async function getInvoiceUrl(id: string): Promise<BillingResult<{ url: string }>> {
  const invoices = await getInvoices();
  if (!(await isServiceEnabled("paddle"))) return { ok: false, error: BILLING_PAUSED };
  if (!invoices.some((invoice) => invoice.id === id)) return { ok: false, error: "We could not find that receipt." };
  try {
    return { ok: true, url: await invoiceUrl(id) };
  } catch (error) {
    console.error("getInvoiceUrl failed", error);
    return { ok: false, error: "We could not open that receipt. Please try again." };
  }
}

// Cheap check the page polls after checkout: is a paid plan active that changed after `since`?
export async function checkoutActivated(since: number): Promise<boolean> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return false;
  const sub = await prisma.subscription.findUnique({
    where: { userId: user.id },
    select: { plan: true, status: true, updatedAt: true },
  });
  if (!sub || sub.plan === "TRIAL" || sub.status !== "ACTIVE") return false;
  return !Number.isFinite(since) || sub.updatedAt.getTime() >= since;
}

// ---- Mobile Money (MoMo / Airtel), paid by hand and confirmed by BuPulse (docs/MOMO.md) -------------------------

/** Start, "I've paid" and cancel share one limit per company: each can alert the owner or write a payment row. */
async function momoLimited(userId: string): Promise<BillingResult<never> | null> {
  try {
    await rateLimit(`momo:${userId}`, RATE_LIMITS.momo);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }
}

function momoError(error: unknown): BillingResult<never> {
  if (error instanceof ManualPaymentError) return { ok: false, error: error.message };
  console.error("Mobile Money action failed", error);
  return { ok: false, error: GENERIC };
}

// Starts (or returns the open) Mobile Money payment for a plan and period: the amount, the reference and where to pay.
// With `invoiceId`: the payment of that invoice of the caller's company (amount = invoice total, reference = invoice number).
export async function startMomoPayment(input: { plan: string; interval: string } | { invoiceId: string }): Promise<BillingResult<{ payment: ManualPaymentView }>> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return { ok: false, error: askMessage("billing") };
  const limited = await momoLimited(user.id);
  if (limited) return limited;
  // Soft region check: a payment started from a dearer region's IP is flagged for the admin, never refused (docs/REGIONS.md).
  await noteRegionMismatch(user.businessId, "momo");
  if (input && typeof input === "object" && "invoiceId" in input) {
    const invoiceId = String(input.invoiceId ?? "");
    if (!invoiceId || invoiceId.length > 64) return { ok: false, error: "We could not find that invoice." };
    try {
      const payment = await startInvoicePayment({ userId: user.id, invoiceId });
      revalidatePath("/dashboard", "layout");
      return { ok: true, payment };
    } catch (error) {
      return momoError(error);
    }
  }
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a plan." };
  try {
    const payment = await paymentMethod("MANUAL_MOMO").startPayment({ userId: user.id, plan: parsed.data.plan, interval: parsed.data.interval as BillingInterval });
    revalidatePath("/dashboard/billing");
    return { ok: true, payment };
  } catch (error) {
    return momoError(error);
  }
}

// "I've paid": the transaction id and the phone the client paid from. BuPulse is alerted and checks within minutes.
export async function submitMomoProof(input: { paymentId: string; transactionId: string; payerPhone: string; network: string }): Promise<BillingResult<{ payment: ManualPaymentView }>> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return { ok: false, error: askMessage("billing") };
  const limited = await momoLimited(user.id);
  if (limited) return limited;
  try {
    const payment = await paymentMethod("MANUAL_MOMO").submitProof({ userId: user.id, ...input });
    revalidatePath("/dashboard/billing");
    return { ok: true, payment };
  } catch (error) {
    return momoError(error);
  }
}

// The client changed their mind before paying. A payment they already reported stays with BuPulse to decide.
export async function cancelMomoPayment(paymentId: string): Promise<BillingResult> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return { ok: false, error: askMessage("billing") };
  const limited = await momoLimited(user.id);
  if (limited) return limited;
  const done = await cancelManualPayment(user.id, String(paymentId));
  revalidatePath("/dashboard/billing");
  return done ? { ok: true } : { ok: false, error: "This payment can no longer be cancelled. If you have paid, wait for it to be confirmed." };
}

// Cheap check the waiting screen polls: the client's current payment (pending, or recently rejected), or null.
export async function momoPaymentStatus(): Promise<ManualPaymentView | null> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return null;
  return currentManualPayment(user.id);
}

// ---- custom plan offers (docs/OFFERS.md) ---------------------------------------------------------------------------

// Accept the company's offer and choose how to pay: Mobile Money opens the usual pay screen for the offer's price;
// invoice issues an invoice from the offer (shown on Billing, payable by Mobile Money with its number). Owner only.
export async function acceptOfferAction(input: { offerId: string; method: string }): Promise<BillingResult<{ method: "momo" | "invoice" }>> {
  const user = await requireActiveUser();
  if (!can(user.role, "billing")) return { ok: false, error: askMessage("billing") };
  const offerId = String(input?.offerId ?? "");
  const method = input?.method === "invoice" ? "invoice" : input?.method === "momo" ? "momo" : null;
  if (!offerId || offerId.length > 64 || !method) return { ok: false, error: "Choose how you want to pay." };
  try {
    await rateLimit(`offer:${user.businessId}`, RATE_LIMITS.offerAccept);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }
  // Same soft region check as the other Mobile Money starts (flagged for the admin, never refused).
  if (method === "momo") await noteRegionMismatch(user.businessId, "momo");
  try {
    await acceptOffer({ userId: user.id, actorId: user.actorId, businessId: user.businessId, offerId, method });
    revalidatePath("/dashboard", "layout");
    return { ok: true, method };
  } catch (error) {
    if (error instanceof OfferError) return { ok: false, error: error.message };
    console.error("Accepting an offer failed", error);
    return { ok: false, error: GENERIC };
  }
}
