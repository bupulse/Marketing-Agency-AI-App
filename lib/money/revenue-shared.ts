// Revenue from every client BuPulse ever had (Admin -> Money -> Revenue and profit). Pure: the loaders are in
// ./revenue.ts. The source is BillingEvent, which has no foreign key, so payments of churned and deleted accounts stay.
//
// - Card: Paddle "transaction.completed" (net of tax and Paddle's fee, USD), refunds from approved refund adjustments.
// - Mobile Money: "manual_payment.confirmed" paid with MTN or Airtel (RWF, its USD value fixed at confirmation).
// - Invoice: a payment of an invoice (the invoice number as reference, or a bank or cash payment the admin recorded),
//   and "invoice.paid_manual" (a plain invoice marked paid by hand).
import { INVOICE_PAID_EVENT, MANUAL_PAYMENT_EVENT, parseMoneyEvent } from "@/lib/analytics/math";
import { kigaliMonthOf } from "@/lib/time/kigali";

export type PayMethod = "card" | "momo" | "invoice";
export const METHOD_LABEL: Record<PayMethod, string> = { card: "Card", momo: "Mobile Money", invoice: "Invoice" };

export type RevenueEntry = {
  id: string;
  at: Date;
  month: string;
  userId: string | null;
  kind: "payment" | "refund";
  usdCents: number;
  method: PayMethod;
  /** What the client paid in their currency (RWF for Mobile Money), when known. */
  localMinor: number | null;
  currency: string;
  plan: string | null;
  priceId: string | null;
  /** A Mobile Money payment for features added to a running period (prorated; period_mode "keep"), not a full period. */
  partial: boolean;
};

type Row = { eventId: string; type: string; payload: unknown; createdAt: Date; userId: string | null };
type Data = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** One stored billing event as revenue, or null when it is not money (subscription updates, unapproved refunds...). */
export function toRevenueEntry(row: Row): RevenueEntry | null {
  const m = parseMoneyEvent(row.type, row.payload, row.createdAt);
  if (!m) return null;
  const data = (((row.payload ?? {}) as { data?: Data }).data ?? {}) as Data;
  let method: PayMethod = "card";
  let localMinor: number | null = null;
  let currency = "USD";
  let plan: string | null = null;
  let priceId: string | null = null;
  let partial = false;
  if (row.type === MANUAL_PAYMENT_EVENT || row.type === INVOICE_PAID_EVENT) {
    const network = str(data.network)?.toUpperCase();
    method = row.type === INVOICE_PAID_EVENT || str(data.invoice_id) || (network && network !== "MTN" && network !== "AIRTEL") ? "invoice" : "momo";
    localMinor = int(data.amount_minor);
    currency = str(data.currency)?.toUpperCase() ?? "RWF";
    plan = str(data.plan);
    partial = data.period_mode === "keep";
  } else {
    const items = Array.isArray(data.items) ? (data.items as Data[]) : [];
    priceId = str((items[0]?.price as Data | undefined)?.id) ?? str(items[0]?.price_id);
    localMinor = m.cents;
    // A custom plan offer or added features paid by card (lib/offers/card.ts): the quote it paid (RWF in Rwanda) is
    // what the client bought; its USD value is the card payment's, net, like any card payment.
    const custom = (data.custom_data ?? {}) as Data;
    const quoteMinor = int(custom.quoteMinor);
    const quoteCurrency = str(custom.quoteCurrency)?.toUpperCase();
    if (custom.kind === "offer" && quoteMinor !== null && quoteCurrency && m.kind === "payment") {
      localMinor = quoteMinor;
      currency = quoteCurrency;
      plan = str(custom.plan);
      partial = custom.partial === 1 || custom.partial === "1";
    }
  }
  const sign = m.kind === "refund" ? -1 : 1;
  // One key per payment or refund, whatever event carried it (a refund can arrive as adjustment.created and
  // adjustment.updated): pay:<id> or refund:<id>.
  return { id: `${m.kind === "refund" ? "refund" : "pay"}:${m.id || row.eventId}`, at: m.at, month: kigaliMonthOf(m.at), userId: row.userId, kind: m.kind, usdCents: sign * m.cents, method, localMinor: localMinor === null ? null : sign * localMinor, currency, plan, priceId, partial };
}

/** Each payment or refund once (a provider may send the same transaction or refund in more than one event). */
export function dedupe(entries: RevenueEntry[]): RevenueEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

