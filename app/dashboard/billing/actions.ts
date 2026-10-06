"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { activeProvider, billingAdapter, isInterval, isPaidPlan, priceIdFor } from "@/lib/billing";
import { invoiceUrl } from "@/lib/billing/paddle";
import { applyProviderSubscription } from "@/lib/billing/apply";
import type { CheckoutConfig, Invoice, PaidPlan } from "@/lib/billing";
import type { BillingInterval } from "@/lib/generated/prisma/client";

export type BillingResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const planSchema = z.object({
  plan: z.string().refine(isPaidPlan, "Choose Standard or Pro."),
  interval: z.string().refine(isInterval, "Choose monthly or yearly."),
});

const NOT_READY = "Payments are not available right now. Please try again in a little while.";
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

// Opens checkout for a first purchase (trial, or after a plan ended). Paying customers use changePlan.
export async function startCheckout(input: { plan: string; interval: string }): Promise<BillingResult<{ config: CheckoutConfig }>> {
  const user = await requireActiveUser();
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a plan." };
  const plan = parsed.data.plan as PaidPlan;
  const interval = parsed.data.interval as BillingInterval;

  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (managed(sub) && sub?.plan !== "TRIAL") {
    return { ok: false, error: "You already have a paid plan. Use Switch plan to change it." };
  }
  if (!user.email) return { ok: false, error: "Add an email address to your account first." };

  try {
    const adapter = billingAdapter(activeProvider());
    if (!adapter.isConfigured()) return { ok: false, error: NOT_READY };
    const config = await adapter.checkoutConfig({
      userId: user.id,
      email: user.email,
      plan,
      interval,
      providerCustomerId: sub?.provider === adapter.provider ? sub.providerCustomerId : null,
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
  const priceId = priceIdFor(sub.provider, plan, interval);
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
  const sub = managed(await prisma.subscription.findUnique({ where: { userId: user.id } }));
  if (!sub || !sub.provider || !sub.providerSubscriptionId) return { ok: false, error: "You do not have a paid plan." };

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
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (!sub?.provider || !sub.providerCustomerId) return { ok: false, error: "You do not have a paid plan." };

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
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (!sub?.provider || !sub.providerCustomerId) return [];
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
  const sub = await prisma.subscription.findUnique({
    where: { userId: user.id },
    select: { plan: true, status: true, updatedAt: true },
  });
  if (!sub || sub.plan === "TRIAL" || sub.status !== "ACTIVE") return false;
  return !Number.isFinite(since) || sub.updatedAt.getTime() >= since;
}
