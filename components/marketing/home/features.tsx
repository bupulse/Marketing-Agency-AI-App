import { Reveal } from "@/components/motion";
import { Badge, Container, GlassCard, SectionHeading } from "@/components/ui";
import { cn } from "@/lib/cn";
import { features } from "@/lib/content/site";

export function Features() {
  return (
    <section id="features" className="scroll-mt-28 py-16">
      <Container>
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Features"
            title="A whole marketing team, without the payroll."
            className="mb-9 max-w-3xl"
          />
        </Reveal>
        <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ title, text, icon: Icon, soon }) => (
            <li key={title} className="flex">
              <Reveal className="flex w-full">
                <GlassCard interactive padding="none" className="flex w-full flex-col gap-3.5 p-7">
                  <span
                    className={cn(
                      "flex size-12 items-center justify-center rounded-2xl",
                      soon ? "bg-soft text-new" : "bg-brand-gradient text-white",
                    )}
                  >
                    <Icon aria-hidden className="size-[22px]" />
                  </span>
                  <div className="flex items-center gap-2">
                    <h3 className="m-0 text-xl font-semibold">{title}</h3>
                    {soon && <Badge tone="violet">SOON</Badge>}
                  </div>
                  <p className="m-0 leading-relaxed text-muted">{text}</p>
                </GlassCard>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
