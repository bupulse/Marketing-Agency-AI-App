// How complete each Knowledge base section is, for the landing page cards. One small query set per page view.
import "server-only";
import { prisma } from "@/lib/db";
import { readKnowledge } from "@/lib/brand/schemas";
import { missingEssentials } from "@/lib/business-info/facts";
import { isHexColor } from "@/lib/color-contrast";
import { campaignPhase, dayString } from "./campaigns";
import { productReadiness } from "./products";
import { profileCompleteness } from "./profile";
import type { SectionKey, SectionProgress } from "./sections";

type BusinessRow = {
  id: string;
  name: string;
  website: string | null;
  industryId: string | null;
  industryOther: string | null;
  profile: unknown;
  knowledge: unknown;
  logoUrl: string | null;
  brandColors: string[];
  tone: string | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each ready section's percentage (null when a percentage would mean nothing) and a one-line summary. */
export async function knowledgeProgress(business: BusinessRow, today: string): Promise<Partial<Record<SectionKey, SectionProgress>>> {
  const [products, campaigns, channels] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: business.id, status: { not: "ARCHIVED" } },
      select: { summary: true, usps: true, priceModel: true, priceAmount: true, priceNote: true, _count: { select: { photos: true } } },
      take: 500,
    }),
    prisma.campaign.findMany({ where: { businessId: business.id, status: "ACTIVE" }, select: { startsAt: true, endsAt: true }, take: 300 }),
    prisma.connection.count({ where: { businessId: business.id, kind: "SOCIAL" } }),
  ]);

  const knowledge = readKnowledge(business.knowledge);
  const profile = profileCompleteness({ name: business.name, website: business.website, hasSector: !!(business.industryId || business.industryOther), profile: business.profile, serviceArea: knowledge.area });

  const ready = products.filter((p) => productReadiness({ ...p, photoCount: p._count.photos }).ready).length;
  const needs = products.length - ready;

  const phases = campaigns.map((c) => campaignPhase({ startsOn: dayString(c.startsAt), endsOn: dayString(c.endsAt) }, today));
  const running = phases.filter((p) => p === "running" || p === "undated").length;
  const upcoming = phases.filter((p) => p === "upcoming").length;

  const missing = missingEssentials(knowledge);
  const essentials = [!missing.hours, !missing.location, !missing.phone];
  const brand = [!!business.logoUrl, business.brandColors.some(isHexColor), !!business.tone];

  return {
    profile: { percent: profile.percent, summary: profile.missing.length ? `Add your ${profile.missing.slice(0, 2).join(" and ")}` : "Complete" },
    products: {
      percent: products.length ? Math.round((ready / products.length) * 100) : 0,
      summary: products.length ? `${plural(products.length, "item")}${needs ? ` · ${needs} need${needs === 1 ? "s" : ""} details` : " · all ready"}` : "Add what you sell",
    },
    campaigns: { percent: null, summary: campaigns.length ? [running && `${running} on now`, upcoming && `${upcoming} upcoming`].filter(Boolean).join(" · ") || "None running" : "None yet" },
    locations: {
      percent: Math.round((essentials.filter(Boolean).length / 3) * 100),
      summary: essentials.every(Boolean) ? "Hours, location and phone added" : `Add your ${[missing.hours && "opening hours", missing.location && "main location", missing.phone && "phone"].filter(Boolean).join(", ")}`,
    },
    brand: { percent: Math.round((brand.filter(Boolean).length / 3) * 100), summary: brand.every(Boolean) ? "Logo, colours and voice set" : `Add your ${[!brand[0] && "logo", !brand[1] && "colours", !brand[2] && "voice"].filter(Boolean).join(", ")}` },
    channels: { percent: channels > 0 ? 100 : 0, summary: channels ? `${plural(channels, "account")} connected` : "Connect a social account" },
  };
}
