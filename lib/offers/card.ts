import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/types";
import { getSettings } from "@/lib/admin/settings";
import { trackEvent } from "@/lib/analytics/events";
import { subscriptionEventsFor } from "@/lib/analytics/math";
import { siteUrl } from "@/lib/auth/site-url";
import { activeProvider, billingAdapter } from "@/lib/billing";
import { cardCheckoutConfigured } from "@/lib/billing/card-ready";
import { sendPlanActiveEmail } from "@/lib/billing/momo-emails";
import { planManualPeriod } from "@/lib/billing/momo-shared";
import { getPaddleConfig } from "@/lib/billing/paddle-config";
import { signCheckoutUser, verifyCheckoutUser } from "@/lib/billing/signing";
import type { CheckoutConfig } from "@/lib/billing/types";
import { clearPlanCache, getPlan, getPlans } from "@/lib/plan-catalog";
import { markOfferPaidInTx, withdrawStaleAddition } from "./activate";
import { additionFits, offerCardQuote, readAddition, type OfferCardQuote } from "./shared";

// Card payment of a custom plan offer or of added features (docs/OFFERS.md, "Card"). The offer's price (RWF in Rwanda)
// is converted with the card rule of RWF plans (Settings rate + card margin, whole dollars up), the server opens a
// one-off Paddle transaction for that exact amount (a non-catalog price; the browser cannot change it), and the
// transaction.completed webhook switches the offer on, exactly like a confirmed Mobile Money payment of it: offer paid,
// custom plan on (added features keep the period end), other open payments of the offer closed, invoice voided.
// Never trusted from the browser: the amount, the currency, the offer and the user come signed in the transaction's
// custom data, and are checked against the offer and the paid totals.

/** The client-facing message of the card functions (safe to show); `requote` carries a new card amount. */
export class CardOfferError extends Error {
  constructor(message: string, public requote: OfferCardQuote | null = null) {
    super(message);
    this.name = "CardOfferError";
  }
}

const LIVE = new Set(["ACTIVE", "PAST_DUE", "TRIALING"]);
const SYSTEM: AdminContext = { actor: "system:paddle", ip: null, viaApi: false };
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** The signed part of the transaction's custom data: what the webhook will check. */
const quoteMessage = (q: { offerId: string; userId: string; usdCents: number; quoteMinor: number; quoteCurrency: string }) => `offer:${q.offerId}:${q.userId}:${q.usdCents}:${q.quoteMinor}:${q.quoteCurrency}`;

/** Whether card can pay an offer for this company now: the region takes card and Paddle is set up, on and able to charge an amount. */
export async function offerCardReady(regionMethods: readonly string[]): Promise<boolean> {
  if (!regionMethods.includes("card")) return false;
  if (!(await cardCheckoutConfigured())) return false;
  try {
    return typeof billingAdapter(activeProvider()).createOneOffTransaction === "function";
  } catch {
    return false;
  }
}

/** The card amount of an offer price, with today's rate and margin (Settings). */
export async function cardQuoteOf(minor: number, currency: string): Promise<OfferCardQuote> {
  const s = await getSettings();
  return offerCardQuote(minor, currency, s.usdToRwf, s.cardMarginPercent);
}

/**
 * Opens the card checkout of the company's accepted offer (or added features): checks it can still be paid, quotes it
 * again (a client who saw another amount gets the new one to confirm: `requote`), and creates the one-off Paddle
 * transaction with the signed quote. Returns what the browser needs to open it.
 */
