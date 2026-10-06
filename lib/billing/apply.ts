import "server-only";
import type { BillingProvider } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { planForPriceId } from "./catalog";
import type { ProviderSubscription } from "./types";

/**
 * Writes a provider subscription onto the user's Subscription row. Called from webhooks and
 * after actions (cancel/resume/change). Upgrading from the trial ends the trial: paid starts now.
 * Returns false when the subscription can't be matched to a user or price.
 */
export async function applyProviderSubscription(provider: BillingProvider, sub: ProviderSubscription): Promise<boolean> {
  const match = planForPriceId(provider, sub.providerPriceId);
  if (!match) return false;

  // Find the owner: by subscription id once known, else by the user id from checkout.
  const existing = await prisma.subscription.findFirst({
    where: { OR: [{ providerSubscriptionId: sub.providerSubscriptionId }, ...(sub.userId ? [{ userId: sub.userId }] : [])] },
    select: { userId: true, providerSubscriptionId: true, providerUpdatedAt: true },
  });
  if (!existing) return false;

  // A newer subscription replaced this one (e.g. re-subscribed after cancelling): ignore late
  // events about the old one so they cannot overwrite the current plan.
  if (
    existing.providerSubscriptionId &&
    existing.providerSubscriptionId !== sub.providerSubscriptionId &&
    (sub.status === "CANCELED" || sub.status === "EXPIRED")
  ) {
    return true;
  }

  // Providers don't guarantee webhook order: never let an older state overwrite a newer one.
  if (
    existing.providerSubscriptionId === sub.providerSubscriptionId &&
    existing.providerUpdatedAt &&
    sub.updatedAt &&
    sub.updatedAt < existing.providerUpdatedAt
  ) {
    return true;
  }

  await prisma.subscription.update({
    where: { userId: existing.userId },
    data: {
      provider,
      plan: match.plan,
      interval: match.interval,
      status: sub.status,
      providerSubscriptionId: sub.providerSubscriptionId,
      providerCustomerId: sub.providerCustomerId,
      providerPriceId: sub.providerPriceId,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      providerUpdatedAt: sub.updatedAt,
      trialEndsAt: null,
    },
  });
  return true;
}
