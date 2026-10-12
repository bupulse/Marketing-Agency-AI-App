import "server-only";
import type { BillingProvider, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { planForPriceId } from "@/lib/plan-catalog";
import { verifyCheckoutUser } from "./signing";
import type { ProviderSubscription } from "./types";

/**
 * What happened to a provider subscription update:
 * - applied: written to the user's Subscription
 * - stale: an older update than the one we have (providers don't guarantee order)
 * - unknown_price: not one of our prices (a price the plans do not know yet: retry later)
 * - unknown_user: no account to attach it to (no valid signed user id, or the account is gone)
 * - duplicate: the account already has a different live subscription (a second purchase)
 */
export type ApplyOutcome = "applied" | "stale" | "unknown_price" | "unknown_user" | "duplicate";

const LIVE = new Set(["ACTIVE", "PAST_DUE", "TRIALING"]);

/**
 * Writes a provider subscription onto the user's Subscription row. Called from webhooks and
 * after actions (cancel/resume/change). Upgrading from the trial ends the trial: paid starts now.
 */
export async function applyProviderSubscription(provider: BillingProvider, sub: ProviderSubscription): Promise<ApplyOutcome> {
  const match = await planForPriceId(provider, sub.providerPriceId);
  if (!match) return "unknown_price";

  // The owner is whoever already holds this subscription id (set by us earlier). Otherwise the
  // user id from checkout, but only when the server's signature proves we put it there.
  let row = await prisma.subscription.findFirst({
    where: { providerSubscriptionId: sub.providerSubscriptionId },
    select: { userId: true, providerSubscriptionId: true, status: true, provider: true, currentPeriodEnd: true },
  });
  if (!row && sub.userId && (await verifyCheckoutUser(sub.userId, sub.userIdSignature))) {
    row = await prisma.subscription.findUnique({
      where: { userId: sub.userId },
      select: { userId: true, providerSubscriptionId: true, status: true, provider: true, currentPeriodEnd: true },
    });
  }
  if (!row) return "unknown_user";

  const sameSubscription = row.providerSubscriptionId === sub.providerSubscriptionId;
  // A paid-up Mobile Money plan (no provider subscription id, ACTIVE, period not over) is not ended by a late event of
  // an old card subscription, and a new live card subscription on top of it is a duplicate, like a second card
  // purchase. Once the MoMo period is over or past due, a new card subscription simply replaces it.
  const momoPaidUp = row.provider === "MANUAL_MOMO" && row.status === "ACTIVE" && row.currentPeriodEnd !== null && row.currentPeriodEnd > new Date();
  if (!sameSubscription && momoPaidUp) return LIVE.has(sub.status) ? "duplicate" : "stale";
  if (!sameSubscription && row.providerSubscriptionId) {
    // The account holds another subscription. Only a live new one may replace one that has ended
    // (re-subscribing after cancelling). Anything else must not touch the current plan.
    if (LIVE.has(row.status)) return LIVE.has(sub.status) ? "duplicate" : "stale";
    if (!LIVE.has(sub.status)) return "stale";
  }

  const data: Prisma.SubscriptionUncheckedUpdateManyInput = {
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
  };

  // One conditional write: it only lands if nobody changed the subscription id meanwhile and this
  // update is not older than the one stored, so concurrent webhooks can't leave an older state.
  const { count } = await prisma.subscription.updateMany({
    where: {
      userId: row.userId,
      providerSubscriptionId: row.providerSubscriptionId,
      ...(sameSubscription && sub.updatedAt
        ? { OR: [{ providerUpdatedAt: null }, { providerUpdatedAt: { lte: sub.updatedAt } }] }
        : {}),
    },
    data,
  });
  return count > 0 ? "applied" : "stale";
}