export async function startOfferCardCheckout(input: { userId: string; email: string; businessId: string; offerId: string; expectedUsdCents?: number | null }, now: Date = new Date()): Promise<CheckoutConfig & { quote: OfferCardQuote }> {
  const [offer, sub, business] = await Promise.all([
    prisma.planOffer.findFirst({ where: { id: input.offerId, businessId: input.businessId } }),
    prisma.subscription.findUnique({ where: { userId: input.userId } }),
    prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true } }),
  ]);
  if (!offer || !business) throw new CardOfferError("We could not find that offer. Open Billing again.");
  if (offer.status === "paid") throw new CardOfferError("This is already paid.");
  if (offer.status !== "accepted" || !offer.customPlanKey) throw new CardOfferError("This offer is no longer open. Ask us for a new one.");
  if (!sub) throw new CardOfferError("Your account is still being set up. Please try again in a moment.");
  if (sub.provider === "PADDLE" && sub.providerSubscriptionId && LIVE.has(sub.status) && sub.plan !== "TRIAL" && !sub.cancelAtPeriodEnd) {
    throw new CardOfferError("Your plan renews by card at the moment, so this cannot be added to it here. Ask us and we will change it for you.");
  }
  const addition = readAddition(offer.options);
  if (addition && !additionFits(addition, sub, offer.interval, now)) {
    await withdrawStaleAddition(offer, now);
    clearPlanCache();
    throw new CardOfferError("Your plan's period changed after these features were priced, so that quote was cancelled. Add them again for a new quote.");
  }
  // One payment at a time: a Mobile Money payment the client already reported stays with the BuPulse team.
  const reported = await prisma.manualPayment.findFirst({ where: { userId: input.userId, status: "pending", submittedAt: { not: null }, OR: [{ offerId: offer.id }, ...(offer.invoiceId ? [{ invoiceId: offer.invoiceId }] : [])] }, select: { reference: true } });
  if (reported) throw new CardOfferError(`You have reported a Mobile Money payment (${reported.reference}) for this. Please wait until we have checked it.`);

  const quote = await cardQuoteOf(offer.adjustedMinor, offer.currency);
  if (input.expectedUsdCents != null && input.expectedUsdCents !== quote.usdCents) {
    throw new CardOfferError(`The card price is now ${usd(quote.usdCents)} (today's rate). Check it and tap Pay by card again.`, quote);
  }
  const adapter = billingAdapter(activeProvider());
  if (!adapter.createOneOffTransaction || !(await cardCheckoutConfigured())) throw new CardOfferError("Card payments are not available right now. Pay by Mobile Money, or try again later.");
  const config = await getPaddleConfig();
  if (!config.clientToken) throw new CardOfferError("Card payments are not available right now. Pay by Mobile Money, or try again later.");

  const signed = { offerId: offer.id, userId: input.userId, usdCents: quote.usdCents, quoteMinor: quote.quoteMinor, quoteCurrency: quote.quoteCurrency };
  const customData = {
    kind: "offer",
    userId: input.userId,
    sig: await signCheckoutUser(input.userId),
    offerId: offer.id,
    usdCents: quote.usdCents,
    quoteMinor: quote.quoteMinor,
    quoteCurrency: quote.quoteCurrency,
    plan: offer.customPlanKey,
    partial: addition ? 1 : 0,
    qsig: await signCheckoutUser(quoteMessage(signed)),
  };
  const name = addition ? "BuPulse: features added to your plan" : "BuPulse custom plan";
  const description = addition
    ? `Added features for the ${addition.daysLeft} days left of the period (${quote.quoteMinor.toLocaleString("en-US")} ${quote.quoteCurrency})`
    : `${offer.interval === "YEAR" ? "One year" : "One month"} of your custom plan (${quote.quoteMinor.toLocaleString("en-US")} ${quote.quoteCurrency})`;
  const { transactionId } = await adapter.createOneOffTransaction({ amountCents: quote.usdCents, currency: "USD", name, description, customData, providerCustomerId: sub.provider === "PADDLE" ? sub.providerCustomerId : null });
  // The latest card quote, for the admin's offer page (the webhook trusts the signed custom data, not this).
  const options = { ...((offer.options ?? {}) as Record<string, unknown>), cardQuote: { ...quote, transactionId, at: now.toISOString() } };
  await prisma.planOffer.updateMany({ where: { id: offer.id, status: "accepted" }, data: { payMethod: "card", options } });
  return {
    provider: "PADDLE",
    environment: config.environment,
    clientToken: config.clientToken,
    priceId: "",
    customerEmail: input.email,
    customerId: sub.provider === "PADDLE" ? sub.providerCustomerId : null,
    customData,
    successUrl: `${siteUrl()}/dashboard/billing?checkout=success&since=${now.getTime()}`,
    transactionId,
    quote,
  };
}

