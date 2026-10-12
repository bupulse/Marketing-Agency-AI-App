import "server-only";
import type { BillingInterval, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { logError } from "@/lib/errors";
import { featureLabel, FEATURES, type FeatureKey } from "@/lib/features";
import { capabilitiesOf, clearPlanCache, getPlan } from "@/lib/plan-catalog";
import { companyPlans } from "@/lib/region-prices";
import type { RegionInfo } from "@/lib/region-format";
import { ManualPaymentError, startOfferPayment } from "@/lib/billing/momo";
import type { ManualPaymentView } from "@/lib/billing/momo-shared";
import { issuePlanInvoice } from "@/lib/invoices/service";
import { listAddonPrices } from "./addon-prices";
import { sendOfferEmail } from "./emails";
import {
  checkOfferDraft,
  customPlanKeyFor,
  isOfferExpired,
  isOfferStatus,
  OFFER_STATUSES,
  OFFER_VALID_DAYS,
  offerDraftSchema,
  quoteOffer,
  readFeatureKeys,
  readLinesJson,
  readManagedTier,
  toClientOffer,
  validUntilOf,
  YEARLY_MONTHS,
  type AddonPriceRow,
  type ClientOfferView,
  type ManagedTier,
  type OfferBase,
  type OfferDraft,
  type OfferQuote,
  type OfferStatus,
  type PricedLine,
} from "./shared";

// Custom plan offers (docs/OFFERS.md). The admin side (save a draft, send, withdraw) runs in the console only and is
// audited; a Jarvis create_offer is an approval that the owner approves in the console, which then runs these same
// functions. The client side (see, accept, choose how to pay) only ever reads and changes its own company's offer.
// Every status change is one conditional write on the status, so double clicks and two tabs cannot do anything twice;
// a partial unique index keeps at most one sent or accepted offer per company.

type Row = Prisma.PlanOfferGetPayload<object>;

/** The client-facing message thrown by the client-side functions. Safe to show. */
export class OfferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfferError";
  }
}

const isUnique = (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
const json = (v: unknown) => v as Prisma.InputJsonValue;
const SYSTEM: AdminContext = { actor: "system:offers", ip: null, viaApi: false };

/** Offers are made, sent and withdrawn in the console (or by an approved Jarvis request, which runs as the console). */
function requireConsole(ctx: AdminContext) {
  if (ctx.viaApi || ctx.actor !== "admin") throw new AdminError("forbidden", "Offers are made, sent and withdrawn in the admin console. Jarvis can ask for one with create_offer (the owner approves it).");
}

type Options = { managedTier: ManagedTier; validDays: number; added: FeatureKey[]; basePlanName: string | null };
function readOptions(value: unknown): Options {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const days = typeof v.validDays === "number" && Number.isInteger(v.validDays) && v.validDays > 0 ? v.validDays : OFFER_VALID_DAYS;
  return { managedTier: readManagedTier(v), validDays: days, added: readFeatureKeys(v.added), basePlanName: typeof v.basePlanName === "string" ? v.basePlanName : null };
}

// ---- pricing context ------------------------------------------------------------------------------------------------

export type PricingContext = { region: RegionInfo; bases: OfferBase[]; prices: AddonPriceRow[] };

/** The plans the company's region offers (to start from) and the region's add-on prices. */
export async function pricingContext(businessId: string): Promise<PricingContext> {
  const [{ region, plans }, prices] = await Promise.all([companyPlans(businessId), listAddonPrices()]);
  return {
    region,
    bases: plans.map((p) => ({ key: p.key, name: p.name, monthlyMinor: p.monthlyPriceCents, yearlyMinor: p.yearlyPriceCents, features: p.features, limits: p.limits })),
    prices: prices.filter((p) => p.regionKey === region.key),
  };
}

/** The server's quote of a draft, with the same maths as the editor's live total. */
export function quoteWith(pc: PricingContext, draft: OfferDraft): { quote: OfferQuote; base: OfferBase | null } {
  const base = draft.basePlanKey ? (pc.bases.find((b) => b.key === draft.basePlanKey) ?? null) : null;
  if (draft.basePlanKey && !base) throw new AdminError("invalid", `The ${draft.basePlanKey} plan is not offered in ${pc.region.name}, the company's region. Start from one of: ${pc.bases.map((b) => b.name).join(", ") || "no plan (features only)"}.`);
  const quote = quoteOffer({ base, features: draft.features, limits: draft.limits, managedTier: draft.managedTier, interval: draft.interval, currency: pc.region.currency, regionKey: pc.region.key, prices: pc.prices });
  return { quote, base };
}

export function parseDraft(raw: unknown): OfferDraft {
  const parsed = offerDraftSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AdminError("invalid", `${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "Check the offer and try again."}`);
  }
  return parsed.data;
}

