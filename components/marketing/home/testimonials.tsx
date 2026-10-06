import { Reveal } from "@/components/motion";
import { Container, GlassCard } from "@/components/ui";
import { testimonials } from "@/lib/content/site";

export function Testimonials() {
  return (
    <section aria-labelledby="testimonials-title" className="py-16">
      <Container>
        <Reveal>
          <h2 id="testimonials-title" className="m-0 mb-8 text-[clamp(30px,4vw,48px)] leading-[1.08] font-bold tracking-[-0.03em]">
            Business owners like you
          </h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {testimonials.map((t) => (
            <Reveal key={t.business} className="flex">
              <GlassCard as="figure" interactive padding="none" className="m-0 flex w-full flex-col gap-4 p-7">
                <blockquote className="m-0 text-[17px] leading-relaxed">“{t.quote}”</blockquote>
                <figcaption className="text-sm text-muted">
                  {t.name}, {t.business}
                </figcaption>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
