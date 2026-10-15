import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { verifyCheckoutUser } from "@/lib/billing/signing";
import type { ProviderSubscription } from "@/lib/billing/types";
import { getPlan } from "@/lib/plan-catalog";
import { featureLabel, isFeatureKey } from "@/lib/features";
import { cardAddonMessage, readCardPlan, type OfferCardPlan } from "./shared";

// Features added to a card plan (docs/OFFERS.md, "Adding features to a card plan"): each is a recurring item on the
// client's card subscription, marked and signed in its price's custom data with the add-features offer that made it.
// This is the side the subscription events use (lib/billing/apply.ts), and the reads Billing shows. It never calls the
// card provider. Kept apart from lib/offers/card-plan.ts (the client's flow), which imports the offer service.

type OfferRow = Prisma.PlanOfferGetPayload<object>;

/**
 * The plan a card subscription is on, given its added-feature items: the custom plan of the newest add-features offer
 * whose items it carries (each offer's custom plan holds every feature added before it), and that offer when it still
 * waits for this confirmation (accepted: switch it on and settle it now). Only items signed by BuPulse for this client,
 * from offers on the same plan price, count. Null when there are none (the plan's own features apply); items that cannot
 * be recognised are logged for the owner (the client is paying for them).
 */
export async function cardAddonPlan(userId: string, sub: Pick<ProviderSubscription, "providerSubscriptionId" | "addons">, basePlanKey: string): Promise<{ planKey: string; settle: OfferRow | null } | null> {
  const items = sub.addons ?? [];
  if (items.length === 0) return null;
  const signed: string[] = [];
  for (const item of items) {
    if (item.offerId && item.userId === userId && (await verifyCheckoutUser(cardAddonMessage(item.offerId, userId), item.sig))) signed.push(item.offerId);
  }
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  const offers = signed.length > 0 && business ? await prisma.planOffer.findMany({ where: { id: { in: [...new Set(signed)] }, businessId: business.id, status: { in: ["accepted", "paid"] } } }) : [];
  // The one waiting for this confirmation is the newest (a company has one open offer at a time), else the latest paid.
  const rank = (o: OfferRow) => (o.status === "accepted" ? Number.MAX_SAFE_INTEGER : (o.paidAt ?? o.createdAt).getTime());
  const newest = offers.filter((o) => o.customPlanKey && readCardPlan(o.options)?.basePlanKey === basePlanKey).sort((a, b) => rank(b) - rank(a))[0] ?? null;
  if (signed.length < items.length || !newest) {
    await logError(new Error(`A card subscription carries added features BuPulse cannot match (${items.length - signed.length} unsigned, ${newest ? "offer found" : "no open or paid offer on this plan"}). Check them in Paddle and refund or remove what is not switched on.`), {
      source: "billing.card_addons",
      level: "error",
      userId,
      subscriptionId: sub.providerSubscriptionId,
      items: items.map((i) => i.priceId).join(","),
    });
  }
  if (!newest?.customPlanKey) return null;
  return { planKey: newest.customPlanKey, settle: newest.status === "accepted" ? newest : null };
}

export type CardPlanAddons = {
  /** What the added features add per period, in US cents (every one on the card plan). */
  usdCents: number;
  /** Their names, for Billing and the plan-change warning. */
  labels: string[];
  cardPlan: OfferCardPlan;
};

/**
 * The added features of a card plan that is on a custom plan made by "Add features" (the paid offer that made that
 * plan): what they add per period and their names. Null for any other plan.
 */
export async function cardPlanAddons(businessId: string, planKey: string): Promise<CardPlanAddons | null> {
  if (!planKey.startsWith("CUSTOM-")) return null;
  const offer = await prisma.planOffer.findFirst({ where: { businessId, customPlanKey: planKey, status: "paid" }, orderBy: { createdAt: "desc" } });
  const cardPlan = offer ? readCardPlan(offer.options) : null;
  if (!offer || !cardPlan) return null;
  const [plan, base] = await Promise.all([getPlan(planKey), getPlan(cardPlan.basePlanKey)]);
  const baseFeatures = new Set<string>(base?.features ?? []);
  const labels = (plan?.features ?? []).filter((k) => !baseFeatures.has(k) && isFeatureKey(k)).map(featureLabel);
  return { usdCents: cardPlan.addonsUsdCents, labels, cardPlan };
}

/** An add-features charge to a card plan that is still waiting for the card provider's confirmation (Billing says so). */
export async function pendingCardAddition(businessId: string): Promise<{ labels: string[]; since: Date } | null> {
  const offer = await prisma.planOffer.findFirst({ where: { businessId, status: "accepted" }, orderBy: { createdAt: "desc" } });
  const cardPlan = offer ? readCardPlan(offer.options) : null;
  if (!offer || !cardPlan) return null;
  return { labels: cardPlan.items.map((i) => i.label), since: new Date(cardPlan.at || offer.createdAt) };
}
