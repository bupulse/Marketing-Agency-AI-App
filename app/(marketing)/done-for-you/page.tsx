import { CalendarCheck, Handshake, MessagesSquare, Rocket } from "lucide-react";
import { Reveal } from "@/components/motion";
import { ContactForm } from "@/components/marketing/pages/contact-form";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { Chip, Container, GlassCard, SectionHeading } from "@/components/ui";
import { industries } from "@/lib/content/site";

export const metadata = pageMetadata({
  title: "Done-for-you marketing",
  description: "Let our team run your social media content and lead capture with BuPulse. From $300 a month. Book a call.",
  path: "/done-for-you",
});

const included = [
  "A monthly content plan built around your offers and calendar",
  "Posts, captions and branded designs made and scheduled for you",
  "Publishing to Instagram, Facebook, TikTok, LinkedIn and YouTube",
  "A lead-capturing chat widget set up on your website",
  "New leads sent straight to you, with a monthly results summary",
];

const how = [
  { icon: Handshake, title: "Book a call", text: "Tell us about your business and what you want more of." },
  { icon: Rocket, title: "We set everything up", text: "Your brand, your voice, your accounts and your website widget." },
  { icon: CalendarCheck, title: "We run it every month", text: "You approve what you like. We handle the rest." },
  { icon: MessagesSquare, title: "You get the leads", text: "Enquiries land in your inbox while you run your business." },
];

const who = ["Owners with no time for social media", "Teams without a marketer", "Businesses that tried posting and fell behind", "Anyone who wants results without learning a new tool"];

export default function DoneForYouPage() {
  return (
    <>
      <PageHero
        eyebrow="Done-for-you"
        title="We run your marketing for you"
        text="Our team uses BuPulse to plan, create and post your content and to capture leads from your website. From $300 a month."
      />

      <Container className="pb-20">
        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal>
            <GlassCard padding="lg" className="h-full">
              <h2 className="mb-5 text-2xl font-bold tracking-tight">What is included</h2>
              <ul className="flex flex-col gap-3">
                {included.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span aria-hidden className="mt-2.5 size-2 shrink-0 rounded-full bg-brand-gradient" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-lg font-semibold">From $300/month</p>
              <p className="text-sm text-muted">The price depends on how much content and how many networks you need. Most plans are between $300 and $500 a month.</p>
            </GlassCard>
          </Reveal>
          <Reveal>
            <GlassCard padding="lg" className="h-full">
              <h2 className="mb-5 text-2xl font-bold tracking-tight">Who it is for</h2>
              <ul className="mb-6 flex flex-col gap-3">
                {who.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span aria-hidden className="mt-2.5 size-2 shrink-0 rounded-full bg-brand-gradient" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mb-3 text-sm text-muted">Works for every kind of small business, for example:</p>
              <ul className="flex flex-wrap gap-2">
                {industries.slice(0, 8).map(({ slug, name }) => (
                  <li key={slug}>
                    <Chip className="px-3.5 py-2 text-[13px]">{name}</Chip>
                  </li>
                ))}
              </ul>
            </GlassCard>
          </Reveal>
        </div>
      </Container>

      <Container className="pb-20">
        <SectionHeading title="How it works" className="mb-10" />
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {how.map(({ icon: Icon, title, text }, i) => (
            <li key={title}>
              <GlassCard className="flex h-full flex-col gap-3">
                <span className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-brand-gradient text-white">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="text-sm font-semibold text-muted">Step {i + 1}</span>
                </span>
                <h3 className="text-lg font-bold tracking-tight">{title}</h3>
                <p className="text-muted">{text}</p>
              </GlassCard>
            </li>
          ))}
        </ol>
      </Container>

      <Container size="narrow" className="pb-24">
        <SectionHeading title="Book a call" text="Tell us a little about your business. We will reply by email to find a time." className="mb-10" />
        <div id="book">
          <ContactForm
            kind="done_for_you"
            industries={industries.map((i) => i.name)}
            submitLabel="Request a call"
            messageLabel="What would you like help with?"
            messageHint="For example: more followers, more enquiries, or just getting started."
            successTitle="Thanks, your request is in"
            successText="We will email you within one or two working days to arrange a call."
          />
        </div>
      </Container>
    </>
  );
}
