import type { Metadata } from "next";
import { AgencySection } from "@/components/marketing/home/agency";
import { AvatarHero } from "@/components/marketing/home/avatar-hero";
import { AvatarVideos } from "@/components/marketing/home/avatar-videos";
import { BlogTeaser } from "@/components/marketing/home/blog-teaser";
import { Faq } from "@/components/marketing/home/faq";
import { Features } from "@/components/marketing/home/features";
import { FinalCta } from "@/components/marketing/home/final-cta";
import { HowItWorks } from "@/components/marketing/home/how-it-works";
import { IndustryCards, IndustryMarquee } from "@/components/marketing/home/industries";
import { PostShowcase } from "@/components/marketing/home/post-showcase";
import { SceneController } from "@/components/marketing/home/scene-controller";
import { ScrollWords } from "@/components/marketing/home/scroll-words";
import { ChatSection, DailyPostFacts, Numbers, PlansTeaser } from "@/components/marketing/home/sections";
import { Testimonials } from "@/components/marketing/home/testimonials";
import { WeekOfPosts } from "@/components/marketing/home/week-of-posts";
import { ctaModeForRegion } from "@/lib/quote/cta";
import { displayRegion } from "@/lib/region";
import { getRegionPlans } from "@/lib/region-prices";

// Per request: the plans follow the visitor's region (which plans include the chat and daily posts), the FAQ reads
// the trial length (an admin setting), and testimonials come from Admin (shown only when one is published).
// The home page tells the story; prices live on /pricing (owner, 11 November 2026).
export const dynamic = "force-dynamic";

const title = "BuPulse: daily posts, AI videos and a website chat for your business";
const description =
  "BuPulse makes a post for your business every day, designs it in your brand, creates short video ads with realistic AI presenters and answers your website visitors. Made for small businesses, Rwanda first.";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: "BuPulse", title, description, url: "/" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function HomePage() {
  const region = await displayRegion();
  const plans = await getRegionPlans(region.key, { withVat: true });
  const mode = ctaModeForRegion(region.key);
  return (
    <>
      {/* The light of the page: dark hero, night, deep blue, violet, then light (docs/design/front-page-motion.md). */}
      <SceneController />
      <AvatarHero />
      <ScrollWords text="Nobody stood in front of a camera. No studio, no actor, no editing. Just your business, told well, every day." />
      <AvatarVideos />
      <PostShowcase />
      <WeekOfPosts />
      <DailyPostFacts />
      <HowItWorks />
      <ChatSection plans={plans} />
      <AgencySection />
      <div data-scene="light">
        <IndustryMarquee />
        <IndustryCards />
        <Features />
      </div>
      <Numbers plans={plans} mode={mode} />
      <PlansTeaser />
      <div data-scene="light">
        <Testimonials />
        <Faq />
        <BlogTeaser />
        <FinalCta />
      </div>
    </>
  );
}
