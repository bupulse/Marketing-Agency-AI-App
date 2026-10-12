import "server-only";
import { prisma } from "@/lib/db";
import { readKnowledge, isOwnLogoPath } from "@/lib/brand/schemas";
import { hasFeature } from "@/lib/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { isHexColor, PULSE_BLUE, readableTextColor } from "@/lib/color-contrast";
import { industryContext } from "@/lib/industry-context";
import { quickActions } from "@/lib/business-info/contacts";
import type { BusinessFacts } from "./prompt";
import { defaultGreeting } from "./strings";

export interface PublicWidget {
  businessId: string;
  userId: string;
  key: string;
  /** Off when the owner switched it off, support locked it, the owner is suspended or deleting, or the plan lacks website chat. */
  enabled: boolean;
  /** False when the company's plan does not include website chat. The public config answers a neutral "unavailable" for it. */
  inPlan: boolean;
  name: string;
  logoPath: string | null;
  accent: string;
  accentText: string;
  position: "left" | "right";
  greeting: string;
  allowedDomains: string[];
  contentLanguage: string;
  /** WhatsApp and Call buttons in the chat header, from the business's contacts (wa.me and tel: links). */
  actions: { whatsapp?: string; call?: string };
  facts: Omit<BusinessFacts, "projects">;
}

export function resolveAccent(accentColor: string | null | undefined, brandColors: string[]): string {
  if (accentColor && isHexColor(accentColor)) return accentColor;
  return brandColors.find(isHexColor) ?? PULSE_BLUE;
}

/** The widget behind a public key, or null when the key is unknown or the widget was never set up. */
export async function loadPublicWidget(key: string): Promise<PublicWidget | null> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return null;
  const business = await prisma.business.findUnique({ where: { widgetKey: key }, include: { industryRef: true } });
  if (!business) return null;
  const widget = await prisma.chatWidget.findUnique({ where: { businessId: business.id } });
  if (!widget) return null;
  // A suspended or deleting owner's widget is unavailable: no AI replies and no new leads. So is the widget of a
  // company whose plan does not include website chat: it stops answering and collects nothing until it is added.
  const [owner, inPlan] = await Promise.all([
    prisma.user.findUnique({ where: { id: business.userId }, select: { suspendedAt: true, deletionScheduledFor: true } }),
    hasFeature(business.id, "websiteChat"),
  ]);
  const accent = resolveAccent(widget.accentColor, business.brandColors);
  const knowledge = readKnowledge(business.knowledge);
  return {
    businessId: business.id,
    userId: business.userId,
    key,
    enabled: widget.enabled && !widget.disabledByAdminAt && !owner?.suspendedAt && !owner?.deletionScheduledFor && inPlan,
    inPlan,
    name: business.name,
    logoPath: business.logoUrl && isOwnLogoPath(business.userId, business.logoUrl) ? business.logoUrl : null,
    accent,
    accentText: readableTextColor(accent),
    position: widget.position === "left" ? "left" : "right",
    greeting: widget.greeting?.trim() || defaultGreeting(business.contentLanguage, business.name),
    allowedDomains: widget.allowedDomains,
    contentLanguage: business.contentLanguage,
    actions: quickActions(knowledge.contacts),
    facts: {
      name: business.name,
      industry: business.industry,
      industryContext: industryContext(business),
      description: business.description,
      audience: business.audience,
      website: business.website,
      contentLanguage: business.contentLanguage,
      timezone: business.timezone,
      knowledge,
    },
  };
}

/** Recent projects and offers the assistant may mention: this business's rows only. */
export async function loadProjectFacts(businessId: string): Promise<BusinessFacts["projects"]> {
  const rows = await prisma.project.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { type: true, title: true, price: true, features: true },
  });
  return rows;
}

/** Signed URL for the logo (the brand bucket is private). A failure just means no logo. */
export async function signedLogoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const { data } = await createAdminClient().storage.from("brand").createSignedUrl(path, 6 * 60 * 60);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
