import type { Metadata } from "next";
import { AvatarHero } from "@/components/marketing/home/avatar-hero";
import { AvatarVideos } from "@/components/marketing/home/avatar-videos";
import { BlogTeaser } from "@/components/marketing/home/blog-teaser";
import { Faq } from "@/components/marketing/home/faq";
import { Features } from "@/components/marketing/home/features";
import { FinalCta } from "@/components/marketing/home/final-cta";
import { HowItWorks } from "@/components/marketing/home/how-it-works";
import { IndustryCards, IndustryMarquee } from "@/components/marketing/home/industries";
import { SceneTint } from "@/components/marketing/home/scene-tint";
import { ScrollWords } from "@/components/marketing/home/scroll-words";
import { ChatSection, DailyPostFacts, Numbers, PricingTeaser } from "@/components/marketing/home/sections";
import { Testimonials } from "@/components/marketing/home/testimonials";
import { WeekOfPosts } from "@/components/marketing/home/week-of-posts";
import { displayRegion } from "@/lib/region";
import { getRegionPlans } from "@/lib/region-prices";

// Per request: the plans and prices follow the visitor's region (the same ones the pricing page shows), the FAQ reads
// the trial length (an admin setting), and testimonials come from Admin (shown only when one is published).
export const dynamic = "force-dynamic";

const title = "BuPulse: daily posts, AI videos and a website chat for your business";
const description =
  "BuPulse makes a post for your business every day, creates short video ads with realistic AI presenters and answers your website visitors. Made for small businesses, Rwanda first. Get a free quote or start a free trial.";

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
  const plans = await getRegionPlans(region.key);
  return (
    <>
      <SceneTint />
      <AvatarHero />
      <ScrollWords text="Nobody stood in front of a camera. No studio, no actor, no editing. Just your business, told well, every day." />
      <AvatarVideos />
      <WeekOfPosts />
      <DailyPostFacts />
      <HowItWorks />
      <ChatSection plans={plans} />
      <IndustryMarquee />
      <IndustryCards />
      <Features />
      <Numbers plans={plans} />
      <PricingTeaser plans={plans} />
      <Testimonials />
      <Faq />
      <BlogTeaser />
      <FinalCta />
    </>
  );
}
