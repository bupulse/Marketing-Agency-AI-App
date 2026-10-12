// The Knowledge base sections, as data: the landing page (/dashboard/knowledge) renders one card per entry, in order.
// Pure, so tests and later parts can extend it. To add a section: set `status: "ready"` and its `href`, give it an icon
// in components/knowledge/section-icons.ts, and add its completeness to knowledgeProgress() (lib/knowledge/overview.ts).

import type { FeatureKey } from "@/lib/features";
import type { Permission } from "@/lib/team/roles";

export const SECTION_KEYS = [
  "profile",
  "products",
  "campaigns",
  "locations",
  "brand",
  "channels",
  "audience",
  "competitors",
  "faqs",
  "reviews",
  "interview",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type KnowledgeSection = {
  key: SectionKey;
  title: string;
  description: string;
  href: string;
  /** "coming_soon" cards show without a link. */
  status: "ready" | "coming_soon";
  /** The plan feature the section's pages need (the card says "Add to your plan" without it). */
  feature?: FeatureKey;
  /** The role permission needed to edit; others may still look where the page allows. */
  permission?: Permission;
  /** Lives elsewhere in the app; the card links there. */
  external?: boolean;
};

export const KNOWLEDGE_BASE_HREF = "/dashboard/knowledge";

export const KNOWLEDGE_SECTIONS: readonly KnowledgeSection[] = [
  { key: "profile", title: "Company profile", description: "Who you are: what you do, your sector, mission, values and story.", href: "/dashboard/knowledge/profile", status: "ready", permission: "settings" },
  { key: "products", title: "Products & services", description: "Everything you sell, with prices, reasons to buy and photos.", href: "/dashboard/knowledge/products", status: "ready", feature: "content", permission: "content" },
  { key: "campaigns", title: "Campaigns", description: "Events, offers, promotions and launches, with dates and products.", href: "/dashboard/knowledge/campaigns", status: "ready", feature: "content", permission: "content" },
  { key: "locations", title: "Locations, hours & contacts", description: "Where to find you, when you are open and how to reach you.", href: "/dashboard/knowledge/locations", status: "ready", permission: "settings" },
  { key: "brand", title: "Brand look", description: "Your logo and colours, used in every design.", href: "/dashboard/brand#brand-look", status: "ready", permission: "settings", external: true },
  { key: "channels", title: "Channels", description: "The social accounts BuPulse posts to.", href: "/dashboard/connections", status: "ready", permission: "channels", external: true },
  { key: "audience", title: "Customers & audience", description: "Who buys from you, what they need and how they decide.", href: "/dashboard/knowledge/audience", status: "ready", permission: "content" },
  { key: "competitors", title: "Competitors & what makes you different", description: "Who else customers consider, and why they choose you.", href: "/dashboard/knowledge/competitors", status: "ready", permission: "content" },
  { key: "faqs", title: "FAQs & policies", description: "Answers to common questions, returns, delivery and payment rules.", href: "/dashboard/knowledge/faqs", status: "ready", permission: "content" },
  { key: "reviews", title: "Reviews & testimonials", description: "What customers say about you, to quote in posts.", href: "/dashboard/knowledge/reviews", status: "ready", permission: "content" },
  { key: "interview", title: "Digital marketing profile", description: "A short AI interview that sets your brand voice.", href: "/dashboard/knowledge/interview", status: "ready", permission: "settings" },
];

export function sectionByKey(key: SectionKey): KnowledgeSection {
  return KNOWLEDGE_SECTIONS.find((s) => s.key === key)!;
}

export type SectionProgress = { percent: number | null; summary: string };

/** The overall score: the average of the ready sections that report a percentage. */
export function overallPercent(progress: Partial<Record<SectionKey, SectionProgress>>): number {
  const values = KNOWLEDGE_SECTIONS.filter((s) => s.status === "ready").flatMap((s) => {
    const p = progress[s.key]?.percent;
    return typeof p === "number" ? [p] : [];
  });
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}
