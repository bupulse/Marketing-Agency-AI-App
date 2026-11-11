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

// The five trades the heading names, each with a real picture: a still from BuPulse's own construction ad, and AI
// photos made with the app's image model where no still fitted (docs/design/front-page-motion.md, round 3).
const CARD_PHOTOS: Record<string, { alt: string }> = {
  beauty: { alt: "A smiling woman admiring her new braids in a bright salon" },
  restaurants: { alt: "A brunch plate with eggs, avocado, tomato, toast and fruit, and a cup of coffee" },
  retail: { alt: "White and cream paint buckets stacked at the front of a hardware shop" },
  construction: { alt: "A site manager in a hard hat and safety vest in front of a three-floor building going up" },
  electronics: { alt: "Smartphones laid out in a glass counter, phone cases on the wall behind" },
};
const SHOWN = ["beauty", "restaurants", "retail", "construction", "electronics"];
const MORE = [
  { id: "clinic", alt: "Clinic post: “Book your check-up this month”" },
  { id: "school", alt: "School post: “Open day for new parents”" },
  { id: "gym", alt: "Gym post: “New morning class”" },
];

export function IndustryCards() {
  const shown = SHOWN.map((slug) => industries.find((i) => i.slug === slug)).filter((i): i is (typeof industries)[number] => i !== undefined);
  return (
    <section id="industries" className="scroll-mt-28 py-16">
      <Container>
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Whatever you sell"
            title="Salons, restaurants, shops, hardware stores: BuPulse learns your trade and speaks to your customers."
            className="mb-9 max-w-3xl"
          />
        </Reveal>
        <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
          {shown.map(({ slug, name, summary }) => {
            const photo = CARD_PHOTOS[slug];
            return (
              <li key={slug} className="flex">
                <Reveal className="flex w-full">
                  <GlassCard interactive padding="none" className="flex w-full flex-col overflow-hidden">
                    {photo && (
                      // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP with srcset; next/image would add a server round trip per size
                      <img
                        src={`/marketing/photos/industry-${slug}-480.webp`}
                        srcSet={`/marketing/photos/industry-${slug}-480.webp 480w, /marketing/photos/industry-${slug}-720.webp 720w`}
                        sizes="(min-width: 1024px) 380px, (min-width: 768px) 46vw, calc(100vw - 32px)"
                        alt={photo.alt}
                        width={480}
                        height={300}
                        loading="lazy"
                        decoding="async"
                        className="block aspect-[16/10] h-auto w-full bg-soft object-cover"
                      />
                    )}
                    <div className="flex flex-col gap-2.5 p-6 sm:p-[26px]">
                      <h3 className="m-0 text-[19px] font-semibold">{name}</h3>
                      <p className="m-0 leading-relaxed text-muted">{summary}</p>
                    </div>
                  </GlassCard>
                </Reveal>
              </li>
            );
          })}
          <li className="flex">
            <Reveal className="flex w-full">
              <Link
                href="/industries"
                className="glass-strong flex min-h-44 w-full flex-col justify-between gap-3.5 overflow-hidden rounded-glass text-text no-underline transition-transform duration-300 ease-out-soft hover:-translate-y-1.5 motion-reduce:transition-none"
              >
                {/* Three posts from the designs wall, made by BuPulse's design engine for other trades. */}
                <span className="grid grid-cols-3 gap-2 bg-soft p-3">
                  {MORE.map((m) => (
                    // eslint-disable-next-line @next/next/no-img-element -- the designs wall's own small WebP posts
                    <img key={m.id} src={`/marketing/posts/${m.id}.webp`} alt={m.alt} width={540} height={675} loading="lazy" decoding="async" className="block h-auto w-full rounded-lg shadow-sm" />
                  ))}
                </span>
                <span className="flex flex-col gap-3.5 px-6 pb-6 sm:px-[26px] sm:pb-[26px]">
                <h3 className="m-0 text-[19px] font-semibold">And many more</h3>
                <p className="m-0 leading-relaxed text-muted">
                  Clinics, schools, gyms, hotels, IT, machinery, professional services and more.
                </p>
                <span className="text-gradient inline-flex items-center gap-2 font-semibold">
                  See all industries <ArrowRight aria-hidden className="size-4 text-pulse-blue" />
                </span>
                </span>
              </Link>
            </Reveal>
          </li>
        </ul>
        <p className="m-0 mt-5 text-xs text-muted">Pictures made by BuPulse: stills from our own AI ads, AI photos and posts from our design engine.</p>
      </Container>
    </section>
  );
}
