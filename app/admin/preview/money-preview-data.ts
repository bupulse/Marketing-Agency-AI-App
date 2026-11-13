// Made-up data for the Money screens of the admin console's dev-only preview (app/admin/preview). Placeholder names,
// phone numbers and amounts only.
import type { MoneyReport } from "@/lib/money/report";
import type { ManualPaymentAdminView } from "@/lib/billing/momo";
import type { InvoiceListItem } from "@/lib/invoices/service";
import type { AdminOfferView } from "@/lib/offers/service";
import type { AdminPlanRow } from "@/lib/admin/plans-service";
import type { ProviderBillRow } from "@/lib/money/costs";
import type { MonthlyCostRow } from "@/lib/analytics/costs";
import { buildMonthCosts, type RecurringCostRow } from "@/lib/money/costs-shared";
import { ADDONS } from "@/lib/offers/shared";
import type { MomoSettings, CardEvent } from "@/components/admin/business/money-payments";
import type { AddonTable } from "@/components/admin/business/money-addons";
import type { PlanDetail } from "@/components/admin/business/money-plans";

export const PREVIEW_THIS_MONTH = "2026-11";
export const PREVIEW_LAST_MONTH = "2026-10";
const MONTHS = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const RATE = 1450;

export const PREVIEW_RECURRING: RecurringCostRow[] = [
  { id: "r1", name: "Cloudflare Workers Paid", provider: "cloudflare", category: "hosting", amountMinor: 500, currency: "USD", usdRate: null, period: "month", startMonth: "2026-03", endMonth: null, note: null },
  { id: "r2", name: "Domain bupulse.com", provider: "domain", category: "domain", amountMinor: 1200, currency: "USD", usdRate: null, period: "year", startMonth: "2026-01", endMonth: null, note: "Renews in January" },
  { id: "r3", name: "ElevenLabs subscription", provider: "elevenlabs", category: "ai", amountMinor: 2200, currency: "USD", usdRate: null, period: "month", startMonth: "2026-06", endMonth: null, note: null },
  { id: "r4", name: "Office internet", provider: "other", category: "tools", amountMinor: 30000, currency: "RWF", usdRate: RATE, period: "month", startMonth: "2026-02", endMonth: "2026-08", note: "Moved to the shared office" },
];

export const PREVIEW_COST_MONTHS = buildMonthCosts({
  months: MONTHS,
  ledger: MONTHS.flatMap((m, i) => [
    { month: m, provider: "gemini", cents: 900 + i * 420, calls: 300 + i * 140, estimatedCalls: i === 11 ? 3 : 0 },
    { month: m, provider: "claude", cents: 400 + i * 180, calls: 90 + i * 30, estimatedCalls: 0 },
    { month: m, provider: "elevenlabs", cents: i > 5 ? 300 + i * 60 : 0, calls: i > 5 ? 40 + i * 8 : 0, estimatedCalls: 0 },
  ]),
  bills: MONTHS.slice(0, 10).map((m, i) => ({ provider: "google_ai", month: m, usdCents: 1000 + i * 450 })),
  recurring: PREVIEW_RECURRING,
  entered: [{ month: "2026-09", category: "tools", amountCents: 1500 }],
  rwfPerUsd: RATE,
});

export const PREVIEW_BILLS: ProviderBillRow[] = MONTHS.slice(6, 10).reverse().map((m, i) => ({ id: `b${i}`, provider: "google_ai", month: m, amountMinor: 3700 - i * 400, currency: "USD", usdCents: 3700 - i * 400, usdRate: null, note: i === 0 ? "Invoice 4821-1093" : null, updatedAt: new Date("2026-10-03T08:00:00Z") }));

export const PREVIEW_ENTERED: MonthlyCostRow[] = [{ month: "2026-09", category: "tools", amountCents: 1500, note: "Canva Pro for the sales deck" }];

const revenueCents = [0, 4_100, 9_800, 16_500, 24_000, 33_500, 48_000, 62_000, 80_500, 97_000, 151_000, 186_400];