type Txn = { id?: unknown; status?: unknown; custom_data?: Record<string, unknown> | null; currency_code?: unknown; items?: { quantity?: unknown }[]; details?: { totals?: Record<string, unknown> } };
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

/** A transaction.completed of an offer paid by card, read from its signed custom data; null for every other payment. */
export function offerCardPaymentOf(data: unknown): { transactionId: string; offerId: string; userId: string; sig: string; qsig: string; usdCents: number; quoteMinor: number; quoteCurrency: string; paidCents: number | null; paidCurrency: string | null; /** The units bought: always 1 (each item's quantity, summed). */ quantity: number } | null {
  const d = (data ?? {}) as Txn;
  const c = d.custom_data ?? {};
  if (c.kind !== "offer") return null;
  const transactionId = str(d.id);
  const offerId = str(c.offerId);
  const userId = str(c.userId);
  const usdCents = int(c.usdCents);
  const quoteMinor = int(c.quoteMinor);
  const quoteCurrency = str(c.quoteCurrency);
  if (!transactionId || !offerId || !userId || usdCents === null || quoteMinor === null || !quoteCurrency) return null;
  const totals = d.details?.totals ?? {};
  const items = Array.isArray(d.items) ? d.items : [];
  const quantity = items.length === 0 ? 1 : items.reduce((n, item) => n + (int(item?.quantity) ?? 0), 0);
  return {
    quantity, transactionId, offerId, userId, sig: str(c.sig) ?? "", qsig: str(c.qsig) ?? "", usdCents, quoteMinor, quoteCurrency, paidCents: int(totals.subtotal), paidCurrency: str(totals.currency_code ?? d.currency_code)?.toUpperCase() ?? null };
}

/** Money arrived but cannot switch anything on: logged as an error for the owner to refund it in Paddle. */
async function refundNeeded(reason: string, p: { transactionId: string; offerId: string; userId: string }) {
  await logError(new Error(`Card payment of an offer not applied: ${reason}. Refund it in Paddle.`), { source: "billing.offer_card", level: "error", userId: p.userId, transactionId: p.transactionId, offerId: p.offerId });
  return `offer card payment not applied (${reason}): refund needed`;
}

/**
 * The webhook side (transaction.completed of an offer): checks the signatures, that the amount and currency paid are
 * the signed quote, and that the offer still costs what was quoted; then switches it on, once (a replay finds the
 * offer paid). Returns a note for the stored event, or null when the transaction is not an offer payment. Throws only
 * on a real failure, so Paddle retries.
 */
