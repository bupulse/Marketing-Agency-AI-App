import { Building2, HandCoins, Link2, Smartphone } from "lucide-react";
import { Reveal } from "@/components/motion";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { Container, GlassCard, SectionHeading } from "@/components/ui";
import { EARN_MONTHS, HOLD_DAYS, QUALIFY_DAYS, TIERS } from "@/lib/partners/commission";
import { PartnerForm } from "./partner-form";

export const metadata = pageMetadata({
  title: "Partner programme",
  description: "Agencies, co-working spaces, MoMo agents and BuPulse clients: refer businesses to BuPulse and earn a commission on every payment for a year, paid by Mobile Money.",
  path: "/partners",
});

const who = [
  { icon: Building2, title: "Agencies and co-working spaces", text: "Offer BuPulse to your clients and members, and earn on what they pay." },
  { icon: Smartphone, title: "MoMo agents and merchants", text: "You know every shop on your street. Show them BuPulse and earn every month." },
  { icon: HandCoins, title: "Happy clients and consultants", text: "Recommend BuPulse to the businesses you know." },
];

/** "20% for your first 5 paying clients, 25% from the 6th, 30% from the 21st", from the code's own tiers. */
function tierText(i: number): string {
  const t = TIERS[i];
  const next = TIERS[i + 1];
  if (i === 0) return next ? `for your first ${next.from - 1} paying clients` : "on every paying client";
  return `from your ${ordinal(t.from)} paying client`;
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

export default function PartnersPage() {
  return (
    <>
      <PageHero
        eyebrow="Partners"
        title="Earn with BuPulse"
        text={`Refer small businesses to BuPulse and earn a share of every payment they make for ${EARN_MONTHS} months, paid to your Mobile Money.`}
      />

      <Container className="pb-16">
        <div className="grid gap-6 md:grid-cols-3">
          {TIERS.map((t, i) => (
            <Reveal key={t.from}>
              <GlassCard padding="lg" className="flex h-full flex-col gap-2 text-center">
                <p className="text-5xl font-bold tracking-tight">{t.pct}%</p>
                <p className="text-muted">{tierText(i)}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted">
          The rate counts on every payment of all your clients: once your {ordinal(TIERS[1]?.from ?? 6)} client pays, all your clients&apos; next payments earn {TIERS[1]?.pct ?? TIERS[0].pct}%.
        </p>
      </Container>

      <Container className="pb-16">
        <SectionHeading title="Who can join" className="mb-8" />
        <div className="grid gap-6 md:grid-cols-3">
          {who.map(({ icon: Icon, title, text }) => (
            <GlassCard key={title} padding="lg" className="flex flex-col gap-3">
              <Icon aria-hidden className="size-8 text-pulse-violet" />
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-muted">{text}</p>
            </GlassCard>
          ))}
        </div>
      </Container>

      <Container size="narrow" className="pb-16">
        <GlassCard padding="lg" className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Link2 aria-hidden className="size-6 text-pulse-violet" />
            How it works
          </h2>
          <ol className="flex flex-col gap-2 text-muted">
            <li><strong className="text-text">1. Apply below.</strong> We review every application and contact you.</li>
            <li><strong className="text-text">2. Get your link.</strong> Once accepted you get your own BuPulse link (it works on every page) and a private page with your clients and your commission.</li>
            <li><strong className="text-text">3. Share it.</strong> A business that opens your link and signs up within 30 days is yours.</li>
            <li><strong className="text-text">4. Earn.</strong> When it pays within {QUALIFY_DAYS} days of signing up, you earn on every payment it makes for {EARN_MONTHS} months.</li>
            <li><strong className="text-text">5. Get paid.</strong> Every month, by Mobile Money, on what is owed to you.</li>
          </ol>
        </GlassCard>
      </Container>

      <Container size="narrow" className="pb-16">
        <GlassCard padding="lg" className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold tracking-tight">Partner terms</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-muted">
            <li>You earn only on money that arrives: Mobile Money payments we have confirmed and card payments that went through, after refunds. No commission on trials or unpaid invoices.</li>
            <li>Payments stay on hold for {HOLD_DAYS} days in case of a refund; then they can be paid out. A refund after a payout is taken from your next payout.</li>
            <li>The first link a business opens counts. A business already with BuPulse, or your own business, does not count.</li>
            <li>Clients always pay BuPulse in the app. Never take money from a client for BuPulse.</li>
            <li>No spam: message only businesses that know you or that made their number public, and stop when they say no.</li>
            <li>We may pause a partnership that breaks these terms. Rate changes apply only to businesses referred after the change.</li>
          </ul>
        </GlassCard>
      </Container>

      <Container size="narrow" className="pb-24" id="apply">
        <SectionHeading title="Apply" text="It takes two minutes." className="mb-8" />
        <PartnerForm />
      </Container>
    </>
  );
}