export type RevenueMonth = {
  month: string;
  netCents: number;
  grossCents: number;
  refundsCents: number;
  byMethod: Record<PayMethod, number>;
  /** RWF received (Mobile Money and RWF invoices) and its USD value, for the rate used. */
  rwfMinor: number;
  rwfUsdCents: number;
  payingClients: number;
};

export function revenueByMonth(entries: RevenueEntry[], months: string[]): RevenueMonth[] {
  return months.map((month) => {
    const list = entries.filter((e) => e.month === month);
    const byMethod: Record<PayMethod, number> = { card: 0, momo: 0, invoice: 0 };
    let gross = 0;
    let refunds = 0;
    let rwfMinor = 0;
    let rwfUsdCents = 0;
    for (const e of list) {
      byMethod[e.method] += e.usdCents;
      if (e.kind === "payment") gross += e.usdCents;
      else refunds += -e.usdCents;
      if (e.currency === "RWF" && e.localMinor !== null) {
        rwfMinor += e.localMinor;
        rwfUsdCents += e.usdCents;
      }
    }
    return { month, netCents: gross - refunds, grossCents: gross, refundsCents: refunds, byMethod, rwfMinor, rwfUsdCents, payingClients: new Set(list.filter((e) => e.kind === "payment").map((e) => e.userId ?? e.id)).size };
  });
}

/** RWF per USD actually used in a set of payments (their USD values were fixed at confirmation), or null. */
export const rateUsed = (rwfMinor: number, usdCents: number) => (usdCents > 0 ? Math.round((rwfMinor / (usdCents / 100)) * 100) / 100 : null);

export type ClientRevenue = { userId: string | null; netCents: number; payments: number; firstAt: Date; lastAt: Date; methods: PayMethod[] };

/** Lifetime revenue per client (deleted accounts keep their userId; events without one are grouped as unknown). */
export function revenueByClient(entries: RevenueEntry[]): ClientRevenue[] {
  const map = new Map<string, ClientRevenue>();
  for (const e of entries) {
    const key = e.userId ?? "";
    const c = map.get(key) ?? { userId: e.userId, netCents: 0, payments: 0, firstAt: e.at, lastAt: e.at, methods: [] };
    c.netCents += e.usdCents;
    if (e.kind === "payment") c.payments += 1;
    if (e.at < c.firstAt) c.firstAt = e.at;
    if (e.at > c.lastAt) c.lastAt = e.at;
    if (!c.methods.includes(e.method)) c.methods.push(e.method);
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.netCents - a.netCents);
}

/** Lifetime revenue per plan; `planOf` fills the plan of card payments (from their Paddle price, or the client's plan). */
export function revenueByPlan(entries: RevenueEntry[], planOf: (e: RevenueEntry) => string | null): { plan: string; netCents: number; clients: number }[] {
  const map = new Map<string, { net: number; clients: Set<string> }>();
  for (const e of entries) {
    const plan = e.plan ?? planOf(e) ?? "unknown";
    const p = map.get(plan) ?? { net: 0, clients: new Set<string>() };
    p.net += e.usdCents;
    p.clients.add(e.userId ?? e.id);
    map.set(plan, p);
  }
  return [...map].map(([plan, p]) => ({ plan, netCents: p.net, clients: p.clients.size })).sort((a, b) => b.netCents - a.netCents);
}

export type PayingSub = { userId: string; plan: string; interval: string; provider: string | null };

/** What each Mobile Money or invoice client last paid for a whole period (prorated add-on payments skipped), USD cents. */
export function lastFullPayments(entries: RevenueEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) if (e.userId && e.kind === "payment" && e.method !== "card" && !e.partial) out.set(e.userId, e.usdCents);
  return out;
}

/**
 * Monthly recurring revenue in USD cents, per client: a Mobile Money client counts what they last paid (a yearly
 * payment a twelfth); a card client counts their plan's current price. Returns the total and each client's share.
 */
export function mrrOf(subs: PayingSub[], lastMomoUsdCents: Map<string, number>, prices: Record<string, { monthlyPriceCents: number; yearlyPriceCents: number }>): { totalCents: number; byUser: Map<string, number> } {
  const byUser = new Map<string, number>();
  for (const s of subs) {
    const yearly = s.interval === "YEAR";
    const paid = s.provider === "MANUAL_MOMO" ? lastMomoUsdCents.get(s.userId) : undefined;
    const p = prices[s.plan];
    const price = paid ?? (p ? (yearly ? p.yearlyPriceCents : p.monthlyPriceCents) : 0);
    byUser.set(s.userId, Math.round(yearly ? price / 12 : price));
  }
  return { totalCents: [...byUser.values()].reduce((a, b) => a + b, 0), byUser };
}

