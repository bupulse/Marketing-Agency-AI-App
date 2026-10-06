import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Marquee, Reveal } from "@/components/motion";
import { Container, GlassCard, SectionHeading } from "@/components/ui";
import { industries } from "@/lib/content/site";

const half = Math.ceil(industries.length / 2);
const rowA = industries.slice(0, half);
const rowB = industries.slice(half).concat(industries.slice(0, 2));

function Chips({ list, tone }: { list: typeof industries; tone: string }) {
  return list.map(({ slug, name, icon: Icon }) => (
    <span key={slug} className="glass inline-flex items-center gap-2.5 rounded-full px-[18px] py-3 text-[15px] font-medium whitespace-nowrap">
      <Icon aria-hidden className={`size-[18px] ${tone}`} />
      {name}
    </span>
  ));
}

export function IndustryMarquee() {
  return (
    <section aria-label="Industries BuPulse works for" className="flex flex-col gap-3 pt-6 pb-14">
      <p className="m-0 mb-2 px-4 text-center text-sm font-medium text-muted">Built for every kind of business owner</p>
      <Marquee duration={40}>
        <Chips list={rowA} tone="text-pulse-blue" />
      </Marquee>
      <Marquee duration={46} reverse>
        <Chips list={rowB} tone="text-pulse-violet" />
      </Marquee>
    </section>
  );
}

export function IndustryCards() {
  const shown = industries.slice(0, 5);
  return (
    <section id="industries" className="scroll-mt-28 py-16">
      <Container>
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Whatever you sell"
            title="BuPulse learns your business and speaks your customers’ language."
            className="mb-9 max-w-3xl"
          />
        </Reveal>
        <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
          {shown.map(({ slug, name, icon: Icon, summary }) => (
            <li key={slug} className="flex">
              <Reveal className="flex w-full">
                <GlassCard interactive padding="none" className="flex w-full flex-col gap-3.5 p-6 sm:p-[26px]">
                  <div className="flex items-center gap-3.5">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white">
                      <Icon aria-hidden className="size-[22px]" />
                    </span>
                    <h3 className="m-0 text-[19px] font-semibold">{name}</h3>
                  </div>
                  <p className="m-0 leading-relaxed text-muted">{summary}</p>
                </GlassCard>
              </Reveal>
            </li>
          ))}
          <li className="flex">
            <Reveal className="flex w-full">
              <Link
                href="/industries"
                className="glass-strong flex min-h-44 w-full flex-col justify-between gap-3.5 rounded-glass p-6 text-text no-underline transition-transform duration-300 ease-out-soft hover:-translate-y-1.5 motion-reduce:transition-none sm:p-[26px]"
              >
                <h3 className="m-0 text-[19px] font-semibold">And many more</h3>
                <p className="m-0 leading-relaxed text-muted">
                  Clinics, salons, gyms, hotels, machinery, professional services and more.
                </p>
                <span className="text-gradient inline-flex items-center gap-2 font-semibold">
                  See all industries <ArrowRight aria-hidden className="size-4 text-pulse-blue" />
                </span>
              </Link>
            </Reveal>
          </li>
        </ul>
      </Container>
    </section>
  );
}