// ---- admin: save, send, withdraw ------------------------------------------------------------------------------------

/**
 * Saves the editor: creates a draft, or updates one (drafts only). The price is computed here from the region's prices
 * and frozen on the row with the lines, so the client later pays exactly what was sent. Audited.
 */
export async function saveOfferDraft(ctx: AdminContext, input: { businessId: string; offerId?: string | null; draft: unknown }) {
  requireConsole(ctx);
  const draft = parseDraft(input.draft);
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, name: true } });
  if (!business) throw new AdminError("not_found", "No company with that id.");
  const pc = await pricingContext(business.id);
  const { quote, base } = quoteWith(pc, draft);
  const checked = checkOfferDraft(draft, quote);
  if (!checked.ok) throw new AdminError("invalid", checked.error);
  if (draft.requestId) {
    const request = await prisma.customPlanRequest.findUnique({ where: { id: draft.requestId }, select: { businessId: true } });
    if (!request || (request.businessId && request.businessId !== business.id)) throw new AdminError("invalid", "That request is not this company's.");
  }
  const options: Options = { managedTier: draft.managedTier, validDays: draft.validDays, added: quote.added, basePlanName: base?.name ?? null };
  const data = {
    basePlanKey: base?.key ?? null,
    featureKeys: json(quote.features),
    limits: json(quote.limits),
    options: json(options),
    currency: pc.region.currency,
    interval: draft.interval as BillingInterval,
    lines: json(quote.lines),
    computedMinor: quote.computedMinor,
    adjustedMinor: checked.adjustedMinor,
    adjustReason: checked.adjustReason,
    note: draft.note,
    requestId: draft.requestId,
  };
  const summary = { basePlanKey: data.basePlanKey, features: quote.features, limits: quote.limits, interval: data.interval, currency: data.currency, computedMinor: data.computedMinor, adjustedMinor: data.adjustedMinor, adjustReason: data.adjustReason };
  if (input.offerId) {
    const row = await prisma.planOffer.findFirst({ where: { id: input.offerId, businessId: business.id } });
    if (!row) throw new AdminError("not_found", "No offer with that id for this company.");
    if (row.status !== "draft") throw new AdminError("conflict", `This offer is ${row.status}: only drafts can be changed. Make a new offer instead.`);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.planOffer.updateMany({ where: { id: row.id, status: "draft" }, data });
      if (count !== 1) throw new AdminError("conflict", "The offer was sent or withdrawn a moment ago. Nothing was changed.");
      await writeAudit(tx, ctx, "update_offer", `offer:${row.id}`, { features: row.featureKeys, limits: row.limits, adjustedMinor: row.adjustedMinor, interval: row.interval }, summary);
    });
    return { id: row.id, created: false, quote, adjustedMinor: checked.adjustedMinor };
  }
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.planOffer.create({ data: { ...data, businessId: business.id, status: "draft", createdBy: ctx.actor } });
    await writeAudit(tx, ctx, "create_offer", `offer:${row.id}`, null, { businessId: business.id, ...summary, requestId: draft.requestId });
    return row;
  });
  return { id: created.id, created: true, quote, adjustedMinor: checked.adjustedMinor };
}

/**
 * Sends a draft to the company owner: sent, open for its number of days, emailed with a link to Billing. A sent offer
 * of the same company is withdrawn in the same transaction ("replaced"); an accepted one (the client may be paying)
 * stops the send. The request behind it becomes "offered". Audited; a double click is refused.
 */
