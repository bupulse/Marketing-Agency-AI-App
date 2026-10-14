// What BuPulse spends, month by month (Admin -> Money -> Costs). Pure, so the rules are unit-tested on their own.
//
// Three kinds of cost make up a month:
// 1. AI and voice providers, per provider: the provider's real bill when the admin entered one (ProviderBill), else the
//    cost ledger's estimate (AiCall, lib/ai/pricing.ts), marked "estimate".
// 2. Recurring costs (RecurringCost): hosting, the domain, subscriptions. A yearly cost counts a twelfth each month.
// 3. Costs entered for one month on the older form (MonthlyCost), kept so nothing entered before disappears.
// Amounts are USD cents; an RWF recurring cost uses the RWF-per-USD rate saved with it, an RWF bill the rate of the
// day it was entered (Admin -> Settings at that time), so changing the rate never restates past months.
import { z } from "zod";

export const COST_CATEGORIES = ["hosting", "domain", "ai", "email", "tools", "other"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<CostCategory, string> = { hosting: "Hosting", domain: "Domain", ai: "AI and voice", email: "Email and messaging", tools: "Tools", other: "Other" };

export type CostPreset = { key: string; name: string; category: CostCategory; amount: number; currency: "USD" | "RWF"; period: "month" | "year"; hint: string };

/** Common costs, to fill the form in one click. The amounts are list prices to check against the real invoice. */
export const COST_PRESETS: CostPreset[] = [
  { key: "cloudflare", name: "Cloudflare Workers Paid", category: "hosting", amount: 5, currency: "USD", period: "month", hint: "$5 a month (Workers Paid)" },
  { key: "netlify", name: "Netlify", category: "hosting", amount: 0, currency: "USD", period: "month", hint: "Free plan: $0; Pro is $19 a month per member" },
  { key: "supabase", name: "Supabase", category: "hosting", amount: 0, currency: "USD", period: "month", hint: "Free plan: $0; Pro is $25 a month" },
  { key: "domain", name: "Domain bupulse.com", category: "domain", amount: 12, currency: "USD", period: "year", hint: "Yearly renewal; enter what the registrar charged" },
  { key: "elevenlabs", name: "ElevenLabs subscription", category: "ai", amount: 22, currency: "USD", period: "month", hint: "Creator is $22 a month; usage beyond it goes in Provider bills" },
  { key: "google_workspace", name: "Google Workspace", category: "email", amount: 7, currency: "USD", period: "month", hint: "Per user per month" },
  { key: "resend", name: "Email sending (Resend)", category: "email", amount: 0, currency: "USD", period: "month", hint: "Free up to 3,000 emails a month" },
  { key: "github", name: "GitHub", category: "tools", amount: 0, currency: "USD", period: "month", hint: "Free plan: $0" },
];

/** `category`: where its line counts (default "ai"). */
export type BillProvider = { key: string; label: string; ledger: string[]; hint: string; category?: CostCategory };

/** Providers that send a usage bill. `ledger` is the AiCall.provider whose estimate a real bill replaces. */
export const BILL_PROVIDERS: BillProvider[] = [
  { key: "google_ai", label: "Google AI (Gemini)", ledger: ["gemini"], hint: "Google Cloud Billing, Reports, the Gemini API project, for the month" },
  { key: "anthropic", label: "Anthropic (Claude)", ledger: ["claude"], hint: "console.anthropic.com, Billing" },
  { key: "elevenlabs", label: "ElevenLabs (usage beyond the plan)", ledger: ["elevenlabs"], hint: "Only the usage-based part; the subscription is a recurring cost" },
  { key: "higgsfield", label: "Higgsfield", ledger: ["higgsfield"], hint: "Credits bought or used in the month" },
  // Counted from ServiceUsage (lib/money/costs.ts), not AiCall, so WhatsApp never eats into a company's AI allowance.
  { key: "meta_whatsapp", label: "Meta (WhatsApp lead alerts)", ledger: ["whatsapp"], category: "email", hint: "WhatsApp Manager, Insights or Billing, for the month" },
  { key: "other", label: "Other provider", ledger: [], hint: "Anything else billed by usage" },
];

export const billProviderOf = (key: string) => BILL_PROVIDERS.find((p) => p.key === key);
/** The bill provider an AiCall.provider belongs to ("gemini" -> "google_ai"); unknown ones keep their own name. */
export const billKeyForLedger = (ledgerProvider: string) => BILL_PROVIDERS.find((p) => p.ledger.includes(ledgerProvider))?.key ?? ledgerProvider;
export const providerLabel = (key: string) => billProviderOf(key)?.label ?? key;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = z.number().finite().min(0).max(1_000_000);

export const recurringCostSchema = z
  .object({
    name: z.string().trim().min(1, "Name the cost.").max(80),
    provider: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/, "Pick a provider."),
    category: z.enum(COST_CATEGORIES),
    amount: money,
    currency: z.enum(["USD", "RWF"]),
    period: z.enum(["month", "year"]),
    startMonth: z.string().regex(MONTH, "Pick the first month."),
    endMonth: z.string().regex(MONTH).nullable().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => !v.endMonth || v.endMonth >= v.startMonth, { message: "The last month cannot be before the first.", path: ["endMonth"] });
export type RecurringCostInput = z.input<typeof recurringCostSchema>;

export const providerBillSchema = z.object({
  provider: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/, "Pick a provider."),
  month: z.string().regex(MONTH, "Pick the month."),
  amount: money,
  currency: z.enum(["USD", "RWF"]),
  note: z.string().trim().max(200).optional(),
});
export type ProviderBillInput = z.input<typeof providerBillSchema>;

