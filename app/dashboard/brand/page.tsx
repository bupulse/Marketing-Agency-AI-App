import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BrandSection } from "@/components/brand-profile/brand-section";
import { initialValues } from "@/components/brand-profile/initial";
import { LanguageSection } from "@/components/studio/language-section";
import { GlassCard } from "@/components/ui";
import { isOwnLogoPath } from "@/lib/brand/schemas";
import { createSignedDownloadUrl } from "@/lib/storage";

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

  const initial = initialValues(business);
  const context = { businessName, industry: business.industry, savedLogoUrl };
  const rows = [
    ["Business", businessName],
    ["Industry", business.industry],
    ["Website", business.website],
  ];

  return (
    <>
      <PageHeader title="Brand" description="Your voice, logo and colours. Everything BuPulse creates is based on this." />
      <GlassCard as="dl" className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="truncate text-[15px] font-medium">{value || "Not set yet"}</dd>
          </div>
        ))}
      </GlassCard>
      <BrandSection step="offer" initial={initial} context={context} />
      <BrandSection step="voice" initial={initial} context={context} />
      <LanguageSection initial={business.contentLanguage} />
      <BrandSection step="look" initial={initial} context={context} />
      <BrandSection step="knowledge" initial={initial} context={context} />
    </>
  );
}