export async function sendOffer(ctx: AdminContext, id: string, now: Date = new Date()) {
  requireConsole(ctx);
  const row = await prisma.planOffer.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No offer with that id.");
  if (row.status !== "draft") throw new AdminError("conflict", `This offer is already ${row.status}.`);
  const accepted = await prisma.planOffer.findFirst({ where: { businessId: row.businessId, status: "accepted", id: { not: id } }, select: { id: true } });
  if (accepted) throw new AdminError("conflict", "The client has accepted another offer and may be paying it. Withdraw that one first (Offers), then send this one.");
  const owner = await prisma.business.findUnique({ where: { id: row.businessId }, select: { name: true, ceoName: true, user: { select: { email: true, name: true } } } });
  if (!owner?.user?.email) throw new AdminError("conflict", "The company has no owner email to send the offer to.");
  const options = readOptions(row.options);
  const validUntil = validUntilOf(now, options.validDays);
  try {
    await prisma.$transaction(async (tx) => {
      const replaced = await tx.planOffer.updateMany({ where: { businessId: row.businessId, status: "sent", id: { not: id } }, data: { status: "withdrawn", withdrawnAt: now, withdrawReason: "Replaced by a newer offer." } });
      const { count } = await tx.planOffer.updateMany({ where: { id, status: "draft" }, data: { status: "sent", sentAt: now, validUntil } });
      if (count !== 1) throw new AdminError("conflict", "The offer was sent or withdrawn a moment ago. Nothing was sent.");
      if (row.requestId) await tx.customPlanRequest.updateMany({ where: { id: row.requestId, status: { in: ["new", "contacted"] } }, data: { status: "offered", handledBy: ctx.actor } });
      await writeAudit(tx, ctx, "send_offer", `offer:${id}`, { status: "draft" }, { status: "sent", businessId: row.businessId, to: owner.user!.email, adjustedMinor: row.adjustedMinor, currency: row.currency, interval: row.interval, validUntil, replaced: replaced.count });
    });
  } catch (error) {
    if (isUnique(error)) throw new AdminError("conflict", "Another offer was sent to this company a moment ago. Look at its offers.");
    throw error;
  }
  const emailed = await sendOfferEmail(
    { email: owner.user.email, name: owner.user.name ?? owner.ceoName },
    { company: owner.name, totalMinor: row.adjustedMinor, currency: row.currency, interval: row.interval, features: options.added.map(featureLabel), validUntil, note: row.note },
  ).catch(() => false);
  return { id, status: "sent" as const, validUntil, emailed, to: owner.user.email };
}

/**
 * Takes an offer back (draft, sent or accepted). An accepted offer whose payment the client has reported (Mobile
 * Money waiting in Payments) cannot be withdrawn until that payment is decided. Otherwise its open payment is closed,
 * its unpaid invoice voided and its prepared custom plan retired, in one transaction. Audited.
 */
export async function withdrawOffer(ctx: AdminContext, id: string, reason: string, now: Date = new Date()) {
  requireConsole(ctx);
  const why = reason.trim();
  if (why.length < 3 || why.length > 300) throw new AdminError("invalid", "Give a short reason (3 to 300 characters).");
  const row = await prisma.planOffer.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No offer with that id.");
  if (!["draft", "sent", "accepted"].includes(row.status)) throw new AdminError("conflict", `This offer is ${row.status}: there is nothing to withdraw.`);
  const reported = await prisma.manualPayment.findFirst({
    where: { status: "pending", submittedAt: { not: null }, OR: [{ offerId: id }, ...(row.invoiceId ? [{ invoiceId: row.invoiceId }] : [])] },
    select: { reference: true },
  });
  if (reported) throw new AdminError("conflict", `The client has reported a payment (${reported.reference}) for this offer. Confirm or reject it in Payments first.`);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.planOffer.updateMany({ where: { id, status: { in: ["draft", "sent", "accepted"] } }, data: { status: "withdrawn", withdrawnAt: now, withdrawReason: why } });
    if (count !== 1) throw new AdminError("conflict", "The offer was paid or withdrawn a moment ago. Nothing was changed.");
    await tx.manualPayment.updateMany({ where: { status: "pending", submittedAt: null, OR: [{ offerId: id }, ...(row.invoiceId ? [{ invoiceId: row.invoiceId }] : [])] }, data: { status: "expired", decidedAt: now, decidedBy: ctx.actor } });
    if (row.invoiceId) await tx.invoice.updateMany({ where: { id: row.invoiceId, status: "sent" }, data: { status: "void", voidedAt: now, voidReason: `Offer withdrawn: ${why}` } });
    if (row.customPlanKey) await tx.planDefinition.updateMany({ where: { key: row.customPlanKey, isCustom: true, status: { not: "retired" } }, data: { status: "retired" } });
    await writeAudit(tx, ctx, "withdraw_offer", `offer:${id}`, { status: row.status }, { status: "withdrawn", reason: why, invoiceId: row.invoiceId, customPlanKey: row.customPlanKey });
  });
  if (row.customPlanKey) clearPlanCache();
  return { id, status: "withdrawn" as const };
}

