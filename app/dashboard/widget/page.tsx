import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { WidgetScreen, greetingIdeasFor } from "@/components/widget/widget-screen";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { resolveAccent } from "@/lib/widget/config";
import { defaultAllowedDomains } from "@/lib/widget/origin";
import { defaultGreeting } from "@/lib/widget/strings";
import { isHexColor } from "@/lib/color-contrast";

export const metadata = { title: "Website chat" };

export default async function WidgetPage() {
  const blocked = (await pageGate("widget")) ?? (await featureGate("websiteChat"));
  if (blocked) return blocked;
  const { business, usage } = await getAppContext();
  if (!business) return null;
  // Created on the first visit, so the embed key works as soon as the owner copies it. It starts limited to the
  // business's own website, so nobody else can embed it and use up its chat replies.
  const widget = await prisma.chatWidget.upsert({ where: { businessId: business.id }, create: { businessId: business.id, allowedDomains: defaultAllowedDomains(business.website) }, update: {} });

  return (
    <WidgetScreen
      initial={{
        enabled: widget.enabled,
        greeting: widget.greeting ?? "",
        position: widget.position === "left" ? "left" : "right",
        accentColor: widget.accentColor ?? "",
        allowedDomains: widget.allowedDomains,
      }}
      defaultGreeting={defaultGreeting(business.contentLanguage, business.name)}
      defaultAccent={resolveAccent(null, business.brandColors)}
      brandColors={business.brandColors.filter(isHexColor)}
      lockedBySupport={Boolean(widget.disabledByAdminAt)}
      widgetKey={business.widgetKey}
      baseUrl={publicSiteUrl()}
      usage={{ used: usage.used.chat, limit: usage.limits.chat }}
      greetingIdeas={greetingIdeasFor(business.contentLanguage)}
      suggestedDomains={defaultAllowedDomains(business.website)}
    />
  );
}