export const PREVIEW_REPORT: MoneyReport = {
  now: "2026-11-10T08:00:00Z",
  thisMonth: PREVIEW_THIS_MONTH,
  truncated: false,
  rwfPerUsd: RATE,
  months: MONTHS.map((m, i) => {
    const net = revenueCents[i];
    const momo = Math.round(net * 0.72);
    const invoice = Math.round(net * 0.08);
    const costs = PREVIEW_COST_MONTHS[i];
    return {
      month: m,
      revenue: { month: m, netCents: net, grossCents: net, refundsCents: i === 9 ? 2_000 : 0, byMethod: { card: net - momo - invoice - (i === 9 ? 2_000 : 0), momo, invoice }, rwfMinor: momo * 14.5, rwfUsdCents: momo, payingClients: Math.round(net / 6_000) },
      costs,
      profitCents: net - Math.round(costs.totalCents),
      rate: net ? RATE : null,
      rwfByMethod: { card: { rwfMinor: 0, rwfUsdCents: 0 }, momo: { rwfMinor: momo * 14.5, rwfUsdCents: momo }, invoice: { rwfMinor: 0, rwfUsdCents: 0 } },
    };
  }),
  lifetime: { revenueCents: 712_800, rwfMinor: 7_400_000, rwfUsdCents: 510_000, costCents: 118_000, profitCents: 594_800, customersEver: 41, payingNow: 34, churned: 7, firstMonth: "2026-01" },
  mrrCents: 214_000,
  arpuCents: 6_300,
  mrrRwf: { rwfMinor: 2_900_000, rwfUsdCents: 200_000 },
  arpuRwf: { rwfMinor: 87_000, rwfUsdCents: 6_000 },
  churn: { lost30: 2, pct: 5.6 },
  byPlan: [
    { plan: "STARTER", netCents: 210_000, clients: 19, mrrCents: 72_000, payingNow: 16, netRwf: { rwfMinor: 3_000_000, rwfUsdCents: 207_000 }, mrrRwf: { rwfMinor: 1_040_000, rwfUsdCents: 72_000 } },
    { plan: "STANDARD", netCents: 380_000, clients: 16, mrrCents: 104_000, payingNow: 13, netRwf: { rwfMinor: 3_600_000, rwfUsdCents: 248_000 }, mrrRwf: { rwfMinor: 1_500_000, rwfUsdCents: 104_000 } },
    { plan: "PRO", netCents: 122_800, clients: 6, mrrCents: 38_000, payingNow: 5, netRwf: { rwfMinor: 800_000, rwfUsdCents: 55_000 }, mrrRwf: { rwfMinor: 360_000, rwfUsdCents: 24_000 } },
  ],
  clients: [
    { userId: "u1", businessId: "b1", name: "Kigali Bakery", email: "hello@kigalibakery.example", plan: "PRO", status: "ACTIVE", paying: true, deleted: false, revenueCents: 54_000, payments: 6, firstAt: "2026-05-04T08:00:00Z", lastAt: "2026-11-04T08:00:00Z", aiCostCents: 3_100, mrrCents: 9_000, revenueRwf: { rwfMinor: 783_000, rwfUsdCents: 54_000 }, mrrRwf: { rwfMinor: 130_500, rwfUsdCents: 9_000 } },
    { userId: "u2", businessId: "b2", name: "Nyamirambo Salon", email: "salon@example.com", plan: "STANDARD", status: "ACTIVE", paying: true, deleted: false, revenueCents: 36_000, payments: 6, firstAt: "2026-05-12T08:00:00Z", lastAt: "2026-11-02T08:00:00Z", aiCostCents: 1_900, mrrCents: 6_000, revenueRwf: { rwfMinor: 522_000, rwfUsdCents: 36_000 }, mrrRwf: { rwfMinor: 87_000, rwfUsdCents: 6_000 } },
    { userId: "u3", businessId: "b3", name: "Inzozi Tours", email: "tours@example.com", plan: "STARTER", status: "PAST_DUE", paying: true, deleted: false, revenueCents: 12_000, payments: 4, firstAt: "2026-07-01T08:00:00Z", lastAt: "2026-10-01T08:00:00Z", aiCostCents: 14_500, mrrCents: 3_000, revenueRwf: { rwfMinor: 0, rwfUsdCents: 0 }, mrrRwf: { rwfMinor: 0, rwfUsdCents: 0 } },
    { userId: "u4", businessId: null, name: "Deleted account", email: null, plan: null, status: null, paying: false, deleted: true, revenueCents: 4_000, payments: 2, firstAt: "2026-01-05T00:00:00Z", lastAt: "2026-02-05T00:00:00Z", aiCostCents: 0, mrrCents: 0, revenueRwf: { rwfMinor: 0, rwfUsdCents: 0 }, mrrRwf: { rwfMinor: 0, rwfUsdCents: 0 } },
  ],
};

const pay = (over: Partial<ManualPaymentAdminView>): ManualPaymentAdminView =>
  ({ id: "p1", reference: "BP-7K3Q", amountMinor: 29000, currency: "RWF", planName: "Standard", interval: "MONTH", transactionId: "MP2611.0912.A41", payerPhone: "0788 000 111", network: "MTN", proofPath: null, submitted: true, submittedAt: "2026-11-10T07:40:00Z", createdAt: "2026-11-10T07:31:00Z", periodNote: null, seenBefore: null, userId: "u1", company: "Kigali Bakery", email: "hello@kigalibakery.example", status: "pending", decidedAt: null, decidedBy: null, periodEnd: null, rejectReason: null, ...over }) as unknown as ManualPaymentAdminView;

