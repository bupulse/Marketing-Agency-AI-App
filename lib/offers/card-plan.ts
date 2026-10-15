import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/types";
import { getSettings } from "@/lib/admin/settings";
import { billingAdapter } from "@/lib/billing";
import { applyProviderSubscription } from "@/lib/billing/apply";
import { cardCheckoutConfigured } from "@/lib/billing/card-ready";
import { signCheckoutUser } from "@/lib/billing/signing";
import type { ProviderSubscription } from "@/lib/billing/types";
import { site } from "@/lib/content/site";
import { clearPlanCache } from "@/lib/plan-catalog";
import { planForAnyPriceId } from "@/lib/region-prices";
import { cardPlanAddons } from "./card-plan-items";
import { additionContext, OfferError, selfServeQuote, startFeatureAddition } from "./service";
import { CARD_ADDON_KIND, cardAddonMessage, cardAdditionQuote, readCardPlan, type CardAdditionQuote, type OfferCardPlan } from "./shared";

// Adding features to a card plan (docs/OFFERS.md, "Adding features to a card plan"). A card plan is a Paddle
// subscription that renews by itself, so the added features become recurring items on it: one price per feature that
// exists only on that subscription (in US dollars, the card rule of plans on the feature's regional price), charged now
// prorated by Paddle and with every renewal after. The add-features offer and its custom plan are the same as Mobile
// Money's (lib/offers/service.ts); the subscription event that carries the new items (Paddle's answer to the change, then
// its subscription.updated webhook, lib/billing/apply.ts) switches the custom plan on and settles the offer. Nothing is
// ever switched on from the browser, and nothing changes when the card payment fails (prevent_change).

/** A refusal the client can read; `requoteUsdCents` is a new card price per period to confirm. */
export class CardPlanError extends OfferError {
  constructor(message: string, public requoteUsdCents: number | null = null) {
    super(message);
    this.name = "CardPlanError";
  }
}

/** The last resort, when the card provider cannot take the change from here. */
export const CARD_PLAN_UNAVAILABLE = `Adding features by card is not available right now. Write to us at ${site.email} and we will add them to your plan for you.`;

const SYSTEM: AdminContext = { actor: "system:offers", ip: null, viaApi: false };
const IN_FLIGHT_MS = 60_000;
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** Card is set up and switched on, and the provider can add recurring items to a subscription. */
export async function cardPlanAdditionsReady(): Promise<boolean> {
  if (!(await cardCheckoutConfigured())) return false;
  try {
    return typeof billingAdapter("PADDLE").addRecurringItems === "function";
  } catch {
    return false;
  }
}

/** Today's card rule (Admin -> Settings): the USD->RWF rate and the card margin. */
export async function cardRate(): Promise<{ usdToRwf: number; marginPercent: number }> {
  const s = await getSettings();
  return { usdToRwf: s.usdToRwf, marginPercent: s.cardMarginPercent };
}

/** A network failure, a timeout or a 5xx: Paddle may have made the change. Anything else is a definite answer. */
function uncertain(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  return error instanceof Error && /^Paddle API (5\d\d|408) /.test(error.message);
}

/** Paddle's refusal in the client's words (it never charged anything: prevent_change). */
function refusal(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/^Paddle API (401|403) /.test(message) || /not configured/i.test(message)) return CARD_PLAN_UNAVAILABLE;
  if (/payment|declin|insufficient/i.test(message)) return "Your card was declined, so nothing was added or charged. Update your card with Payment method above, then try again.";
  return `The card provider did not accept the change, so nothing was added or charged. Please try again in a moment, or write to us at ${site.email}.`;
}

/** The client's own add-features offer that never reached the card plan: withdrawn, its prepared plan retired. */
async function withdrawUnconfirmed(offer: Pick<Prisma.PlanOfferGetPayload<object>, "id" | "customPlanKey">, reason: string, now: Date) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.planOffer.updateMany({ where: { id: offer.id, status: "accepted" }, data: { status: "withdrawn", withdrawnAt: now, withdrawReason: reason } });
    if (count !== 1) return;
    if (offer.customPlanKey) await tx.planDefinition.updateMany({ where: { key: offer.customPlanKey, isCustom: true, status: { not: "retired" } }, data: { status: "retired" } });
    await writeAudit(tx, SYSTEM, "withdraw_offer", `offer:${offer.id}`, { status: "accepted" }, { status: "withdrawn", reason: "card_plan_not_confirmed" });
  });
  clearPlanCache();
}

/**
 * Billing's "Add to my card plan", once the client confirmed the card price they saw (`expectedUsdCents`, per period: a
 * different price today is returned to confirm, never charged). Prices the ticked features like Mobile Money's "Add
 * features", makes and accepts the add-features offer (its custom plan: the plan plus the features, at the regional
 * price), then adds one recurring item per feature to the card subscription, charged now prorated. Paddle's answer is
 * applied like its webhook (lib/billing/apply.ts): the features switch on and the offer is paid. `applied` is false when
 * that answer did not carry the items yet (the webhook then switches them on).
 */
