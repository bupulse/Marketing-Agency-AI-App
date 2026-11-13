import Link from "next/link";
import { Briefcase, Globe, MapPin, Mic, Palette, ShoppingBag } from "lucide-react";
import { ChoiceTiles, HashRedirect, KitStyles, PageHeader, SectionCard, SectionGrid } from "@/components/admin/kit";
import { CARD } from "@/components/admin/kit/tones";
import { BrandSection } from "@/components/brand-profile/brand-section";
import { IndustrySection } from "@/components/brand-profile/industry-section";
import type { StepContext } from "@/components/brand-profile/step-fields";
import type { BrandValues } from "@/components/brand-profile/steps";
import { EssentialsBanner } from "@/components/business-info/essentials-banner";
import { LanguageSection } from "@/components/studio/language-section";
import { getVoice } from "@/lib/brand/voices";
import type { IndustryFieldValues, IndustryOption } from "@/lib/industries/shared";

export const BRAND_PARTS = ["industry", "offer", "voice", "look"] as const;
export type BrandPart = (typeof BRAND_PARTS)[number];

/** Old #anchors on /dashboard/brand (emails, the quiz, bookmarks) open the part they pointed at. */
const OLD_ANCHORS: Record<string, string> = {
  "brand-industry": "/dashboard/brand?part=industry",
  "brand-offer": "/dashboard/brand?part=offer",
  "brand-voice": "/dashboard/brand?part=voice",
  "brand-language": "/dashboard/brand?part=voice",
  "brand-look": "/dashboard/brand?part=look",
  "brand-knowledge": "/dashboard/knowledge/locations",
};

/**
 * /dashboard/brand: pick one part (industry, what you sell, voice and language, logo and colours) from four cards and
 * edit only that part; each part saves on its own. Opening hours, address and phone live in Business info ->
 * Locations (the same editor), linked at the bottom. Presentational: the page passes the data in.
 */
export function BrandView({
  part,
  base = "/dashboard/brand",
  params,
  website,
  industryLabel,
  industries,
  industryInitial,
  initial,
  context,
  contentLanguage,
  hasMarketingProfile,
  knowledge,
  onboarded,
}: {
  part: BrandPart;
  base?: string;
  params?: Record<string, string | string[] | undefined>;
  website: string | null;
  industryLabel: string | null;
  industries: IndustryOption[];
  industryInitial: IndustryFieldValues;
  initial: BrandValues;
  context: StepContext;
  contentLanguage: string;
  hasMarketingProfile: boolean;
  knowledge: unknown;
  onboarded: boolean;
}) {
  const voice = getVoice(initial.tone);
  const colours = initial.brandColors.filter(Boolean).length;
  return (
    <>
      <KitStyles />
      <HashRedirect to={OLD_ANCHORS} />
      <PageHeader icon={Palette} tone="violet" title="Brand" description="How your posts look and sound. Pick a part to change it." />
      {onboarded && <EssentialsBanner knowledge={knowledge} />}

      <ChoiceTiles
        label="Part of your brand"
        param="part"
        base={base}
        params={params}
        current={part}
        allValue="industry"
        options={[
          { value: "industry", label: "Industry", hint: industryLabel || "Not set yet", icon: Briefcase, tone: "blue" },
          { value: "offer", label: "What you sell", hint: initial.description ? "Described" : "Not described yet", icon: ShoppingBag, tone: "indigo" },
          { value: "voice", label: "Voice & language", hint: `${voice?.label ?? "No voice yet"} · ${contentLanguage}`, icon: Mic, tone: "violet" },
          { value: "look", label: "Logo & colours", hint: `${initial.logoPath ? "Logo" : "No logo"} · ${colours} ${colours === 1 ? "colour" : "colours"}`, icon: Palette, tone: "pink" },
        ]}
      />

      <div key={part} className="kit-rise flex flex-col gap-6">
        {part === "industry" && <IndustrySection industries={industries} initial={industryInitial} />}
        {part === "offer" && <BrandSection step="offer" initial={initial} context={context} />}
        {part === "voice" && (
          <>
            {hasMarketingProfile && (
              <p className={`${CARD} p-4 text-[14px] sm:p-5`}>
                Your approved{" "}
                <Link href="/dashboard/knowledge/interview" className="font-semibold">
                  digital marketing profile
                </Link>{" "}
                sets the voice of every post; the voice below is only a fallback.
              </p>
            )}
            <BrandSection step="voice" initial={initial} context={context} />
            <LanguageSection initial={contentLanguage} />
          </>
        )}
        {part === "look" && <BrandSection step="look" initial={initial} context={context} />}
      </div>

      <SectionGrid>
        <SectionCard
        href="/dashboard/knowledge/locations"
        icon={MapPin}
        tone="teal"
        title="Hours, address and phone"
        hint="What your chat assistant tells customers. Now in Business info."
        row
        />
        <SectionCard href="/dashboard/settings?part=company" icon={Globe} tone="blue" title="Name, phone and website" hint={website ? `Website: ${website}` : "Your company details are in Settings."} row />
      </SectionGrid>
    </>
  );
}
