import "server-only";
import { prisma } from "@/lib/db";
import { knowledgeProgress } from "@/lib/knowledge/overview";
import { overallPercent } from "@/lib/knowledge/sections";
import { formatMinor } from "@/lib/region-format";
import { getRegionPlans } from "@/lib/region-prices";
import { regionFromCountryCode } from "@/lib/region";
import type { AccountFacts } from "./contract";

// What the support AI and the agents may know about a signed-in client's own account (docs/SUPPORT_CHAT.md section
// 2): plan, trial days left, Business info %, connected channels and expired ones, failed posts. Read-only, always for
// that one business, cached briefly per business so a chat does not re-read it on every message.

const STATUS: Record<string, string> = { PENDING_DEMO: "pending_demo", TRIALING: "trial", ACTIVE: "active", PAST_DUE: "past_due", CANCELED: "canceled", EXPIRED: "expired" };
const cache = new Map<string, { at: number; facts: AccountFacts }>();
const TTL_MS = 60_000;

export async function accountFacts(businessId: string, now = new Date()): Promise<AccountFacts | null> {
  const hit = cache.get(businessId);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.facts;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true, name: true, website: true, industryId: true, industryOther: true, profile: true, knowledge: true, logoUrl: true, brandColors: true, tone: true, positioning: true, policies: true, marketingProfile: true,
      user: { select: { subscription: { select: { plan: true, status: true, trialEndsAt: true, chosenPlan: true } } } },
    },
  });
  if (!business) return null;
  const sub = business.user.subscription;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [plan, channels, failed, percent] = await Promise.all([
    sub ? prisma.planDefinition.findUnique({ where: { key: sub.status === "TRIALING" && sub.chosenPlan ? sub.chosenPlan : sub.plan }, select: { name: true } }) : null,
    prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, select: { provider: true, status: true }, take: 20 }),
    prisma.post.count({ where: { businessId, status: "FAILED", updatedAt: { gte: weekAgo } } }),
    knowledgeProgress(business, now.toISOString().slice(0, 10)).then(overallPercent).catch(() => null),
  ]);
  const trialDaysLeft = sub?.status === "TRIALING" && sub.trialEndsAt ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / 86_400_000)) : null;
  const facts: AccountFacts = {
    businessName: business.name,
    plan: plan?.name ?? sub?.plan ?? null,
    planStatus: sub ? (STATUS[sub.status] ?? sub.status.toLowerCase()) : "none",
    trialDaysLeft,
    businessInfoPercent: percent,
    channels: channels.map((c) => ({ platform: c.provider, ok: c.status === "ACTIVE" || c.status === "EXPIRING" })),
    failedPostsThisWeek: failed,
    adminHref: `/admin/companies/${business.id}`,
  };
  cache.set(businessId, { at: now.getTime(), facts });
  return facts;
}

/** The facts as prompt lines for the AI (no admin link: that is for agents). */
export function factsContext(f: AccountFacts): string {
  const channels = f.channels.length ? f.channels.map((c) => `${c.platform} (${c.ok ? "connected" : "needs reconnecting"})`).join(", ") : "none connected";
  return [
    `Business: ${f.businessName ?? "unknown"}`,
    `Plan: ${f.plan ?? "none"} (${f.planStatus ?? "unknown"})`,
    f.trialDaysLeft !== null ? `Trial days left: ${f.trialDaysLeft}` : null,
    f.businessInfoPercent !== null ? `Business info complete: ${f.businessInfoPercent}%` : null,
    `Social channels: ${channels}`,
    f.failedPostsThisWeek ? `Posts that failed in the last 7 days: ${f.failedPostsThisWeek}` : "No failed posts in the last 7 days",
  ]
    .filter(Boolean)
    .join("\n");
}

let pricing: { at: number; key: string; text: string } | null = null;

/** Today's plans and prices for the visitor's region (the pricing page's numbers), as prompt lines. Cached 5 minutes. */
export async function pricingContext(country: string | null): Promise<string> {
  const region = await regionFromCountryCode(country);
  if (pricing && pricing.key === region && Date.now() - pricing.at < 5 * 60_000) return pricing.text;
  const all = await getRegionPlans(region);
  const trial = all.find((p) => p.isTrial);
  const lines = all.filter((p) => !p.isTrial).map((p) => `- ${p.name}: ${formatMinor(p.monthlyPriceCents, p.currency)} a month or ${formatMinor(p.yearlyPriceCents, p.currency)} a year${p.highlights.length ? `. ${p.highlights.slice(0, 5).join("; ")}` : ""}`);
  const text = [trial?.trialDays ? `Free trial: ${trial.trialDays} days.` : null, ...lines].filter(Boolean).join("\n");
  pricing = { at: Date.now(), key: region, text };
  return text;
}
