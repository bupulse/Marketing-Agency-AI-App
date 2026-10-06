import { Heart, Target, Users } from "lucide-react";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { Button, Container, GlassCard, SectionHeading } from "@/components/ui";

export const metadata = pageMetadata({
  title: "About",
  description: "BuPulse exists to give every small business owner the marketing help that only big companies could afford.",
  path: "/about",
});

const beliefs = [
  { icon: Users, title: "Every owner deserves a marketing team", text: "Good marketing should not depend on your budget or on how many hours you have left in the day." },
  { icon: Heart, title: "Your voice, not a robot's", text: "AI should sound like your business. You teach it once, review everything, and stay in control." },
  { icon: Target, title: "Results over busywork", text: "We care about customers who call, visit and buy, not about posting for the sake of posting." },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="Marketing help for every small business owner"
        text="BuPulse gives shops, schools, builders, salons, clinics and IT firms the kind of marketing team that used to be out of reach."
      />
      <Container size="narrow" className="flex flex-col gap-16 pb-24">
        <section className="flex flex-col gap-4">
          <h2 className="text-3xl font-bold tracking-tight">Our mission</h2>
          <p className="text-lg leading-relaxed text-muted">
            Small business owners are experts at what they do, but marketing is a second full-time job. Our mission is to take that job off your
            plate: write the posts, make the designs, answer your website visitors and bring in the customers, in your own brand voice.
          </p>
        </section>

        <section className="flex flex-col gap-6">
          <SectionHeading align="left" title="What we believe" />
          <ul className="grid gap-5">
            {beliefs.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <GlassCard className="flex gap-4">
                  <Icon aria-hidden className="mt-1 size-6 shrink-0 text-pulse-violet" />
                  <div>
                    <h3 className="mb-1 text-lg font-bold tracking-tight">{title}</h3>
                    <p className="text-muted">{text}</p>
                  </div>
                </GlassCard>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-3xl font-bold tracking-tight">Our story</h2>
          <p className="text-lg leading-relaxed text-muted">[Founding story: who started BuPulse, and the problem they saw first-hand while helping local businesses.]</p>
          <p className="text-lg leading-relaxed text-muted">[Where the team is based and how many people work on BuPulse today.]</p>
          <p className="text-lg leading-relaxed text-muted">[One sentence about what is coming next.]</p>
        </section>

        <div className="flex flex-wrap gap-3">
          <Button href="/signup" size="lg">Start free trial</Button>
          <Button href="/contact" size="lg" variant="ghost">Get in touch</Button>
        </div>
      </Container>
    </>
  );
}
