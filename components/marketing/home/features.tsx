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
          {features.map(({ title, text, icon: Icon, soon, note, wide }) => (
            <li key={title} className={cn("flex", wide && "md:col-span-2 lg:col-span-3")}>
              <Reveal className="flex w-full">
                <GlassCard interactive padding="none" className={cn("flex w-full flex-col gap-3.5 p-7", wide && "lg:flex-row lg:items-center lg:gap-6")}>
                  <span
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-2xl",
                      soon ? "bg-soft text-new" : "bg-brand-gradient text-white",
                    )}
                  >
                    <Icon aria-hidden className="size-[22px]" />
                  </span>
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 text-xl font-semibold">{title}</h3>
                      {soon && <Badge tone="violet">SOON</Badge>}
                      {note && <Badge tone="blue">{note}</Badge>}
                    </div>
                    <p className="m-0 leading-relaxed text-muted">{text}</p>
                  </div>
                </GlassCard>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
