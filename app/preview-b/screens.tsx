// Made-up data for the client preview (app/preview-b, development only). Placeholder names, numbers and links only.
import type { ReactNode } from "react";
import { KnowledgeHub, type HubSection } from "@/components/knowledge/knowledge-hub";
import { KNOWLEDGE_SECTIONS, toReachFull, type SectionProgress, type SectionKey } from "@/lib/knowledge/sections";
import type { QuizEntry } from "@/lib/knowledge/quiz-entry";
import { ProfileForm } from "@/components/knowledge/profile-form";
import { QuizLink } from "@/components/knowledge/quiz-link";
import { SectionHeader } from "@/components/knowledge/section-header";
import { profileFormValues } from "@/lib/knowledge/profile";
import { BRAND_PARTS, BrandView, type BrandPart } from "@/components/brand-profile/brand-view";
import { initialValues } from "@/components/brand-profile/initial";
import { chosen, KitStyles, PageHeader } from "@/components/admin/kit";
import { SETTINGS_PARTS, SettingsView, type SettingsPart } from "@/components/settings/settings-view";
import { TeamManager } from "@/components/team/team-manager";
import { Users } from "lucide-react";

const INDUSTRIES = [
  { slug: "bakery", name: "Bakery and pastry" },
  { slug: "restaurant", name: "Restaurant and café" },
  { slug: "fashion", name: "Fashion and clothing" },
  { slug: "beauty", name: "Beauty and salon" },
];

type Sp = Record<string, string | string[] | undefined>;

const PROGRESS: Partial<Record<SectionKey, SectionProgress>> = {
  profile: { percent: 80, summary: "Mission and values to add", next: "Add your mission" },
  products: { percent: 60, summary: "12 products · 5 without photos", next: "Add photos to 5 products" },
  campaigns: { percent: 100, summary: "2 campaigns coming up" },
  locations: { percent: 50, summary: "1 location · hours missing", next: "Add your opening hours" },
  brand: { percent: 100, summary: "Logo and 3 colours" },
  channels: { percent: 40, summary: "2 of 5 channels connected", next: "Connect TikTok" },
  audience: { percent: 30, summary: "1 customer type", next: "Describe what your customers need" },
  competitors: { percent: 0, summary: "Nothing yet", next: "Add 2 competitors" },
  faqs: { percent: 70, summary: "8 answers" },
  reviews: { percent: 20, summary: "1 review", next: "Add 2 more reviews" },
  interview: { percent: null, summary: "Not started" },
};

function knowledge(): ReactNode {
  const entry: QuizEntry = { progress: PROGRESS, overall: 55, playable: true, href: "/dashboard/knowledge/quiz?round=you", label: "Continue", nextRound: { emoji: "🏪", title: "About you" }, done: false };
  const sections: HubSection[] = KNOWLEDGE_SECTIONS.map((s) => ({
    key: s.key,
    title: s.title,
    description: s.description,
    href: s.href,
    soon: s.status === "coming_soon",
    lock: s.key === "interview" ? "add" : null,
    percent: PROGRESS[s.key]?.percent ?? null,
    summary: PROGRESS[s.key]?.summary,
  }));
  return <KnowledgeHub entry={entry} sections={sections} todos={toReachFull(PROGRESS, () => true, 4)} />;
}

function profile(): ReactNode {
  const initial = profileFormValues(
    { name: "Kigali Fresh Bakery", website: "example.com", description: "A family bakery in Kimironko. Bread, cakes and pastries baked every morning.", profile: { tagline: "Fresh bread every morning", values: ["Quality"], size: "6-20", languages: ["Kinyarwanda", "English"] }, knowledgeArea: "Kigali" },
    { industry: "bakery", industryOther: "", industryDescription: "We bake bread, cakes and pastries for homes and offices in Kigali." },
  );
  return (
    <>
      <SectionHeader section="profile" title="Company profile" description="Who you are, in your own words. BuPulse uses this in every post, plan and chat reply." action={<QuizLink round="you" />} />
      <ProfileForm industries={INDUSTRIES} initial={initial} />
    </>
  );
}

function brand(sp: Sp): ReactNode {
  const part = chosen(sp, "part", BRAND_PARTS, "industry") as BrandPart;
  const initial = initialValues({ description: "Bread, cakes and pastries baked every morning in Kimironko.", audience: null, tone: "friendly", logoUrl: null, brandColors: ["#C2410C", "#FDE68A", "#1F2937"], knowledge: {}, country: "Rwanda", phone: null });
  return (
    <BrandView
      part={part}
      base="/preview-b/brand"
      params={sp}
      website="example.com"
      industryLabel="Bakery and pastry"
      industries={INDUSTRIES}
      industryInitial={{ industry: "bakery", industryOther: "", industryDescription: "We bake bread, cakes and pastries for homes and offices in Kigali." }}
      initial={initial}
      context={{ businessName: "Kigali Fresh Bakery", industry: "Bakery and pastry", savedLogoUrl: null, country: "Rwanda", timezone: "Africa/Kigali", placesEnabled: false }}
      contentLanguage="English"
      hasMarketingProfile
      knowledge={{}}
      onboarded
    />
  );
}

function settings(sp: Sp): ReactNode {
  const part = chosen(sp, "part", SETTINGS_PARTS, "you") as SettingsPart;
  return (
    <SettingsView
      part={part}
      base="/preview-b/settings"
      params={sp}
      profile={{ name: "Aline Uwase", email: "aline@example.com", signInMethod: "Email and password" }}
      business={{ country: "Rwanda", industryLabel: "Bakery and pastry", defaults: { organisationName: "Kigali Fresh Bakery", ceoName: "Aline Uwase", phone: "788 000 000", phoneCountry: "RW", website: "example.com" } }}
      team={{ role: "OWNER", canManage: true, members: 3 }}
      remove={{ email: "aline@example.com", wholeCompany: true, teammates: 2 }}
    />
  );
}

function team(): ReactNode {
  const now = new Date("2026-11-12T10:00:00Z").toISOString();
  return (
    <>
      <KitStyles />
      <PageHeader icon={Users} tone="indigo" title="Team" description="Invite colleagues. Everyone shares the same posts, designs, leads, channels and credits." back={{ href: "/preview-b/settings?part=team", label: "Settings" }} />
      <TeamManager
        me="u1"
        role="OWNER"
        limit={5}
        alertsOn={false}
        history={[{ id: "h1", at: now, text: "Aline Uwase invited eric@example.com as member" }]}
        members={[
          { userId: "u1", role: "OWNER", email: "aline@example.com", name: "Aline Uwase", joinedAt: now, isCompanyAccount: false },
          { userId: "u2", role: "ADMIN", email: "jean@example.com", name: "Jean Mugisha", joinedAt: now, isCompanyAccount: false },
        ]}
        invites={[{ id: "i1", email: "eric@example.com", role: "MEMBER", expiresAt: now, createdAt: now, expired: false }]}
      />
    </>
  );
}

export const PREVIEW_B_SCREENS: Record<string, (sp: Sp) => ReactNode | Promise<ReactNode>> = {
  knowledge,
  "knowledge/profile": profile,
  brand,
  settings,
  "settings/team": team,
};
