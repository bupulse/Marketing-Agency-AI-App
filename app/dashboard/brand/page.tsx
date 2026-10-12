import Link from "next/link";
import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BrandSection } from "@/components/brand-profile/brand-section";
import { EssentialsBanner } from "@/components/business-info/essentials-banner";
import { IndustrySection } from "@/components/brand-profile/industry-section";
import { initialValues } from "@/components/brand-profile/initial";
import { LanguageSection } from "@/components/studio/language-section";
import { GlassCard } from "@/components/ui";
import { isOwnLogoPath } from "@/lib/brand/schemas";
import { readMarketingProfile } from "@/lib/knowledge/interview";
import { placesKey } from "@/lib/places/google";
import { createSignedDownloadUrl } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { industryOptions } from "@/lib/industries/server";
import { industryFormValues } from "@/lib/industries/shared";

export const metadata = { title: "Brand" };

export default async function BrandPage() {
  const blocked = await pageGate("settings");
  if (blocked) return blocked;
  const { business, businessName, user } = await getAppContext();
  if (!business) return null;

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
  const initial = initialValues(business);
  const context = { businessName, industry: business.industry, savedLogoUrl, country: business.country ?? "", timezone: business.timezone, placesEnabled: !!placesKey() };
  const rows = [
    ["Business", businessName],
    ["Industry", business.industry],
    ["Website", business.website],
  ];

  return (
    <>
      <PageHeader title="Brand" description="Your voice, logo and colours. Everything BuPulse creates is based on this." />
      {business.onboardedAt && <EssentialsBanner knowledge={business.knowledge} href="#brand-knowledge" />}
      <GlassCard as="dl" className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="truncate text-[15px] font-medium">{value || "Not set yet"}</dd>
          </div>
        ))}
      </GlassCard>
      <IndustrySection industries={industries} initial={industryFormValues(sector ?? {})} />
      <BrandSection step="offer" initial={initial} context={context} />
      {readMarketingProfile(business.marketingProfile) && (
        <GlassCard className="p-5 text-[15px]">
          Your approved{" "}
          <Link href="/dashboard/knowledge/interview" className="font-semibold">
            digital marketing profile
          </Link>{" "}
          sets the voice of every post; the preset below is only a fallback.
        </GlassCard>
      )}
      <BrandSection step="voice" initial={initial} context={context} />
      <LanguageSection initial={business.contentLanguage} />
      <BrandSection step="look" initial={initial} context={context} />
      <BrandSection step="knowledge" initial={initial} context={context} />
    </>
  );
}