export const PREVIEW_TO_CHECK: ManualPaymentAdminView[] = [
  pay({}),
  pay({ id: "p2", reference: "BP-2M9X", amountMinor: 59000, planName: "Pro", transactionId: null, payerPhone: "0722 000 222", network: "AIRTEL", company: "Inzozi Tours", email: "tours@example.com", submittedAt: "2026-11-10T08:05:00Z", periodNote: { mode: "replace", daysLeft: 12, currentEnd: "2026-11-22T00:00:00Z" }, seenBefore: { id: "old", reference: "BP-9Q1A", status: "confirmed", sameCompany: false } } as Partial<ManualPaymentAdminView>),
];

export const PREVIEW_STARTED: ManualPaymentAdminView[] = [pay({ id: "p3", reference: "BP-4T7L", submitted: false, submittedAt: null, company: "Gisenyi Coffee", email: "coffee@example.com", createdAt: "2026-11-09T16:20:00Z" })];

export const PREVIEW_DECIDED: ManualPaymentAdminView[] = [
  pay({ id: "p4", reference: "BP-8H2C", status: "confirmed", company: "Nyamirambo Salon", decidedAt: "2026-11-08T09:00:00Z", periodEnd: "2026-12-08T09:00:00Z" } as Partial<ManualPaymentAdminView>),
  pay({ id: "p5", reference: "BP-1Z5R", status: "rejected", company: "Huye Prints", amountMinor: 19000, planName: "Starter", decidedAt: "2026-11-06T12:00:00Z", rejectReason: "We received no payment with this reference. Please check the number you paid to." } as Partial<ManualPaymentAdminView>),
  pay({ id: "p6", reference: "BP-6W3E", status: "expired", company: "Musanze Lodge", decidedAt: "2026-11-03T00:00:00Z", transactionId: null } as Partial<ManualPaymentAdminView>),
];

export const PREVIEW_MOMO = { merchantCode: "123456", momoNumber: "0788 000 333", airtelNumber: "", accountName: "BuPulse Ltd" } as unknown as MomoSettings;

export const PREVIEW_CARD_EVENTS: CardEvent[] = [{ id: "e1", eventId: "evt_01jcz8n2placeholder", type: "transaction.completed", userId: "u2", error: "No plan uses price pri_01placeholder", createdAt: new Date("2026-11-09T10:12:00Z") }];

const inv = (over: Partial<InvoiceListItem>): InvoiceListItem => ({ id: "i1", number: "BP-2026-0041", status: "sent", overdue: false, businessId: "b1", company: "Kigali Bakery", currency: "RWF", totalMinor: 59000, total: "RWF 59,000", issueDate: "2026-11-02", dueDate: "2026-11-16", planLabel: "Pro, monthly", sentAt: new Date("2026-11-02T08:00:00Z"), paidAt: null, createdAt: new Date("2026-11-02T08:00:00Z"), ...over });

export const PREVIEW_INVOICES: InvoiceListItem[] = [
  inv({}),
  inv({ id: "i2", number: "BP-2026-0040", status: "sent", overdue: true, company: "Inzozi Tours", businessId: "b3", totalMinor: 29000, planLabel: "Standard, monthly", issueDate: "2026-10-20", dueDate: "2026-11-03" }),
  inv({ id: "i3", number: "BP-2026-0039", status: "paid", company: "Nyamirambo Salon", businessId: "b2", totalMinor: 290000, planLabel: "Standard, yearly", issueDate: "2026-10-11", dueDate: "2026-10-25" }),
  inv({ id: "i4", number: "BP-2026-0042", status: "draft", company: "Gisenyi Coffee", businessId: "b4", totalMinor: 19000, planLabel: null, issueDate: "2026-11-10", dueDate: "2026-11-24" }),
];

const offer = (over: Partial<AdminOfferView>): AdminOfferView =>
  ({ id: "o1", businessId: "b1", company: "Kigali Bakery", status: "sent", interval: "MONTH", currency: "RWF", computedMinor: 98000, adjustedMinor: 98000, basePlanName: "Standard", added: ["autopilot", "analytics"], removed: [], validUntil: new Date("2026-11-20T00:00:00Z"), acceptedAt: null, createdAt: new Date("2026-11-06T09:00:00Z"), ...over }) as unknown as AdminOfferView;