/**
 * Lazy expiry: sent offers past their date become expired (audited per offer as the system). Called by every read of
 * offers (admin lists, the client's Billing page and banner), so no cron is needed.
 */
export async function expireOffers(now: Date = new Date(), businessId?: string): Promise<number> {
  const due = await prisma.planOffer.findMany({ where: { status: "sent", validUntil: { lte: now }, ...(businessId ? { businessId } : {}) }, select: { id: true, validUntil: true }, take: 100 });
  let expired = 0;
  for (const o of due) {
    const { count } = await prisma.planOffer.updateMany({ where: { id: o.id, status: "sent" }, data: { status: "expired" } });
    if (count !== 1) continue;
    expired++;
    await writeAudit(prisma, SYSTEM, "expire_offer", `offer:${o.id}`, { status: "sent" }, { status: "expired", validUntil: o.validUntil }).catch(() => undefined);
  }
  return expired;
}

// ---- reads ----------------------------------------------------------------------------------------------------------

export type AdminOfferView = {
  id: string;
  businessId: string;
  company: string;
  status: OfferStatus;
  interval: BillingInterval;
  currency: string;
  computedMinor: number;
  adjustedMinor: number;
  adjustReason: string | null;
  basePlanKey: string | null;
  basePlanName: string | null;
  features: FeatureKey[];
  added: FeatureKey[];
  limits: { text: number; image: number; chat: number; seats: number };
  managedTier: ManagedTier;
  validDays: number;
  lines: PricedLine[];
  note: string | null;
  validUntil: Date | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  paidAt: Date | null;
  withdrawnAt: Date | null;
  withdrawReason: string | null;
  payMethod: string | null;
  customPlanKey: string | null;
  invoiceId: string | null;
  requestId: string | null;
  createdBy: string;
  createdAt: Date;
};

function limitsOf(value: unknown) {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const n = (k: string, d: number) => (typeof v[k] === "number" && Number.isInteger(v[k]) ? (v[k] as number) : d);
  return { text: n("text", 0), image: n("image", 0), chat: n("chat", 0), seats: n("seats", 1) };
}