export async function applyOfferCardPayment(data: unknown, now: Date = new Date()): Promise<string | null> {
  const p = offerCardPaymentOf(data);
  if (!p) return null;
  if (!(await verifyCheckoutUser(p.userId, p.sig)) || !(await verifyCheckoutUser(quoteMessage(p), p.qsig))) return refundNeeded("the transaction's custom data is not signed by BuPulse", p);
  if (p.quantity !== 1) return refundNeeded(`bought ${p.quantity} instead of 1`, p);
  if (p.paidCurrency !== "USD" || p.paidCents !== p.usdCents) return refundNeeded(`paid ${p.paidCents ?? "?"} ${p.paidCurrency ?? "?"}, quoted ${p.usdCents} USD`, p);
  const [offer, business] = await Promise.all([prisma.planOffer.findUnique({ where: { id: p.offerId } }), prisma.business.findUnique({ where: { userId: p.userId }, select: { id: true } })]);
  if (!offer || !business || offer.businessId !== business.id) return refundNeeded("the offer is not this client's", p);
  const paidBy = `card:${p.transactionId}`;
  if (offer.status === "paid") return offer.paidBy === paidBy ? "offer already paid by this transaction" : refundNeeded("the offer was already paid another way (possible double payment)", p);
  if (offer.status !== "accepted" || !offer.customPlanKey) return refundNeeded(`the offer is ${offer.status}`, p);
  if (offer.adjustedMinor !== p.quoteMinor || offer.currency.toUpperCase() !== p.quoteCurrency) return refundNeeded("the offer's price changed after the card quote", p);

  const plan = (await getPlan(offer.customPlanKey)) ?? (await getPlans({ force: true })).find((x) => x.key === offer.customPlanKey) ?? null;
  if (!plan) throw new Error(`The custom plan ${offer.customPlanKey} of offer ${offer.id} is missing`);
  const addition = readAddition(offer.options);

  for (let attempt = 0; ; attempt++) {
    const sub = await prisma.subscription.findUnique({ where: { userId: p.userId } });
    if (!sub) return refundNeeded("the client has no subscription any more", p);
    if (sub.provider === "PADDLE" && sub.providerSubscriptionId && LIVE.has(sub.status) && sub.plan !== "TRIAL" && !sub.cancelAtPeriodEnd) return refundNeeded("the client has a card subscription that still renews", p);
    if (addition && !additionFits(addition, sub, offer.interval, now)) {
      await withdrawStaleAddition(offer, now);
      clearPlanCache();
      return refundNeeded("the plan's period changed after the features were priced (quote cancelled)", p);
    }
    const period: { mode: "extend" | "replace" | "fresh" | "keep"; start: Date; end: Date } = addition ? { mode: "keep", start: now, end: sub.currentPeriodEnd as Date } : planManualPeriod(sub, plan.key, offer.interval, now);
    const before = { plan: sub.plan, status: sub.status, provider: sub.provider, interval: sub.interval, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd };
    // Renewed by hand afterwards (Mobile Money, or card in its last 7 days): there is no card subscription for a custom plan.
    const after = {
      plan: plan.key,
      status: "ACTIVE" as const,
      provider: "MANUAL_MOMO" as const,
      interval: offer.interval,
      providerSubscriptionId: null,
      providerCustomerId: null,
      providerPriceId: null,
      providerUpdatedAt: now,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      ...(period.mode === "extend" || period.mode === "keep" ? {} : { currentPeriodStart: period.start }),
      currentPeriodEnd: period.end,
    };
    let moved = false;
    try {
      await prisma.$transaction(async (tx) => {
        await markOfferPaidInTx(tx, SYSTEM, { offer, paymentId: p.transactionId, invoiceId: null, planKey: plan.key, amountMinor: p.quoteMinor, currency: p.quoteCurrency, paidBy }, now);
        const written = await tx.subscription.updateMany({ where: { userId: p.userId, providerSubscriptionId: sub.providerSubscriptionId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd }, data: after });
        if (written.count !== 1) {
          moved = true;
          throw new Error("subscription moved");
        }
        await writeAudit(tx, SYSTEM, "offer_paid_card", `offer:${offer.id}`, { status: "accepted", subscription: before }, { status: "paid", transactionId: p.transactionId, usdCents: p.usdCents, quoteMinor: p.quoteMinor, quoteCurrency: p.quoteCurrency, period: period.mode, subscription: after });
      });
    } catch (error) {
      if (moved && attempt === 0) continue;
      throw error;
    }
    clearPlanCache();
    const [user, biz] = await Promise.all([prisma.user.findUnique({ where: { id: p.userId }, select: { email: true, name: true } }), prisma.business.findUnique({ where: { userId: p.userId }, select: { id: true, ceoName: true } })]);
    for (const name of subscriptionEventsFor(before, after, false)) await trackEvent(name, { userId: p.userId, businessId: biz?.id, props: { plan: plan.key, interval: offer.interval, from: before.plan, method: "card" } }).catch(() => undefined);
    if (user?.email) await sendPlanActiveEmail({ email: user.email, name: user.name ?? biz?.ceoName ?? null }, { planName: plan.name, interval: offer.interval, amountMinor: p.quoteMinor, currency: p.quoteCurrency, reference: p.transactionId, periodEnd: period.end, card: { usdCents: p.usdCents } }).catch(() => false);
    return `offer ${offer.id} paid by card (${period.mode})`;
  }
}