export const PREVIEW_OFFERS: AdminOfferView[] = [
  offer({}),
  offer({ id: "o2", company: "Inzozi Tours", status: "accepted", acceptedAt: new Date("2026-11-08T09:00:00Z"), adjustedMinor: 75000, basePlanName: "Starter", added: ["websiteChat"] } as Partial<AdminOfferView>),
  offer({ id: "o3", company: "Nyamirambo Salon", status: "paid", interval: "YEAR", adjustedMinor: 980000 }),
  offer({ id: "o4", company: "Gisenyi Coffee", status: "draft", adjustedMinor: 45000, basePlanName: "Starter", added: [] }),
];

const planRow = (over: Partial<AdminPlanRow>): AdminPlanRow =>
  ({ key: "STANDARD", name: "Standard", status: "active", isTrial: false, trialDays: null, highlight: false, monthlyPriceCents: 2000, yearlyPriceCents: 20000, subscribers: 13, payingSubscribers: 13, mrrCents: 26000, paddleReady: true, syncState: "synced", latestChange: null, regionNames: ["East Africa", "Rest of the world"], ...over }) as unknown as AdminPlanRow;

export const PREVIEW_PLANS: AdminPlanRow[] = [
  planRow({ key: "TRIAL", name: "Free trial", isTrial: true, trialDays: 14, monthlyPriceCents: 0, yearlyPriceCents: 0, subscribers: 9, payingSubscribers: 0, mrrCents: 0, paddleReady: false, syncState: "not_synced" } as Partial<AdminPlanRow>),
  planRow({ key: "STARTER", name: "Starter", monthlyPriceCents: 1300, yearlyPriceCents: 13000, subscribers: 16, payingSubscribers: 16, mrrCents: 20800, regionNames: ["Rwanda"] }),
  planRow({ highlight: true, latestChange: { id: "c1", direction: "increase", status: "scheduled", subscribers: 13, notifiedCount: 13, appliedCount: 4, failedCount: 0, createdAt: new Date("2026-10-15T00:00:00Z") } }),
  planRow({ key: "PRO", name: "Pro", monthlyPriceCents: 4000, yearlyPriceCents: 40000, subscribers: 5, payingSubscribers: 5, mrrCents: 20000, syncState: "failed" } as Partial<AdminPlanRow>),
  planRow({ key: "BUSINESS_2025", name: "Business (2025)", status: "retired", monthlyPriceCents: 6000, yearlyPriceCents: 60000, subscribers: 1, payingSubscribers: 1, mrrCents: 6000 }),
];

export const PREVIEW_PLAN_DETAIL = {
  plan: {
    key: "STANDARD",
    name: "Standard",
    description: "For a shop posting every day.",
    isTrial: false,
    isCustom: false,
    currency: "USD",
    trialDays: null,
    status: "active",
    sortOrder: 20,
    highlight: true,
    monthlyPriceCents: 2000,
    yearlyPriceCents: 20000,
    limits: { text: 300, image: 60, videos: 8, voiceCharacters: 20000, chat: 2000, videoCredits: 3000, seats: 3 },
    highlights: ["Posts every day", "Website chat"],
    features: [],
    updatedAt: new Date("2026-10-15T00:00:00Z"),
    syncState: "synced",
    syncError: null,
    paddleProductId: "pro_01placeholder",
    paddleMonthlyPriceId: "pri_01monthlynew",
    paddleYearlyPriceId: "pri_01yearlynew",
    paddlePrices: [
      { id: "pri_01monthlyold", interval: "MONTH", amountCents: 1800, archivedAt: null },
      { id: "pri_01monthlynew", interval: "MONTH", amountCents: 2000, archivedAt: null },
      { id: "pri_01yearlynew", interval: "YEAR", amountCents: 20000, archivedAt: null },
    ],
  },
  counts: { subscribers: 13, payingSubscribers: 13, mrrCents: 26000 },
  changes: [{ id: "c1", createdAt: new Date("2026-10-15T00:00:00Z"), oldMonthlyCents: 1800, newMonthlyCents: 2000, oldYearlyCents: 18000, newYearlyCents: 20000, direction: "increase", status: "scheduled", subscribers: 13, notifiedCount: 13, appliedCount: 4, failedCount: 0 }],
  failedItems: [],
  priceUse: { pri_01monthlyold: 9 },
  struggling: 0,
  paddleConnected: true,
} as unknown as PlanDetail;

const REGIONS = [
  { key: "RW", name: "Rwanda", currency: "RWF", active: true },
  { key: "GLOBAL", name: "Rest of the world", currency: "USD", active: true },
];

export const PREVIEW_ADDONS = REGIONS.map((region, ri) => ({
  region,
  prices: ADDONS.filter((_, i) => (ri === 0 ? i % 5 !== 3 : i % 2 === 0)).map((a, i) => ({ addonKey: a.key, regionKey: region.key, currency: region.currency, monthlyMinor: ri === 0 ? 5000 + i * 2500 : 300 + i * 150 })),
})) as unknown as AddonTable;