function adminView(row: Row, company: string): AdminOfferView {
  const o = readOptions(row.options);
  return {
    id: row.id,
    businessId: row.businessId,
    company,
    status: (isOfferStatus(row.status) ? row.status : "draft") as OfferStatus,
    interval: row.interval,
    currency: row.currency,
    computedMinor: row.computedMinor,
    adjustedMinor: row.adjustedMinor,
    adjustReason: row.adjustReason,
    basePlanKey: row.basePlanKey,
    basePlanName: o.basePlanName,
    features: readFeatureKeys(row.featureKeys),
    added: o.added,
    limits: limitsOf(row.limits),
    managedTier: o.managedTier,
    validDays: o.validDays,
    lines: readLinesJson(row.lines),
    note: row.note,
    validUntil: row.validUntil,
    sentAt: row.sentAt,
    acceptedAt: row.acceptedAt,
    paidAt: row.paidAt,
    withdrawnAt: row.withdrawnAt,
    withdrawReason: row.withdrawReason,
    payMethod: row.payMethod,
    customPlanKey: row.customPlanKey,
    invoiceId: row.invoiceId,
    requestId: row.requestId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/** Offers, newest first, optionally by status or company. Expires what is due first. */
export async function listOffers(opts: { status?: string; businessId?: string; limit?: number } = {}, now: Date = new Date()): Promise<AdminOfferView[]> {
  if (opts.status && !isOfferStatus(opts.status)) throw new AdminError("invalid", `status must be one of: ${OFFER_STATUSES.join(", ")}.`);
  await expireOffers(now).catch((error) => logError(error, { source: "offers.expire" }));
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 200);
  const rows = await prisma.planOffer.findMany({ where: { ...(opts.status ? { status: opts.status } : {}), ...(opts.businessId ? { businessId: opts.businessId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit });
  const ids = [...new Set(rows.map((r) => r.businessId))];
  const businesses = ids.length ? await prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(businesses.map((b) => [b.id, b.name]));
  return rows.map((r) => adminView(r, name.get(r.businessId) ?? "A company"));
}

export async function getOffer(id: string, now: Date = new Date()): Promise<AdminOfferView> {
  await expireOffers(now).catch(() => undefined);
  const row = await prisma.planOffer.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No offer with that id.");
  const b = await prisma.business.findUnique({ where: { id: row.businessId }, select: { name: true } });
  return adminView(row, b?.name ?? "A company");
}

/** What the client sees of an offer (also the admin editor's preview). */
export const clientViewOf = (o: AdminOfferView): ClientOfferView => toClientOffer(o);

// ---- client: see, accept, pay -----------------------------------------------------------------------------------------

/** The company's open offer (sent or accepted), for Billing and the dashboard banner. Expires a due one first. */
export async function clientOffer(businessId: string, now: Date = new Date()): Promise<ClientOfferView | null> {
  if (!businessId) return null;
  await expireOffers(now, businessId).catch(() => undefined);
  const row = await prisma.planOffer.findFirst({ where: { businessId, status: { in: ["sent", "accepted"] } }, orderBy: { createdAt: "desc" } });
  if (!row || isOfferExpired(row, now)) return null;
  return clientViewOf(adminView(row, ""));
}

export type PayMethod = "momo" | "invoice";
export type AcceptResult = { offer: ClientOfferView; payment: ManualPaymentView | null; invoiceId: string | null };

const clientCtx = (actorId: string, ip: string | null = null): AdminContext => ({ actor: `client:${actorId}`, ip, viaApi: false });

/** The custom plan's own prices: the offer's price for its interval, the other interval derived (yearly = 10 months). */
function customPrices(adjustedMinor: number, interval: BillingInterval) {
  return interval === "YEAR" ? { monthlyPriceCents: Math.ceil(adjustedMinor / YEARLY_MONTHS), yearlyPriceCents: adjustedMinor } : { monthlyPriceCents: adjustedMinor, yearlyPriceCents: adjustedMinor * YEARLY_MONTHS };
}

/**
 * The client accepts the offer and chooses how to pay: sent -> accepted, and the company's private plan is prepared
 * (a hidden PlanDefinition with isCustom; its key comes from the offer id, so a second accept can never make a second
 * plan). Nothing switches on yet: that happens when the payment is confirmed. Accepting again (or choosing the other
 * way to pay) only changes the method. Then: Mobile Money opens a payment for the offer's price (the existing pay
 * screen and the admin's Payments queue); invoice issues one invoice from the offer (Mobile Money with the invoice
 * number, or Mark as paid).
 */
export async function acceptOffer(input: { userId: string; actorId: string; businessId: string; offerId: string; method: string; ip?: string | null }, now: Date = new Date()): Promise<AcceptResult> {
  const method: PayMethod | null = input.method === "momo" || input.method === "invoice" ? input.method : null;
  if (!method) throw new OfferError("Choose how you want to pay.");
  const row = await prisma.planOffer.findFirst({ where: { id: input.offerId, businessId: input.businessId } });
  if (!row || row.status === "draft") throw new OfferError("We could not find that offer. Open Billing again.");
  if (row.status === "paid") throw new OfferError("This offer is already paid. Your custom plan is on.");
  if (row.status === "withdrawn") throw new OfferError("This offer was withdrawn. Ask us for a new one.");
  if (row.status === "expired" || isOfferExpired(row, now)) throw new OfferError("This offer has expired. Ask us for a new one and we will send it again.");
  const { region } = await companyPlans(input.businessId);
  if (method === "momo" && !region.paymentMethods.includes("momo")) throw new OfferError("Mobile Money is not available where your business is. Choose Pay by invoice.");
  if (row.currency.toUpperCase() !== region.currency.toUpperCase()) throw new OfferError("This offer was made for another region. Ask us for a new one.");
  const ctx = clientCtx(input.actorId, input.ip ?? null);
  const planKey = customPlanKeyFor(row.id);

  if (row.status === "sent") {
    const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { name: true } });
    const features = readFeatureKeys(row.featureKeys);
    const prices = customPrices(row.adjustedMinor, row.interval);
    const won = await prisma.$transaction(async (tx) => {
      const claim = await tx.planOffer.updateMany({ where: { id: row.id, status: "sent", validUntil: { gt: now } }, data: { status: "accepted", acceptedAt: now, payMethod: method, customPlanKey: planKey } });
      if (claim.count !== 1) return false;
      const existing = await tx.planDefinition.findUnique({ where: { key: planKey }, select: { key: true } });
      if (!existing) {
        await tx.planDefinition.create({
          data: {
            key: planKey,
            name: "Custom",
            description: `${business?.name ?? "Your company"}'s own plan`,
            isTrial: false,
            status: "hidden",
            sortOrder: 900,
            highlight: false,
            ...prices,
            currency: row.currency,
            limits: json(row.limits),
            highlights: json([]),
            featureKeys: json(features),
            features: json([]),
            capabilities: json(capabilitiesOf(features)),
            isCustom: true,
            businessId: input.businessId,
          },
        });
      }
      await writeAudit(tx, ctx, "accept_offer", `offer:${row.id}`, { status: "sent" }, { status: "accepted", method, customPlanKey: planKey, adjustedMinor: row.adjustedMinor, currency: row.currency, interval: row.interval });
      return true;
    });
    if (won) clearPlanCache();
    else {
      // Another tab accepted it a moment ago (fine: carry on with the payment), or it just expired or was withdrawn.
      const now2 = await prisma.planOffer.findUnique({ where: { id: row.id }, select: { status: true } });
      if (now2?.status !== "accepted") throw new OfferError("This offer is no longer open. Ask us for a new one.");
    }
  } else if (row.payMethod !== method) {
    await prisma.planOffer.updateMany({ where: { id: row.id, status: "accepted" }, data: { payMethod: method } });
  }

  const fresh = await prisma.planOffer.findUnique({ where: { id: row.id } });
  if (!fresh || fresh.status !== "accepted") throw new OfferError("This offer is no longer open. Ask us for a new one.");
  if (method === "momo") {
    try {
      const payment = await startOfferPayment({ userId: input.userId, offerId: row.id, now });
      return { offer: clientViewOf(adminView(fresh, "")), payment, invoiceId: null };
    } catch (error) {
      if (error instanceof ManualPaymentError) throw new OfferError(error.message);
      throw error;
    }
  }
  const invoiceId = await ensureOfferInvoice(ctx, fresh, input.userId, now);
  const after = await prisma.planOffer.findUnique({ where: { id: row.id } });
  return { offer: clientViewOf(adminView(after ?? fresh, "")), payment: null, invoiceId };
}

/**
 * The invoice of an accepted offer: the open one, or a new one issued now (one line, the offer's price, the custom
 * plan and interval to switch on when paid). Claimed with a token first, so two tabs never issue two invoices. A
 * Mobile Money payment the client has reported stops it (one payment at a time); one only opened gives way.
 */
async function ensureOfferInvoice(ctx: AdminContext, offer: Row, userId: string, now: Date): Promise<string> {
  if (offer.invoiceId && !offer.invoiceId.startsWith("claim:")) {
    const inv = await prisma.invoice.findUnique({ where: { id: offer.invoiceId }, select: { status: true } });
    if (inv?.status === "sent") return offer.invoiceId;
    if (inv?.status === "paid") throw new OfferError("The invoice for this offer is already paid.");
  }
  const reported = await prisma.manualPayment.findFirst({ where: { userId, status: "pending", submittedAt: { not: null } }, select: { reference: true } });
  if (reported) throw new OfferError(`You have reported a Mobile Money payment (${reported.reference}). Please wait until we have checked it.`);
  await prisma.manualPayment.updateMany({ where: { userId, offerId: offer.id, status: "pending", submittedAt: null }, data: { status: "expired", decidedAt: now, decidedBy: "client" } });
  const token = `claim:${crypto.randomUUID()}`;
  const { count } = await prisma.planOffer.updateMany({ where: { id: offer.id, status: "accepted", invoiceId: offer.invoiceId }, data: { invoiceId: token } });
  if (count !== 1) {
    const other = await prisma.planOffer.findUnique({ where: { id: offer.id }, select: { invoiceId: true } });
    if (other?.invoiceId && !other.invoiceId.startsWith("claim:")) return other.invoiceId;
    throw new OfferError("Your invoice is being prepared. Reload Billing in a moment.");
  }
  try {
    const plan = offer.customPlanKey ? await getPlan(offer.customPlanKey) : null;
    const features = readFeatureKeys(offer.featureKeys).map(featureLabel);
    const invoice = await issuePlanInvoice(ctx, {
      businessId: offer.businessId,
      currency: offer.currency,
      lines: [{ description: `BuPulse ${plan?.name ?? "Custom"} plan, ${offer.interval === "YEAR" ? "yearly (12 months)" : "monthly (1 month)"}`, quantity: 1, unitMinor: offer.adjustedMinor }],
      planKey: offer.customPlanKey as string,
      interval: offer.interval,
      notes: `Includes: ${features.join(", ")}.`.slice(0, 1000),
    }, now);
    await prisma.planOffer.updateMany({ where: { id: offer.id, invoiceId: token }, data: { invoiceId: invoice.id } });
    return invoice.id;
  } catch (error) {
    await prisma.planOffer.updateMany({ where: { id: offer.id, invoiceId: token }, data: { invoiceId: offer.invoiceId } }).catch(() => undefined);
    if (error instanceof AdminError) throw new OfferError(error.message);
    throw error;
  }
}

/** Card payment of an offer: Paddle cannot take a custom price through the adapter yet (docs/OFFERS.md, "Card"). */
export function offerCardCheckoutAvailable(): boolean {
  return false;
}

// ---- the admin editor ---------------------------------------------------------------------------------------------

export type EditorInitial = {
  basePlanKey: string | null;
  features: FeatureKey[];
  limits: { text: number; image: number; chat: number; seats: number };
  managedTier: ManagedTier;
  interval: BillingInterval;
  adjusted: string;
  adjustReason: string;
  note: string;
  validDays: number;
  requestId: string | null;
};

/**
 * Everything "Customise plan" needs: the company, its region's plans and add-on prices, and the starting point: a
 * draft being edited, a request being answered (its features of interest ticked), or the company's current plan.
 */
export async function offerEditorContext(input: { businessId: string; offerId?: string | null; requestId?: string | null }) {
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, name: true, userId: true, user: { select: { email: true, subscription: { select: { plan: true, chosenPlan: true, status: true, interval: true } } } } } });
  if (!business) throw new AdminError("not_found", "No company with that id.");
  const pc = await pricingContext(business.id);
  const sub = business.user?.subscription ?? null;
  const offer = input.offerId ? await prisma.planOffer.findFirst({ where: { id: input.offerId, businessId: business.id } }) : null;
  const request = !offer && input.requestId ? await prisma.customPlanRequest.findUnique({ where: { id: input.requestId } }) : null;
  const startKey = [sub?.plan, sub?.chosenPlan].find((k) => k && pc.bases.some((b) => b.key === k)) ?? null;
  const startBase = pc.bases.find((b) => b.key === startKey) ?? null;
  const fromBase = (b: OfferBase | null) => ({ text: b?.limits.text ?? 0, image: b?.limits.image ?? 0, chat: b?.limits.chat ?? 0, seats: b?.limits.seats ?? 1 });
  let initial: EditorInitial;
  if (offer) {
    const o = adminView(offer, business.name);
    initial = { basePlanKey: o.basePlanKey, features: o.features, limits: o.limits, managedTier: o.managedTier, interval: o.interval, adjusted: o.adjustedMinor !== o.computedMinor ? String(o.adjustedMinor) : "", adjustReason: o.adjustReason ?? "", note: o.note ?? "", validDays: o.validDays, requestId: o.requestId };
  } else {
    const asked = request ? readFeatureKeys(request.featureKeys).filter((k) => FEATURE_BUILT.has(k)) : [];
    initial = { basePlanKey: startBase?.key ?? null, features: asked, limits: fromBase(startBase), managedTier: "light", interval: sub?.interval === "YEAR" ? "YEAR" : "MONTH", adjusted: "", adjustReason: "", note: "", validDays: OFFER_VALID_DAYS, requestId: request?.id ?? null };
  }
  const currentPlan = sub?.plan ? await getPlan(sub.plan) : null;
  return {
    business: { id: business.id, name: business.name, ownerEmail: business.user?.email ?? null },
    region: pc.region,
    bases: pc.bases,
    prices: pc.prices,
    initial,
    offer: offer ? adminView(offer, business.name) : null,
    request: request ? { id: request.id, description: request.description, goals: request.goals, features: readFeatureKeys(request.featureKeys), budget: request.budget } : null,
    current: { planName: currentPlan?.name ?? sub?.plan ?? "None", status: sub?.status ?? "none", features: currentPlan?.features ?? [] },
  };
}

const FEATURE_BUILT = new Set<FeatureKey>(FEATURES.filter((f) => f.status === "built").map((f) => f.key));
