import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/motion";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { Button, Chip, Container, GlassCard } from "@/components/ui";
import { industries } from "@/lib/content/site";

export const metadata = pageMetadata({
  title: "Industries",
  description: "BuPulse writes posts, designs and chat replies for shops, schools, builders, IT firms, restaurants, salons, clinics and every other kind of small business.",
  path: "/industries",
});

export default function IndustriesPage() {
  return (
    <>
      <PageHero
        eyebrow="Industries"
        title="Built for whatever you sell"
        text="Shops, schools, builders, salons, clinics, IT firms and more. Tell BuPulse what you do and it writes for your customers."
      />
      <Container className="pb-20">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {industries.map(({ slug, name, icon: Icon, summary, examples }) => (
            <li key={slug}>
              <Reveal className="h-full">
                <GlassCard interactive className="flex h-full flex-col gap-4">
                  <span className="grid size-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
                    <Icon aria-hidden className="size-6" />
                  </span>
                  <h2 className="text-xl font-bold tracking-tight">{name}</h2>
                  <p className="text-muted">{summary}</p>
                  <ul aria-label={`Examples for ${name}`} className="mt-auto flex flex-wrap gap-2">
                    {examples.map((example) => (
                      <li key={example}>
                        <Chip className="px-3.5 py-2 text-[13px]">{example}</Chip>
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              </Reveal>
            </li>
          ))}
        </ul>
        <GlassCard strong padding="lg" className="mt-12 flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Do not see your business?</h2>
          <p className="max-w-xl text-muted">BuPulse is not limited to this list. If you can describe what you offer, it can help you promote it.</p>
          <Button href="/signup" size="lg" trailing={<ArrowRight aria-hidden className="size-4" />}>
            Book a free demo
          </Button>
        </GlassCard>
      </Container>
    </>
  );
}
