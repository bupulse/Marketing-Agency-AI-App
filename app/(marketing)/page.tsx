import type { Metadata } from "next";
import { BlogTeaser } from "@/components/marketing/home/blog-teaser";
import { Faq } from "@/components/marketing/home/faq";
import { Features } from "@/components/marketing/home/features";
import { FinalCta } from "@/components/marketing/home/final-cta";
import { Hero } from "@/components/marketing/home/hero";
import { HowItWorks } from "@/components/marketing/home/how-it-works";
import { IndustryCards, IndustryMarquee } from "@/components/marketing/home/industries";
import { Testimonials } from "@/components/marketing/home/testimonials";

// The FAQ reads the trial length, an admin setting; testimonials come from Admin (shown only when one is published).
export const dynamic = "force-dynamic";

const title = "BuPulse: the marketing team for every small business";
const description =
  "Tell BuPulse about your business once. It writes your posts, designs your graphics and chats with your website visitors. Book a free demo to see it on your own business.";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: "BuPulse", title, description, url: "/" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <IndustryMarquee />
      <IndustryCards />
      <Features />
      <HowItWorks />
      <Testimonials />
      <Faq />
      <BlogTeaser />
      <FinalCta />
    </>
  );
}
