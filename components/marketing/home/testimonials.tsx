import { Reveal } from "@/components/motion";
import { Container, GlassCard } from "@/components/ui";
import { publishedTestimonials } from "@/lib/testimonials/service";

/**
 * Real client testimonials (Admin -> Content -> Testimonials). Only published ones the client agreed to; with none the
 * whole section is left out, heading included.
 */
export async function Testimonials() {
  const items = await publishedTestimonials();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="testimonials-title" className="py-16">
      <Container>
        <Reveal>
          <h2 id="testimonials-title" className="m-0 mb-8 text-center text-[clamp(30px,4vw,48px)] leading-[1.08] font-bold tracking-[-0.03em]">
            Business owners like you
          </h2>
        </Reveal>
        <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <Reveal as="li" key={t.id} className="flex">
              <GlassCard as="figure" padding="none" className="m-0 flex w-full flex-col gap-4 p-6 sm:p-7">
                {t.result && <p className="text-gradient m-0 text-lg leading-snug font-bold">{t.result}</p>}
                <blockquote className="m-0 text-[17px] leading-relaxed">“{t.quote}”</blockquote>
                <figcaption className="mt-auto flex items-center gap-3 text-sm">
                  {t.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- a small stored data URL; the name is next to it
                    <img src={t.photoUrl} alt="" width={44} height={44} loading="lazy" className="size-11 shrink-0 rounded-full object-cover" />
                  )}
                  <span className="min-w-0">
                    <span className="block font-semibold">{t.clientName}</span>
                    <span className="block text-muted">
                      {t.business}
                      {t.sector ? ` · ${t.sector}` : ""}
                    </span>
                  </span>
                </figcaption>
              </GlassCard>
            </Reveal>
          ))}
        </ul>
      </Container>
    </section>
  );
}
