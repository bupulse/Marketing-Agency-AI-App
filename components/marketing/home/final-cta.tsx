import { Reveal } from "@/components/motion";
import { Button, Container } from "@/components/ui";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="pt-12 pb-20">
      <Container>
        <Reveal>
          <div className="relative flex flex-col items-center gap-5 overflow-hidden rounded-[36px] bg-brand-gradient px-6 py-14 text-center text-white sm:px-8 sm:py-16">
            <div aria-hidden className="bp-blob -top-40 -right-20 size-[420px]" />
            <h2 id="cta-title" className="relative m-0 text-[clamp(30px,4vw,52px)] leading-[1.08] font-bold tracking-[-0.03em]">
              Whatever you sell, let’s get it seen.
            </h2>
            <p className="relative m-0 text-lg">Simple plans priced for where you are, or let our team run it for you.</p>
            <div className="relative flex flex-wrap justify-center gap-3">
              <Button href="/signup" variant="white" size="lg">
                Book a free demo
              </Button>
              <Button
                href="/done-for-you"
                size="lg"
                className="border border-white/40 bg-white/15 bg-none text-white shadow-none hover:shadow-none"
              >
                See done-for-you
              </Button>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
