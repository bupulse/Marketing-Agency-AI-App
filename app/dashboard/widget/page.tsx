import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { WidgetSettings } from "@/components/widget/widget-settings";
import { siteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { resolveAccent } from "@/lib/widget/config";
import { defaultAllowedDomains } from "@/lib/widget/origin";
import { defaultGreeting } from "@/lib/widget/strings";
import { installSnippet } from "@/lib/widget/settings";
import { isHexColor } from "@/lib/color-contrast";

export const metadata = { title: "Website chat" };

export default async function WidgetPage() {
  const { business, usage } = await getAppContext();
  if (!business) return null;
  // Created on the first visit, so the embed key works as soon as the owner copies it. It starts limited to the
  // business's own website, so nobody else can embed it and use up its chat replies.
  const widget = await prisma.chatWidget.upsert({ where: { businessId: business.id }, create: { businessId: business.id, allowedDomains: defaultAllowedDomains(business.website) }, update: {} });

  return (
    <>
      <PageHeader title="Website chat" description="A chat bubble for your website that answers visitors from your business facts and collects their details as leads." />
      <WidgetSettings
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
        widgetKey={business.widgetKey}
        snippet={installSnippet(siteUrl(), business.widgetKey)}
        usage={{ used: usage.used.chat, limit: usage.limits.chat }}
      />
    </>
  );
}
