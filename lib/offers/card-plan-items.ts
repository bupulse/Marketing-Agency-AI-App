import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/types";
import { verifyCheckoutUser } from "@/lib/billing/signing";
import type { ProviderAddonItem, ProviderSubscription } from "@/lib/billing/types";
import { getPlan } from "@/lib/plan-catalog";
import { featureLabel, isFeatureKey } from "@/lib/features";
import { markOfferPaidInTx } from "./activate";
import { cardAddonMessage, readCardPlan, sameKeys, type CardAddonItem, type OfferCardPlan } from "./shared";

// Features added to a card plan (docs/OFFERS.md, "Adding features to a card plan"): each is a recurring item on the
// client's card subscription, marked and signed in its price's custom data with the add-features offer that made it.
// Every change (adding, removing) is a PlanOffer that records the add-ons the card plan has once it is on. This is the
// side the subscription events use (lib/billing/apply.ts), and the reads Billing shows. It never calls the card
// provider. Kept apart from lib/offers/card-plan.ts (the client's flow), which imports the offer service.

type OfferRow = Prisma.PlanOfferGetPayload<object>;
type Tx = Prisma.TransactionClient;

const SYSTEM: AdminContext = { actor: "system:paddle", ip: null, viaApi: false };

/** A removal of a feature from a card plan (options.mode "removal"): nothing is paid; its plan is what is left. */
export const isRemoval = (options: unknown) => Boolean(options && typeof options === "object" && (options as { mode?: unknown }).mode === "removal");

/**
 * The add-on keys a card plan change leaves on the plan: recorded since removals exist; for the first add-features
 * offers, their custom plan's features beyond the base plan's.
 */
async function keysOf(offer: OfferRow, cardPlan: OfferCardPlan): Promise<string[]> {
  if (cardPlan.keys) return cardPlan.keys;
  const [plan, base] = await Promise.all([offer.customPlanKey ? getPlan(offer.customPlanKey) : null, getPlan(cardPlan.basePlanKey)]);
  const own = new Set<string>(base?.features ?? []);
  return (plan?.features ?? []).filter((k) => !own.has(k));
}

/** The added-feature items signed by BuPulse for this client; any other item is never trusted. */
export async function signedAddons(userId: string, items: readonly ProviderAddonItem[]): Promise<(ProviderAddonItem & { key: string; offerId: string })[]> {
  const out: (ProviderAddonItem & { key: string; offerId: string })[] = [];
  for (const item of items) {
    const { key, offerId } = item;
    if (key && offerId && item.userId === userId && (await verifyCheckoutUser(cardAddonMessage(offerId, userId), item.sig))) out.push({ ...item, key, offerId });
  }
  return out;
}

/**
 * The plan a card subscription is on, given its items: the change (add-features offer or removal) whose add-on keys are
 * exactly the signed added-feature items the subscription carries, the one waiting for this confirmation first, else
 * the latest. Its custom plan (or the plan's own, after the last feature was removed), and that change when it waits for
 * this confirmation (settle it now). Only items signed by BuPulse for this client count, so nothing is ever switched on
 * that the card is not paying for. Null when there is nothing to do: no items and no change waiting (the plan's own
 * features apply). Items that match no change are logged for the owner (the client is paying for them).
 */
export async function cardAddonPlan(userId: string, sub: Pick<ProviderSubscription, "providerSubscriptionId" | "addons">, basePlanKey: string): Promise<{ planKey: string | null; settle: OfferRow | null } | null> {
  const items = sub.addons ?? [];
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  if (!business) return null;
  const rows = await prisma.planOffer.findMany({ where: { businessId: business.id, status: { in: ["accepted", "paid"] } } });
  const changes = rows.flatMap((o) => {
    const cardPlan = readCardPlan(o.options);
    return cardPlan && cardPlan.basePlanKey === basePlanKey && cardPlan.subscriptionId === sub.providerSubscriptionId ? [{ offer: o, cardPlan }] : [];
  });
  if (items.length === 0 && !changes.some((c) => c.offer.status === "accepted")) return null;

  const present = (await signedAddons(userId, items)).map((i) => i.key);
  const unsigned = items.length - present.length;
  // Waiting for this confirmation first (a company has one open change at a time), then the latest.
  const rank = (o: OfferRow) => (o.status === "accepted" ? Number.MAX_SAFE_INTEGER : (o.paidAt ?? o.createdAt).getTime());
  const keyed = await Promise.all(changes.map(async (c) => ({ ...c, keys: await keysOf(c.offer, c.cardPlan) })));
  const exact = keyed.filter((c) => sameKeys(c.keys, present)).sort((a, b) => rank(b.offer) - rank(a.offer))[0] ?? null;
  // Nothing matches (items changed in Paddle by hand): the latest change whose features are all still paid for.
  const fallback = exact ? null : (keyed.filter((c) => c.keys.length > 0 && c.keys.every((k) => present.includes(k)) && c.offer.status === "paid").sort((a, b) => rank(b.offer) - rank(a.offer))[0] ?? null);
  if (unsigned > 0 || (!exact && present.length > 0)) {
    await logError(new Error(`A card subscription carries added features BuPulse cannot match exactly (${unsigned} unsigned; signed: ${present.join(", ") || "none"}). Check them in Paddle and refund or remove what is not switched on.`), {
      source: "billing.card_addons",
      level: "error",
      userId,
      subscriptionId: sub.providerSubscriptionId,
      items: items.map((i) => i.priceId).join(","),
    });
  }
  const pick = exact ?? fallback;
  if (!pick) return present.length > 0 ? null : { planKey: null, settle: null };
  return { planKey: pick.keys.length > 0 ? pick.offer.customPlanKey : null, settle: exact && pick.offer.status === "accepted" ? pick.offer : null };
}

