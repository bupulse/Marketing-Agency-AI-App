import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BrandSection } from "@/components/brand-profile/brand-section";
import { initialValues } from "@/components/brand-profile/initial";
import { EssentialsBanner } from "@/components/business-info/essentials-banner";
import { BackLink } from "@/components/knowledge/back-link";
import { placesKey } from "@/lib/places/google";

export const metadata = { title: "Locations, hours & contacts" };

/** The same business info editor as Brand -> "Help your chat assistant" (docs/BUSINESS_INFO.md), in the Knowledge base. */
export default async function LocationsPage() {
  const blocked = await pageGate("settings");
  if (blocked) return blocked;
  const { business, businessName } = await getAppContext();
  const context = { businessName, industry: business.industry, savedLogoUrl: null, country: business.country ?? "", timezone: business.timezone, placesEnabled: !!placesKey() };
  return (
    <>
      <BackLink />
      <PageHeader title="Locations, hours & contacts" description="Where to find you, when you are open and how to reach you. Your chat assistant and your posts use these." />
      <EssentialsBanner knowledge={business.knowledge} href="#brand-knowledge" />
      <BrandSection step="knowledge" initial={initialValues(business)} context={context} />
    </>
  );
}
