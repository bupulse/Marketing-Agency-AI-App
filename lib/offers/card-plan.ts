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
import { featureLabel, featureOf, isFeatureKey } from "@/lib/features";
import { clearPlanCache, getPlan, priceCents } from "@/lib/plan-catalog";
import { planForAnyPriceId } from "@/lib/region-prices";
import { isRemoval, signedAddons } from "./card-plan-items";
import { additionContext, createCustomPlanInTx, OfferError, pricingContext, selfServeQuote, startFeatureAddition } from "./service";
import { additionDaysLeft, CARD_ADDON_KIND, cardAddonMessage, cardAdditionQuote, customPlanKeyFor, periodDaysEnding, prorateMinor, quoteAddition, readCardPlan, validUntilOf, type CardAdditionQuote, type CardAddonItem, type OfferCardPlan } from "./shared";

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
const CARD_CHANGE_UNAVAILABLE = `Changing the features of your card plan is not available right now. Write to us at ${site.email} and we will do it for you.`;

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
 * An earlier change of the card plan whose answer never came back: held for a minute (it may still be going through),
 * then settled from the subscription as Paddle has it (applying it settles the change when the items say so; the client
 * is told) or withdrawn. Never sent to Paddle twice.
 */
async function settleEarlier(adapter: ReturnType<typeof billingAdapter>, businessId: string, subscriptionId: string, now: Date) {
  const open = await prisma.planOffer.findFirst({ where: { businessId, status: "accepted" }, orderBy: { createdAt: "desc" } });
  const openCard = open ? readCardPlan(open.options) : null;
  if (!open || !openCard) return;
  if (now.getTime() - new Date(openCard.at).getTime() < IN_FLIGHT_MS) throw new OfferError("Your earlier change is still going through. Reload Billing in a moment.");
  if (adapter.getSubscription) await applyProviderSubscription("PADDLE", await adapter.getSubscription(subscriptionId));
  clearPlanCache();
  const after = await prisma.planOffer.findUnique({ where: { id: open.id }, select: { status: true } });
  if (after?.status === "paid") {
    const removal = isRemoval(open.options);
    const labels = (removal ? openCard.removed : openCard.items).map((i) => i.label);
    throw new OfferError(`Your earlier change went through: ${labels.join(", ")} ${labels.length === 1 ? "is" : "are"} ${removal ? "off" : "on"}. Reload Billing to see it.`);
  }
  await withdrawUnconfirmed(open, "The card provider never confirmed this change, so it was not made.", now);
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

  await settleEarlier(adapter, input.businessId, subscriptionId, now);
  // The card plan as Paddle has it: the added features already on it (signed by BuPulse) and what they cost.
  const live = adapter.getSubscription ? await adapter.getSubscription(subscriptionId) : null;
  const before = live ? await signedAddons(input.userId, live.addons ?? []) : [];

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

  const accepted = await startFeatureAddition({ userId: input.userId, actorId: input.actorId, businessId: input.businessId, features: input.features, method: "card", ip: input.ip }, now, { cardPlan: true });
  const row = await prisma.planOffer.findUnique({ where: { id: accepted.offer.id } });
  if (!row || row.status !== "accepted" || !row.customPlanKey) throw new OfferError("Your choice changed a moment ago. Reload Billing and try again.");
  const keys = [...new Set([...before.map((i) => i.key), ...quote.items.map((i) => i.key)])];
  const cardPlan: OfferCardPlan = { subscriptionId, basePlanKey: base.plan, interval: ac.ctx.interval, items: quote.items, removed: [], keys, addedUsdCents: quote.perPeriodUsdCents, addonsUsdCents: before.reduce((sum, i) => sum + (i.amountCents ?? 0), 0) + quote.perPeriodUsdCents, dueNowUsdCents: quote.dueNowUsdCents, ...rate, at: now.toISOString() };
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

/**
 * Billing's "Remove" next to a feature added to a card plan, once the client confirmed (docs/OFFERS.md, "Removing a
 * feature from a card plan"). Recorded as a removal (a PlanOffer with options.mode "removal", nothing to pay), with the
 * custom plan of the features left (none left: the plan's own); then the item comes off the card subscription, every
 * other item kept, and Paddle credits its unused days. The feature switches off only when Paddle confirms: its answer
 * here or the webhook, through applyProviderSubscription like every change. Another added feature that needs it stops
 * the removal (remove that one first).
 */
export async function removeFeatureFromCardPlan(input: { userId: string; actorId: string; businessId: string; feature: string; ip?: string | null }, now: Date = new Date()): Promise<{ applied: boolean; removed: string; creditUsdCents: number }> {
  const sub = await prisma.subscription.findUnique({ where: { userId: input.userId } });
  if (!sub || sub.provider !== "PADDLE" || !sub.providerSubscriptionId || sub.plan === "TRIAL") throw new OfferError("Your plan is not paid by card, so there is nothing to remove here.");
  if (sub.status === "PAST_DUE") throw new OfferError("Your last card payment did not go through. Update your payment method above first.");
  if (sub.status !== "ACTIVE" || !sub.currentPeriodEnd) throw new OfferError("Your plan is not running, so there is nothing to remove.");
  if (sub.cancelAtPeriodEnd) throw new OfferError(`Your plan is set to end on ${sub.currentPeriodEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kigali" })}: the features you added end with it.`);
  const subscriptionId = sub.providerSubscriptionId;
  const adapter = billingAdapter("PADDLE");
  if (!adapter.removeRecurringItems || !adapter.getSubscription || !(await cardPlanAdditionsReady())) throw new OfferError(CARD_CHANGE_UNAVAILABLE);

  await settleEarlier(adapter, input.businessId, subscriptionId, now);
  const live = await adapter.getSubscription(subscriptionId);
  const items = await signedAddons(input.userId, live.addons ?? []);
  const target = items.filter((i) => i.key === input.feature);
  if (target.length === 0) {
    await applyProviderSubscription("PADDLE", live);
    clearPlanCache();
    throw new OfferError("That feature is not on your card plan any more. Reload Billing.");
  }
  const remaining = [...new Set(items.filter((i) => i.key !== input.feature).map((i) => i.key))];
  const needs = remaining.filter((k) => isFeatureKey(k) && featureOf(k).requires.includes(input.feature as never));
  const label = isFeatureKey(input.feature) ? featureLabel(input.feature) : input.feature;
  if (needs.length > 0) throw new OfferError(`${needs.map((k) => featureLabel(k as never)).join(" and ")} ${needs.length === 1 ? "needs" : "need"} ${label}: remove ${needs.length === 1 ? "it" : "them"} first.`);

  const base = await planForAnyPriceId("PADDLE", live.providerPriceId);
  const basePlan = base ? await getPlan(base.plan) : null;
  if (!base || !basePlan) {
    await logError(new Error(`The card plan's price ${live.providerPriceId} is not one of our plans: a feature cannot be removed from it`), { source: "billing.card_addons", level: "error", userId: input.userId, subscriptionId });
    throw new OfferError(CARD_CHANGE_UNAVAILABLE);
  }
  // The plan left: the plan's own plus the features left, at today's regional prices (what a Mobile Money renewal of it
  // would cost), with the limits those features include.
  const pc = await pricingContext(input.businessId);
  const regional = pc.bases.find((b) => b.key === basePlan.key);
  const priceMinor = regional ? (sub.interval === "YEAR" ? regional.yearlyMinor : regional.monthlyMinor) : basePlan.currency.toUpperCase() === pc.region.currency.toUpperCase() ? priceCents(basePlan, sub.interval) : 0;
  const left = quoteAddition({ current: { key: basePlan.key, name: basePlan.name, priceMinor, features: basePlan.features, limits: basePlan.limits }, features: remaining, interval: sub.interval, currency: pc.region.currency, regionKey: pc.region.key, prices: pc.prices, periodEnd: sub.currentPeriodEnd, now });
  const removedItems: CardAddonItem[] = target.map((i) => ({ key: i.key, label, usdCents: i.amountCents ?? 0 }));
  const removedUsd = removedItems.reduce((sum, i) => sum + i.usdCents, 0);
  const creditUsdCents = prorateMinor(removedUsd, additionDaysLeft(sub.currentPeriodEnd, now), periodDaysEnding(sub.currentPeriodEnd, sub.interval));
  const rate = await cardRate();
  const cardPlan: OfferCardPlan = { subscriptionId, basePlanKey: basePlan.key, interval: sub.interval, items: [], removed: removedItems, keys: remaining, addedUsdCents: 0, addonsUsdCents: items.filter((i) => i.key !== input.feature).reduce((sum, i) => sum + (i.amountCents ?? 0), 0), dueNowUsdCents: 0, ...rate, at: now.toISOString() };
  const ctx: AdminContext = { actor: `client:${input.actorId}`, ip: input.ip ?? null, viaApi: false };
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { name: true } });

  let row: Prisma.PlanOfferGetPayload<object>;
  try {
    row = await prisma.$transaction(async (tx) => {
      const created = await tx.planOffer.create({
        data: {
          businessId: input.businessId,
          status: "accepted",
          sentAt: now,
          acceptedAt: now,
          validUntil: validUntilOf(now, 1),
          payMethod: "card",
          basePlanKey: basePlan.key,
          featureKeys: (remaining.length > 0 ? left.features : basePlan.features) as Prisma.InputJsonValue,
          limits: (remaining.length > 0 ? left.limits : basePlan.limits) as unknown as Prisma.InputJsonValue,
          options: { mode: "removal", added: [], removed: [input.feature], basePlanName: basePlan.name, cardPlan } as unknown as Prisma.InputJsonValue,
          currency: pc.region.currency,
          interval: sub.interval,
          lines: [] as Prisma.InputJsonValue,
          computedMinor: 0,
          adjustedMinor: 0,
          createdBy: ctx.actor,
        },
      });
      if (remaining.length === 0) return created;
      const planKey = customPlanKeyFor(created.id);
      const prices = sub.interval === "YEAR" ? { monthlyPriceCents: Math.ceil(left.nextRenewalMinor / 10), yearlyPriceCents: left.nextRenewalMinor } : { monthlyPriceCents: left.nextRenewalMinor, yearlyPriceCents: left.nextRenewalMinor * 10 };
      await createCustomPlanInTx(tx, { planKey, businessId: input.businessId, businessName: business?.name ?? null, basePlanKey: basePlan.key, currency: pc.region.currency, prices, limits: left.limits, features: left.features, lines: left.lines });
      return tx.planOffer.update({ where: { id: created.id }, data: { customPlanKey: planKey } });
    });
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") throw new OfferError("There is an offer open on your account (above): answer it before changing your card plan.");
    throw error;
  }
  clearPlanCache();
  await writeAudit(prisma, ctx, "card_plan_remove_feature", `offer:${row.id}`, null, { subscriptionId, removed: removedItems, keys: remaining, plan: row.customPlanKey ?? basePlan.key, creditUsdCents });

  let updated: ProviderSubscription;
  try {
    updated = await adapter.removeRecurringItems(subscriptionId, target.map((i) => i.priceId));
  } catch (error) {
    if (uncertain(error)) {
      await logError(error, { source: "billing.card_addons", level: "warn", userId: input.userId, offerId: row.id, subscriptionId });
      throw new OfferError(`We could not hear back from the card provider. If the change went through, ${label} switches off in a few minutes. Reload Billing in a moment.`);
    }
    await withdrawUnconfirmed(row, "The card provider did not accept this change, so nothing was removed.", now);
    await logError(error, { source: "billing.card_addons", level: /^Paddle API (401|403) /.test(error instanceof Error ? error.message : "") ? "error" : "warn", userId: input.userId, offerId: row.id, subscriptionId });
    throw new OfferError(/^Paddle API (401|403) /.test(error instanceof Error ? error.message : "") ? CARD_CHANGE_UNAVAILABLE : `The card provider did not accept the change, so nothing was removed. Please try again in a moment, or write to us at ${site.email}.`);
  }
  await applyProviderSubscription("PADDLE", updated);
  clearPlanCache();
  const after = await prisma.planOffer.findUnique({ where: { id: row.id }, select: { status: true } });
  return { applied: after?.status === "paid", removed: label, creditUsdCents };
}