/**
 * Settles a card plan change in the write that puts the subscription on its plan: an add-features offer is paid like
 * any offer (`markOfferPaidInTx`); a removal is only marked done (`paid`, nothing charged). Once: a change already
 * settled stops the transaction (the caller writes the plan without settling).
 */
export async function settleCardPlanChangeInTx(tx: Tx, offer: OfferRow, subscriptionId: string, now: Date) {
  const fresh = await tx.planOffer.findUnique({ where: { id: offer.id }, select: { status: true } });
  if (fresh?.status !== "accepted") return;
  const paidBy = `card:${subscriptionId}`;
  if (!isRemoval(offer.options)) {
    await markOfferPaidInTx(tx, SYSTEM, { offer, paymentId: subscriptionId, invoiceId: null, planKey: offer.customPlanKey as string, amountMinor: offer.adjustedMinor, currency: offer.currency, paidBy }, now);
    return;
  }
  const { count } = await tx.planOffer.updateMany({ where: { id: offer.id, status: "accepted" }, data: { status: "paid", paidAt: now, paidBy } });
  if (count !== 1) return;
  const cardPlan = readCardPlan(offer.options);
  await writeAudit(tx, SYSTEM, "card_plan_feature_removed", `offer:${offer.id}`, { status: "accepted" }, { status: "paid", paidBy, removed: cardPlan?.removed.map((r) => r.key) ?? [], keys: cardPlan?.keys ?? [], plan: offer.customPlanKey ?? cardPlan?.basePlanKey ?? null });
}

export type CardPlanFeature = CardAddonItem;

export type CardPlanAddons = {
  /** What the added features add per period, in US cents (every one on the card plan). */
  usdCents: number;
  /** Their names, for Billing and the plan-change warning. */
  labels: string[];
  /** Each added feature with its card price per period (Billing lists them, each with Remove). */
  features: CardPlanFeature[];
  cardPlan: OfferCardPlan;
};

/**
 * The added features of a card plan that is on a custom plan made by "Add features" (the change that made that plan):
 * each with its card price per period (from the item that added it), what they add together and their names. Null for
 * any other plan.
 */
export async function cardPlanAddons(businessId: string, planKey: string): Promise<CardPlanAddons | null> {
  if (!planKey.startsWith("CUSTOM-")) return null;
  const offers = await prisma.planOffer.findMany({ where: { businessId, status: "paid" }, orderBy: { createdAt: "desc" } });
  const offer = offers.find((o) => o.customPlanKey === planKey && readCardPlan(o.options));
  const cardPlan = offer ? readCardPlan(offer.options) : null;
  if (!offer || !cardPlan) return null;
  const keys = await keysOf(offer, cardPlan);
  // Each feature's price: the newest item that added it (offers come newest first).
  const price = new Map<string, number>();
  for (const o of offers) for (const item of readCardPlan(o.options)?.items ?? []) if (!price.has(item.key)) price.set(item.key, item.usdCents);
  const features = keys.map((key) => ({ key, label: isFeatureKey(key) ? featureLabel(key) : key, usdCents: price.get(key) ?? 0 }));
  return { usdCents: cardPlan.addonsUsdCents, labels: features.map((f) => f.label), features, cardPlan };
}

/** A change to a card plan still waiting for the card provider's confirmation (Billing says so). */
export async function pendingCardAddition(businessId: string): Promise<{ labels: string[]; removal: boolean; since: Date } | null> {
  const offer = await prisma.planOffer.findFirst({ where: { businessId, status: "accepted" }, orderBy: { createdAt: "desc" } });
  const cardPlan = offer ? readCardPlan(offer.options) : null;
  if (!offer || !cardPlan) return null;
  const removal = isRemoval(offer.options);
  return { labels: (removal ? cardPlan.removed : cardPlan.items).map((i) => i.label), removal, since: new Date(cardPlan.at || offer.createdAt) };
}