export async function addFeaturesByCard(input: { userId: string; actorId: string; businessId: string; features: unknown; expectedUsdCents?: number | null; ip?: string | null }, now: Date = new Date()): Promise<{ applied: boolean; added: string[]; quote: CardAdditionQuote }> {
  const sub = await prisma.subscription.findUnique({ where: { userId: input.userId } });
  if (!sub || sub.provider !== "PADDLE" || !sub.providerSubscriptionId) throw new OfferError("Your plan is not paid by card. Choose how to pay for the features below.");
  const subscriptionId = sub.providerSubscriptionId;
  const adapter = billingAdapter("PADDLE");
  if (!adapter.addRecurringItems || !(await cardPlanAdditionsReady())) throw new OfferError(CARD_PLAN_UNAVAILABLE);

  // An earlier "Add to my card plan" whose answer never came back: settled from the subscription as Paddle has it (its
  // items are there), or withdrawn (they are not). Never added twice.
  const open = await prisma.planOffer.findFirst({ where: { businessId: input.businessId, status: "accepted" }, orderBy: { createdAt: "desc" } });
  const openCard = open ? readCardPlan(open.options) : null;
  if (open && openCard) {
    if (now.getTime() - new Date(openCard.at).getTime() < IN_FLIGHT_MS) throw new OfferError("Your earlier change is still going through. Reload Billing in a moment.");
    const current = adapter.getSubscription ? await adapter.getSubscription(subscriptionId) : null;
    if (current?.addons?.some((a) => a.offerId === open.id)) {
      await applyProviderSubscription("PADDLE", current);
      clearPlanCache();
      throw new OfferError(`Your earlier change went through: ${openCard.items.map((i) => i.label).join(", ")} ${openCard.items.length === 1 ? "is" : "are"} on. Reload Billing to see it.`);
    }
    await withdrawUnconfirmed(open, "The card provider never confirmed these features, so they were not added.", now);
  }

  const ac = await additionContext(input.businessId, now);
  if (!ac.ok) throw new OfferError(ac.reason);
  if (ac.ctx.method !== "card") throw new OfferError("Your plan is paid by Mobile Money: choose how to pay for the features.");
  const base = sub.providerPriceId ? await planForAnyPriceId("PADDLE", sub.providerPriceId) : null;
  if (!base) {
    await logError(new Error(`The card plan's price ${sub.providerPriceId ?? "(none)"} is not one of our plans: features cannot be added to it`), { source: "billing.card_addons", level: "error", userId: input.userId, subscriptionId });
    throw new OfferError(CARD_PLAN_UNAVAILABLE);
  }
  const priced = selfServeQuote(ac.ctx, input.features, now);
  const rate = await cardRate();
  const quote = cardAdditionQuote({ lines: priced.quote.lines, currency: ac.ctx.region.currency, ...rate, interval: ac.ctx.interval, periodEnd: ac.ctx.periodEnd, now });
  if (quote.items.length === 0) throw new OfferError("These features have no card price yet. Use Request a custom change and we will price them for you.");
  if (input.expectedUsdCents != null && input.expectedUsdCents !== quote.perPeriodUsdCents) {
    throw new CardPlanError(`The card price is now ${usd(quote.perPeriodUsdCents)} a ${ac.ctx.interval === "YEAR" ? "year" : "month"} (today's rate). Check it and confirm again.`, quote.perPeriodUsdCents);
  }
  const earlier = await cardPlanAddons(input.businessId, sub.plan);

  const accepted = await startFeatureAddition({ userId: input.userId, actorId: input.actorId, businessId: input.businessId, features: input.features, method: "card", ip: input.ip }, now, { cardPlan: true });
  const row = await prisma.planOffer.findUnique({ where: { id: accepted.offer.id } });
  if (!row || row.status !== "accepted" || !row.customPlanKey) throw new OfferError("Your choice changed a moment ago. Reload Billing and try again.");
  const cardPlan: OfferCardPlan = { subscriptionId, basePlanKey: base.plan, interval: ac.ctx.interval, items: quote.items, addedUsdCents: quote.perPeriodUsdCents, addonsUsdCents: (earlier?.usdCents ?? 0) + quote.perPeriodUsdCents, dueNowUsdCents: quote.dueNowUsdCents, ...rate, at: now.toISOString() };
  await prisma.planOffer.updateMany({ where: { id: row.id, status: "accepted" }, data: { options: { ...((row.options ?? {}) as Record<string, unknown>), cardPlan } as Prisma.InputJsonValue } });
  await writeAudit(prisma, { actor: `client:${input.actorId}`, ip: input.ip ?? null, viaApi: false }, "card_plan_addition", `offer:${row.id}`, null, { subscriptionId, items: quote.items, perPeriodUsdCents: quote.perPeriodUsdCents, dueNowUsdCents: quote.dueNowUsdCents, interval: ac.ctx.interval, ...rate });

  const sig = await signCheckoutUser(cardAddonMessage(row.id, input.userId));
  let updated: ProviderSubscription;
  try {
    updated = await adapter.addRecurringItems(
      subscriptionId,
      quote.items.map((i) => ({ name: `BuPulse ${i.label}`, description: `${i.label}, added to your BuPulse plan`, amountCents: i.usdCents, currency: "USD", interval: ac.ctx.interval, customData: { kind: CARD_ADDON_KIND, key: i.key, offerId: row.id, userId: input.userId, sig } })),
    );
  } catch (error) {
    if (uncertain(error)) {
      // Paddle may have made the change: the offer stays open for its webhook (or the next try settles it).
      await logError(error, { source: "billing.card_addons", level: "warn", userId: input.userId, offerId: row.id, subscriptionId });
      throw new OfferError("We could not hear back from the card provider. If the payment went through, your features switch on in a few minutes; nothing is charged twice. Reload Billing in a moment.");
    }
    await withdrawUnconfirmed(row, "The card payment for these features did not go through, so nothing was added or charged.", now);
    await logError(error, { source: "billing.card_addons", level: /^Paddle API (401|403) /.test(error instanceof Error ? error.message : "") ? "error" : "warn", userId: input.userId, offerId: row.id, subscriptionId });
    throw new OfferError(refusal(error));
  }
  await applyProviderSubscription("PADDLE", updated);
  clearPlanCache();
  const after = await prisma.planOffer.findUnique({ where: { id: row.id }, select: { status: true } });
  return { applied: after?.status === "paid", added: quote.items.map((i) => i.label), quote };
}
