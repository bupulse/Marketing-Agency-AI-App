import { chosen } from "@/components/admin/kit";
import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { BRAND_PARTS, BrandView, type BrandPart } from "@/components/brand-profile/brand-view";
import { initialValues } from "@/components/brand-profile/initial";
import { isOwnLogoPath } from "@/lib/brand/schemas";
import { readMarketingProfile } from "@/lib/knowledge/interview";
import { placesKey } from "@/lib/places/google";
import { createSignedDownloadUrl } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { industryOptions } from "@/lib/industries/server";
import { industryFormValues } from "@/lib/industries/shared";

export const metadata = { title: "Brand" };

export default async function BrandPage({ searchParams }: PageProps<"/dashboard/brand">) {
  const blocked = await pageGate("settings");
  if (blocked) return blocked;
  const [{ business, businessName, user }, sp] = await Promise.all([getAppContext(), searchParams]);
  if (!business) return null;
  const part = chosen(sp, "part", BRAND_PARTS, "industry") as BrandPart;

  let savedLogoUrl: string | null = null;
  if (business.logoUrl && isOwnLogoPath(user.id, business.logoUrl)) {
    try {
      savedLogoUrl = await createSignedDownloadUrl("brand", business.logoUrl);
    } catch {
      // The logo is missing from storage; the card then shows the upload prompt.
    }
  }

  const sector = await prisma.business.findUnique({ where: { id: business.id }, select: { industryId: true, industryOther: true, industryDescription: true, industryRef: { select: { slug: true } } } });
  const industries = await industryOptions({ currentIndustryId: sector?.industryId });
  const context = { businessName, industry: business.industry, savedLogoUrl, country: business.country ?? "", timezone: business.timezone, placesEnabled: !!placesKey() };

  return (
    <BrandView
      part={part}
      params={sp}
      website={business.website}
      industryLabel={business.industry}
      industries={industries}
      industryInitial={industryFormValues(sector ?? {})}
      initial={initialValues(business)}
      context={context}
      contentLanguage={business.contentLanguage}
      hasMarketingProfile={Boolean(readMarketingProfile(business.marketingProfile))}
      knowledge={business.knowledge}
      onboarded={Boolean(business.onboardedAt)}
    />
  );
}