const DAY_MS = 86_400_000;

/**
 * When a client who paid before stopped paying, or null while they still pay: the end of the period they paid for
 * when their subscription was cancelled or expired, else (deleted account, or back on a trial or another state) their
 * last payment plus the period it bought (30 days, 365 for a yearly plan).
 */
export function stoppedAt(input: { paying: boolean; status: string | null; periodEnd: Date | null; interval: string | null; lastPaymentAt: Date }): Date | null {
  if (input.paying) return null;
  if ((input.status === "CANCELED" || input.status === "EXPIRED") && input.periodEnd) return input.periodEnd;
  return new Date(input.lastPaymentAt.getTime() + (input.interval === "YEAR" ? 365 : 30) * DAY_MS);
}

// ---- the RWF part of a figure (docs/ADMIN.md, "Currency") ------------------------------------------------------------
// The books are in USD cents. Next to a figure, `RwfPart` is how much of it was received in RWF: the exact RWF and the
// USD value it was booked at. Shown in RWF, that part is added exactly (never RWF -> USD -> RWF) and only the rest is
// converted; with nothing else in the figure it is shown exactly, without "≈".

export type RwfPart = { rwfMinor: number; rwfUsdCents: number };
export const NO_RWF: RwfPart = { rwfMinor: 0, rwfUsdCents: 0 };

const isRwf = (e: RevenueEntry) => e.currency === "RWF" && e.localMinor !== null;

/** The RWF part of a set of payments and refunds. */
export function rwfPartOf(entries: readonly RevenueEntry[]): RwfPart {
  let rwfMinor = 0;
  let rwfUsdCents = 0;
  for (const e of entries) if (isRwf(e)) {
    rwfMinor += e.localMinor as number;
    rwfUsdCents += e.usdCents;
  }
  return { rwfMinor, rwfUsdCents };
}

/** The RWF part per client (key: userId, "" for events without one), like revenueByClient. */
export function rwfByClient(entries: readonly RevenueEntry[]): Map<string, RwfPart> {
  const out = new Map<string, RwfPart>();
  for (const e of entries) if (isRwf(e)) {
    const key = e.userId ?? "";
    const p = out.get(key) ?? { rwfMinor: 0, rwfUsdCents: 0 };
    p.rwfMinor += e.localMinor as number;
    p.rwfUsdCents += e.usdCents;
    out.set(key, p);
  }
  return out;
}

/** The RWF part per plan, with the same plan lookup as revenueByPlan. */
export function rwfByPlan(entries: readonly RevenueEntry[], planOf: (e: RevenueEntry) => string | null): Map<string, RwfPart> {
  const out = new Map<string, RwfPart>();
  for (const e of entries) if (isRwf(e)) {
    const plan = e.plan ?? planOf(e) ?? "unknown";
    const p = out.get(plan) ?? { rwfMinor: 0, rwfUsdCents: 0 };
    p.rwfMinor += e.localMinor as number;
    p.rwfUsdCents += e.usdCents;
    out.set(plan, p);
  }
  return out;
}

/**
 * The RWF part of each Mobile Money client's MRR: what they last paid in RWF for a whole period (a yearly payment a
 * twelfth), against the USD that mrrOf counts for them. Clients paying in another currency, or by card, have none.
 */
export function mrrRwf(subs: readonly PayingSub[], entries: readonly RevenueEntry[], mrrByUser: Map<string, number>): Map<string, RwfPart> {
  const last = new Map<string, RevenueEntry>();
  for (const e of entries) if (e.userId && e.kind === "payment" && e.method !== "card" && !e.partial) last.set(e.userId, e);
  const out = new Map<string, RwfPart>();
  for (const s of subs) {
    const e = s.provider === "MANUAL_MOMO" ? last.get(s.userId) : undefined;
    if (!e || !isRwf(e)) continue;
    out.set(s.userId, { rwfMinor: Math.round((e.localMinor as number) / (s.interval === "YEAR" ? 12 : 1)), rwfUsdCents: mrrByUser.get(s.userId) ?? 0 });
  }
  return out;
}

/** The sum of RWF parts; `scale` divides it (an average). */
export function sumRwf(parts: Iterable<RwfPart>, scale = 1): RwfPart {
  let rwfMinor = 0;
  let rwfUsdCents = 0;
  for (const p of parts) {
    rwfMinor += p.rwfMinor;
    rwfUsdCents += p.rwfUsdCents;
  }
  return { rwfMinor: Math.round(rwfMinor / scale), rwfUsdCents: Math.round(rwfUsdCents / scale) };
}
