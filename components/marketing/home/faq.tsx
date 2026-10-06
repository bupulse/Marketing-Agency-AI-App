import { Reveal } from "@/components/motion";
import { Accordion, Container } from "@/components/ui";
import { faqs } from "@/lib/content/site";

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="py-16">
      <Container size="narrow">
        <Reveal>
          <h2 id="faq-title" className="m-0 mb-6 text-center text-[clamp(30px,4vw,48px)] leading-[1.08] font-bold tracking-[-0.03em]">
            Questions
          </h2>
          <Accordion items={faqs.map((f) => ({ question: f.q, answer: f.a }))} defaultOpen={0} />
        </Reveal>
      </Container>
    </section>
  );
}
