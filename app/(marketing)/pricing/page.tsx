import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { PlanComparison } from "@/components/marketing/pages/plan-comparison";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { Accordion, Badge, Button, Container, GlassCard, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { MomoSteps } from "./momo-steps";
import { PlanQuiz } from "./plan-quiz";
import { PricingPlans } from "./pricing-plans";
import { UseMyLocation } from "./use-my-location";
import { faqs, fillFaq } from "@/lib/content/site";
import { getSetting } from "@/lib/admin/settings";
import { geoLookupAvailable } from "@/lib/geo/availability";
import { displayRegionWithOverride } from "@/lib/region";
import { currencyNote, paymentBadges } from "@/lib/region-format";
import { getRegionPlans } from "@/lib/region-prices";

// Plans and prices depend on where the visitor is (lib/region.ts) and change in the admin console, so the page is
// rendered per request (the plan, price and region catalogs are cached for 30 seconds).
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Pricing",
  description: "Simple plans priced for where you are. Book a free demo, try your plan free, then pay monthly or yearly with a discount. Marketing help for every small business.",
  path: "/pricing",
});

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ region?: string | string[] }> }) {
  const sp = await searchParams;
  // ?region= only counts when REGION_OVERRIDE=1 (local development); see lib/region.ts.
  const region = await displayRegionWithOverride(sp.region);
  const [plans, trialDays, canLocate] = await Promise.all([getRegionPlans(region.key), getSetting("trialDays"), geoLookupAvailable()]);
  const days = `${trialDays} ${trialDays === 1 ? "day" : "days"}`;
  const pricingFaqs = fillFaq(faqs, trialDays).filter((f) => /get started|marketing experience|type of business|done-for-you/i.test(f.q));
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Simple pricing for every small business"
        text={`Prices for ${region.name}. Book a free demo, try your plan free for ${days}, then pay monthly or yearly. No card needed to start.`}
      />

      <Container className="pb-16">
        {canLocate && <UseMyLocation />}
        {paymentBadges(region.paymentMethods).length > 0 && (
          <ul aria-label="Ways to pay" className="m-0 mb-6 flex list-none flex-wrap items-center justify-center gap-2 p-0">
            {paymentBadges(region.paymentMethods).map((name) => (
              <li key={name}>
                <Badge tone="neutral">{name}</Badge>
              </li>
            ))}
          </ul>
        )}
        <PricingPlans plans={plans} />
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted">
          {currencyNote(region.currency, region.paymentMethods)} Cancel any time; your plan stays active until the end of the period you paid for. See our{" "}
          <Link href="/refund-policy" className="font-semibold text-[color:var(--bp-link)] underline">refund policy</Link>.
        </p>
      </Container>

      {plans.length > 0 && (
        <Container size="narrow" className="flex flex-col gap-6 pb-20">
          <PlanQuiz plans={plans} />
          <MomoSteps plans={plans} paymentMethods={region.paymentMethods} />
        </Container>
      )}

      <Container size="narrow" className="pb-20">
        <Reveal>
          <GlassCard padding="lg" className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
            <ol className="flex flex-col gap-2 text-muted">
              <li><strong className="text-text">1. Sign up and choose a plan.</strong> Tell us about your business in a few minutes.</li>
              <li><strong className="text-text">2. Book a free demo.</strong> A short video call where we show BuPulse on your own business and answer your questions.</li>
              <li><strong className="text-text">3. Try it free for {days}.</strong> Right after the demo, with everything your plan includes. No card needed.</li>
              <li><strong className="text-text">4. Keep going.</strong> Pay to continue. If you do nothing, nothing is charged and your work stays saved.</li>
            </ol>
            <div>
              <Button href="/signup" trailing={<ArrowRight aria-hidden className="size-4" />}>
                Book a free demo
              </Button>
            </div>
          </GlassCard>
        </Reveal>
      </Container>

      <Container size="narrow" className="pb-20">
        <Reveal>
          <GlassCard padding="lg" className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Need something different?</h2>
            <p className="text-muted">
              Only some features, more posts, website chat or Autopilot on top of a plan, or the BuPulse team running it for you: request a custom plan. Sign up first (it takes a few minutes; already have an account? you go straight to the form), tell us what you need, and we talk it through in your free demo and send you an offer.
            </p>
            <div>
              <Button href={`/signup?next=${encodeURIComponent("/custom-plan?from=pricing")}`} variant="outline" trailing={<ArrowRight aria-hidden className="size-4" />}>
                Request a custom plan
              </Button>
            </div>
          </GlassCard>
        </Reveal>
      </Container>

      {plans.length > 1 && (
        <Container className="pb-20">
          <SectionHeading title="Compare plans" text="Everything in each plan, side by side." className="mb-10" />
          <PlanComparison plans={plans} trialDays={trialDays} />
        </Container>
      )}

      <Container size="narrow" className="pb-20">
        <Reveal>
          <GlassCard strong padding="lg" className="flex flex-col gap-4">
            <Sparkles aria-hidden className="size-8 text-pulse-violet" />
            <h2 className="text-2xl font-bold tracking-tight">Rather not do it yourself?</h2>
            <p className="text-muted">
              Our done-for-you service runs your social content and lead capture for you, using BuPulse. Ask about it on your demo call.
            </p>
            <div>
              <Button href="/done-for-you" variant="outline">
                See done-for-you
              </Button>
            </div>
          </GlassCard>
        </Reveal>
      </Container>

      <Container size="narrow" className="pb-24">
        <SectionHeading title="Pricing questions" className="mb-10" />
        <Accordion items={pricingFaqs.map((f) => ({ question: f.q, answer: f.a }))} />
      </Container>
    </>
  );
}
