import { notFound } from "next/navigation";
import { Bot, Images, Palette, Sparkles } from "lucide-react";
import { ChoiceTiles, FilterChips, PageHeader } from "@/components/admin/kit";
import { AppShell } from "@/components/app/app-shell";
import { createActions } from "@/components/app/nav";
import { HomeView, type HomeViewData } from "@/components/app/views/a-home-view";
import { PostsView } from "@/components/app/views/a-posts-view";
import { SettingsCard } from "@/components/autopilot/settings-card";
import { CreateDayContent } from "@/components/content-flow/create-day-dialog";
import { UniqueAds } from "@/components/designs/unique-ads";
import { DEFAULT_CONFIG } from "@/lib/autopilot/settings";
import { FEATURE_KEYS } from "@/lib/features";
import { previewAllowed } from "@/lib/support/preview";

export const metadata = { title: "Dashboard preview", robots: { index: false, follow: false } };

const SCREENS = ["home", "posts", "create", "designs", "autopilot"] as const;
type Screen = (typeof SCREENS)[number];

const FEATURES = [...FEATURE_KEYS];

const HOME: HomeViewData = {
  firstName: "Aline",
  businessName: "Kigali Coffee Roasters",
  logoUrl: null,
  swatches: ["#6b3e26", "#e8b04b", "#1f2937"],
  voiceLabel: "Friendly",
  canEditBrand: true,
  checklist: [
    { label: "Complete your brand profile", done: true, href: "/dashboard/brand", ask: null },
    { label: "Connect a social account", done: false, href: "/dashboard/connections", ask: null },
    { label: "Add your first product or service", done: true, href: "/dashboard/knowledge/products", ask: null },
    { label: "Install the chat widget", done: false, href: "/dashboard/widget", ask: null },
  ],
  counts: { products: 12, content: 86, leads: 9, designs: 31 },
  recentProducts: [
    { id: "p1", name: "House blend, 500 g", line: "Product · 9,000 RWF" },
    { id: "p2", name: "Barista class", line: "Service · 25,000 RWF" },
    { id: "p3", name: "Office coffee delivery", line: "Service · On request" },
  ],
  recentLeads: [
    { id: "l1", name: "Jean Claude", line: "Wants 10 kg for an office · 2 h ago" },
    { id: "l2", name: "visitor@example.com", line: "Asked about the barista class · Yesterday" },
  ],
  meters: [
    { label: "Text generations", value: 132, max: 300 },
    { label: "AI image credits", value: 18, max: 60 },
    { label: "Videos", value: 2, max: 8 },
    { label: "Voice characters", value: 0, max: 0 },
  ],
  planEnded: false,
  actions: createActions("OWNER", FEATURES, null),
};

/**
 * Development only: the redesigned client pages (Home, Posts, the Create post dialog, Designs' "Make ads" tab and
 * Autopilot's settings) in the real client shell with made-up data, no sign-in and no database, for checking the
 * design in a browser. /dashboard-preview, /dashboard-preview/posts, /dashboard-preview/create?create=1,
 * /dashboard-preview/designs, /dashboard-preview/autopilot. Nothing is saved (buttons that would save fail). Not found
 * in production.
 */
export default async function DashboardPreview({ params }: PageProps<"/dashboard-preview/[[...screen]]">) {
  if (!previewAllowed()) notFound();
  const which = ((await params).screen?.[0] ?? "home") as Screen;
  if (!SCREENS.includes(which)) notFound();

  return (
    <AppShell
      brand={{ logoUrl: null, colors: ["#2f6bff", "#7b5cff", "#0b0b0f"], hasColors: false }}
      displayName="Aline Uwase"
      firstName="Aline"
      email="owner@example.com"
      businessName="Kigali Coffee Roasters"
      plan={{ name: "Growth", trialLabel: null, used: 132, max: 300 }}
      role="OWNER"
      features={FEATURES}
    >
      {which === "home" && <HomeView data={HOME} />}
      {which === "posts" && <PostsView data={{ autoCount: 2, total: 86, subjects: 7, generalTotal: 14, calendar: true, nothingYet: false }} />}
      {which === "create" && (
        <>
          <PageHeader icon={Sparkles} tone="violet" title="General posts" description="Posts about your business as a whole." back={{ href: "/dashboard-preview/posts", label: "Posts" }} actions={<CreatePreview />} />
          <p className="px-1 text-[14px] text-muted">Open with ?create=1 to see the dialog open by itself (the + Create menu&apos;s New post).</p>
        </>
      )}
      {which === "designs" && (
        <>
          <PageHeader icon={Palette} tone="pink" title="Designs" description="Unique AI ads made from your products, and every picture BuPulse made for you." />
          <ChoiceTiles
            label="Designs"
            param="tab"
            base="/dashboard-preview/designs"
            current="make"
            allValue="make"
            className="max-w-2xl [&_ul]:grid-cols-2"
            options={[
              { value: "make", label: "Make ads", hint: "New AI ads from your products.", icon: Sparkles, tone: "violet" },
              { value: "mine", label: "Your designs", hint: "Every picture made for you.", icon: Images, tone: "blue" },
            ]}
          />
          <section className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5 px-1">
              <h2 className="text-[16px] font-bold tracking-[-0.01em]">Make ads for</h2>
              <p className="text-[13px] text-muted">Pick a product or campaign: its name, price and photos go into the ads.</p>
            </div>
            <FilterChips
              label="Make ads for"
              param="for"
              base="/dashboard-preview/designs"
              current=""
              options={[{ value: "", label: "Nothing in particular" }, ...HOME.recentProducts.map((p) => ({ value: p.id, label: p.name })), { value: "c1", label: "Christmas offer" }]}
            />
          </section>
          <UniqueAds subjectId={null} subjectName={null} credits={{ used: 18, limit: 60 }} />
        </>
      )}
      {which === "autopilot" && (
        <>
          <PageHeader icon={Bot} tone="violet" title="Autopilot" description="AI plans your week of posts. You approve them in one tap." />
          <div className="max-w-[420px]">
            <SettingsCard
              initial={{ ...DEFAULT_CONFIG, enabled: true, connectionIds: ["a1"] }}
              accounts={[
                { id: "a1", network: "instagram", label: "Instagram", displayName: "kigalicoffee", avatarUrl: null, usable: true },
                { id: "a2", network: "facebook", label: "Facebook Page", displayName: "Kigali Coffee Roasters", avatarUrl: null, usable: true },
              ]}
              timeZone="Africa/Kigali"
            />
          </div>
        </>
      )}
    </AppShell>
  );
}

function CreatePreview() {
  return (
    <CreateDayContent
      scope={{ kind: "general" }}
      path="/dashboard-preview/create"
      subjectName="Kigali Coffee Roasters"
      networks={[
        { network: "instagram", label: "Instagram", connected: true },
        { network: "facebook", label: "Facebook", connected: true },
        { network: "linkedin", label: "LinkedIn", connected: false },
        { network: "tiktok", label: "TikTok", connected: false },
      ]}
      allowance={{ textLeft: 168, imagesLeft: 42, aiPhotos: true, videoInPlan: true, videosLeft: 6, voice: false, voiceCharsLeft: 0, postsPerApp: 3 }}
      openOnAsk
    />
  );
}
