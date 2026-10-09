import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { PlanComparison } from "@/components/marketing/pages/plan-comparison";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { Accordion, Button, Container, GlassCard, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { PricingPlans } from "./pricing-plans";
import { faqs, fillFaq } from "@/lib/content/site";
import { getSellablePlans, getTrialInfo, getTrialPlan, toPublic } from "@/lib/plan-catalog";

// Plans change in the admin console, so the page is rendered per request (the plan catalog is cached for 30 seconds).
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const days = (await getTrialInfo()).days;
  return pageMetadata({
    title: "Pricing",
    description: `Start free for ${days} days, no card needed. Then pick a paid plan, monthly or yearly with a discount. Marketing help for every small business.`,
    path: "/pricing",
  });
}

export default async function PricingPage() {
  const [sellable, trialPlan] = await Promise.all([getSellablePlans(), getTrialPlan()]);
  const plans = sellable.map(toPublic);
  const comparison = [toPublic(trialPlan), ...plans];
  const trial = { days: trialPlan.trialDays ?? 7, text: trialPlan.limits.text, images: trialPlan.limits.image };
  const pricingFaqs = fillFaq(faqs, trial.days).filter((f) => /trial|marketing experience|type of business|done-for-you/i.test(f.q));
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Simple pricing for every small business"
        text={`Try everything free for ${trial.days} days. No card needed. Pick a plan when you are ready to keep going.`}
      />

      <Container className="pb-16">
        <PricingPlans plans={plans} />
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted">
          Prices are in US dollars. Pay yearly and save. Cancel any time; your plan stays active until the end of the period you paid for. See our <Link href="/refund-policy" className="font-semibold text-[color:var(--bp-link)] underline">refund policy</Link>.
        </p>
      </Container>

      <Container size="narrow" className="pb-20">
        <Reveal>
          <GlassCard padding="lg" className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold tracking-tight">How the {trial.days}-day free trial works</h2>
            <p className="text-muted">
              Sign up and use BuPulse free for {trial.days} days. You get {trial.text} AI text generations and {trial.images} brand designs
              to try on your own business. There is no card to enter, and nothing is charged when the trial ends. If you do nothing, the
              trial simply stops. Your work stays saved so you can pick a plan and carry on.
            </p>
            <div>
              <Button href="/signup" trailing={<ArrowRight aria-hidden className="size-4" />}>
                Start free trial
              </Button>
            </div>
          </GlassCard>
        </Reveal>
      </Container>

      <Container className="pb-20">
        <SectionHeading title="Compare plans" text="Everything in each plan, side by side." className="mb-10" />
        <PlanComparison plans={comparison} />
      </Container>

      <Container size="narrow" className="pb-20">
        <Reveal>
          <GlassCard strong padding="lg" className="flex flex-col gap-4">
            <Sparkles aria-hidden className="size-8 text-pulse-violet" />
            <h2 className="text-2xl font-bold tracking-tight">Rather not do it yourself?</h2>
            <p className="text-muted">
              Our done-for-you service runs your social content and lead capture for you, using BuPulse, from $300 a month.
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