/** Smallest unit: USD cents, whole RWF (no minor unit). */
export const toMinorUnits = (amount: number, currency: string) => Math.round(currency === "USD" ? amount * 100 : amount);

/** USD cents of an amount in USD cents or whole RWF, at `rwfPerUsd`. Unknown currencies count nothing. */
export function usdCentsOf(amountMinor: number, currency: string, rwfPerUsd: number): number {
  if (currency === "USD") return amountMinor;
  if (currency === "RWF") return rwfPerUsd > 0 ? (amountMinor / rwfPerUsd) * 100 : 0;
  return 0;
}

/** "YYYY-MM" months from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 600) break;
  }
  return out;
}

/** The month `n` months before `month`. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export type RecurringCostRow = { id: string; name: string; provider: string; category: string; amountMinor: number; currency: string; usdRate: number | null; period: string; startMonth: string; endMonth: string | null; note: string | null };

/**
 * What a recurring cost adds to one month, in USD cents: 0 outside its months, a twelfth of a yearly one. An RWF cost
 * uses the rate saved with it (so a later rate change never restates history); `rwfPerUsd` only for an older row without one.
 */
export function recurringCentsForMonth(cost: Pick<RecurringCostRow, "amountMinor" | "currency" | "period" | "startMonth" | "endMonth"> & { usdRate?: number | null }, month: string, rwfPerUsd: number): number {
  if (month < cost.startMonth || (cost.endMonth && month > cost.endMonth)) return 0;
  const usd = usdCentsOf(cost.amountMinor, cost.currency, cost.usdRate && cost.usdRate > 0 ? cost.usdRate : rwfPerUsd);
  return cost.period === "year" ? usd / 12 : usd;
}

export type CostSource = "actual" | "estimate" | "recurring" | "entered";
export type CostLine = { key: string; label: string; category: string; source: CostSource; cents: number; estimateCents?: number; calls?: number; estimatedCalls?: number };
export type MonthCosts = { month: string; lines: CostLine[]; totalCents: number; aiCents: number; estimateCents: number; actualCents: number; recurringCents: number; enteredCents: number };

export type LedgerMonth = { month: string; provider: string; cents: number; calls: number; estimatedCalls: number };
export type BillRow = { provider: string; month: string; usdCents: number };
export type EnteredRow = { month: string; category: string; amountCents: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every month's cost lines and totals. A provider bill replaces the ledger estimate of its provider for that month
 * (the estimate is kept on the line, to compare); a provider with only an estimate is marked "estimate".
 */
export function buildMonthCosts(input: { months: string[]; ledger: LedgerMonth[]; bills: BillRow[]; recurring: RecurringCostRow[]; entered: EnteredRow[]; rwfPerUsd: number }): MonthCosts[] {
  return input.months.map((month) => {
    const lines: CostLine[] = [];
    const ai = new Map<string, { cents: number; calls: number; estimatedCalls: number }>();
    for (const l of input.ledger) {
      if (l.month !== month) continue;
      const key = billKeyForLedger(l.provider);
      const a = ai.get(key) ?? { cents: 0, calls: 0, estimatedCalls: 0 };
      a.cents += l.cents;
      a.calls += l.calls;
      a.estimatedCalls += l.estimatedCalls;
      ai.set(key, a);
    }
    const bills = new Map(input.bills.filter((b) => b.month === month).map((b) => [b.provider, b.usdCents]));
    for (const key of new Set([...ai.keys(), ...bills.keys()])) {
      const est = ai.get(key);
      const bill = bills.get(key);
      lines.push({
        key: `ai:${key}`,
        label: providerLabel(key),
        category: billProviderOf(key)?.category ?? "ai",
        source: bill !== undefined ? "actual" : "estimate",
        cents: r2(bill ?? est?.cents ?? 0),
        estimateCents: est ? r2(est.cents) : 0,
        calls: est?.calls ?? 0,
        estimatedCalls: est?.estimatedCalls ?? 0,
      });
    }
    for (const c of input.recurring) {
      const cents = recurringCentsForMonth(c, month, input.rwfPerUsd);
      if (cents > 0) lines.push({ key: `rec:${c.id}`, label: c.period === "year" ? `${c.name} (yearly, a twelfth)` : c.name, category: c.category, source: "recurring", cents: r2(cents) });
    }
    for (const e of input.entered) if (e.month === month && e.amountCents > 0) lines.push({ key: `ent:${e.category}`, label: `${e.category} (entered for the month)`, category: e.category, source: "entered", cents: e.amountCents });
    lines.sort((a, b) => b.cents - a.cents);
    const sum = (f: (l: CostLine) => boolean) => r2(lines.filter(f).reduce((s, l) => s + l.cents, 0));
    return {
      month,
      lines,
      totalCents: sum(() => true),
      aiCents: sum((l) => l.category === "ai" && (l.source === "actual" || l.source === "estimate")),
      estimateCents: sum((l) => l.source === "estimate"),
      actualCents: sum((l) => l.source === "actual"),
      recurringCents: sum((l) => l.source === "recurring"),
      enteredCents: sum((l) => l.source === "entered"),
    };
  });
}

/**
 * The part of a month's cost the daily analytics roll-up does not already hold (it has the ledger and the entered
 * costs): recurring costs, and each provider bill minus that provider's ledger estimate (negative when the bill is
 * lower). Spread over the month's days by lib/analytics/queries.ts, so the Overview tiles and Jarvis agree with the
 * Money pages.
 */
export function monthAdjustments(m: MonthCosts): { recurringCents: number; billDeltaCents: number } {
  const billDelta = m.lines.filter((l) => l.source === "actual").reduce((s, l) => s + (l.cents - (l.estimateCents ?? 0)), 0);
  return { recurringCents: m.recurringCents, billDeltaCents: r2(billDelta) };
}
