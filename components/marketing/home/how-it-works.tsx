import { Reveal } from "@/components/motion";
import { Container, GlassCard } from "@/components/ui";
import { steps } from "@/lib/content/site";
import "./home.css";

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-28 py-16">
      <Container>
        <Reveal>
          <h2 id="how-title" className="m-0 mb-10 text-center text-[clamp(30px,4vw,48px)] leading-[1.08] font-bold tracking-[-0.03em]">
            Up and running in three steps
          </h2>
        </Reveal>
        <ol className="m-0 grid list-none grid-cols-1 gap-6 p-0 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex">
              <GlassCard padding="none" className="flex w-full flex-col gap-3 p-7">
                <span aria-hidden className="text-gradient text-[44px] leading-none font-bold tracking-[-0.04em]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="m-0 text-xl font-semibold">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="m-0 leading-relaxed text-muted">{s.text}</p>
              </GlassCard>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
