import { Reveal } from "@/components/motion";
import { Badge, Container, GlassCard, SectionHeading } from "@/components/ui";
import { cn } from "@/lib/cn";
import { features } from "@/lib/content/site";
import "./motion.css";

// Each feature card shows what it makes, with real pictures (round 3, docs/design/front-page-motion.md): posts and
// stories from BuPulse's own design engine, posters of BuPulse's own AI presenter ads, a still from its salon ad and
// one AI photo made with the app's image model. No icon-on-gradient placeholders.

type Fan = { kind: "fan"; tall?: boolean; items: { src: string; alt: string }[] };
type Photo = { kind: "photo"; file: string; alt: string };
type Strip = { kind: "strip" };
type Visual = Fan | Photo | Strip;

const VISUALS: Record<string, Visual> = {
  "Knows your business": { kind: "photo", file: "feature-business", alt: "A smiling salon owner in her salon, products on the shelves behind her" },
  "Content generator": {
    kind: "fan",
    items: [
      { src: "/marketing/week/tue-300.webp", alt: "A tip post for a salon" },
      { src: "/marketing/week/mon-300.webp", alt: "A new-look post for a salon" },
      { src: "/marketing/week/thu-300.webp", alt: "An offer post for a salon" },
    ],
  },
  "Post everywhere": {
    kind: "fan",
    tall: true,
    items: [
      { src: "/marketing/posts/cafe-story.webp", alt: "A café story" },
      { src: "/marketing/posts/phones-story.webp", alt: "A phone shop story" },
      { src: "/marketing/posts/hardware-story.webp", alt: "A hardware store story" },
    ],
  },
  "Lead-capturing chat": { kind: "photo", file: "feature-chat", alt: "A customer outside a shop, smiling as she types a message on her phone" },
  "Brand designs": {
    kind: "fan",
    items: [
      { src: "/marketing/posts/cafe.webp", alt: "A café post in the café's colours" },
      { src: "/marketing/posts/music.webp", alt: "A restaurant poster for live music" },
      { src: "/marketing/posts/hardware.webp", alt: "A hardware store post in the shop's colours" },
    ],
  },
  "Videos for Reels and TikTok": {
    kind: "fan",
    tall: true,
    items: [
      { src: "/marketing/avatar/ugc-construction-poster.webp", alt: "A frame of BuPulse's construction ad with an AI presenter" },
      { src: "/marketing/avatar/ugc-salon-poster.webp", alt: "A frame of BuPulse's salon ad with an AI presenter" },
      { src: "/marketing/avatar/ugc-reveal-poster.webp", alt: "A frame of BuPulse's split-screen ad" },
    ],
  },
  Autopilot: { kind: "strip" },
};

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function FeatureVisual({ visual }: { visual: Visual }) {
  if (visual.kind === "photo") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP with srcset; next/image would add a server round trip per size
      <img
        src={`/marketing/photos/${visual.file}-480.webp`}
        srcSet={`/marketing/photos/${visual.file}-480.webp 480w, /marketing/photos/${visual.file}-720.webp 720w`}
        sizes="(min-width: 1024px) 380px, (min-width: 768px) 46vw, calc(100vw - 32px)"
        alt={visual.alt}
        width={480}
        height={270}
        loading="lazy"
        decoding="async"
        className="block aspect-video h-auto w-full bg-soft object-cover"
      />
    );
  }
  if (visual.kind === "fan") {
    return (
      <div className={cn("ft-fan", visual.tall && "ft-tall")}>
        {visual.items.map((it, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- small pre-sized WebP posts already used on the page
          <img key={it.src} src={it.src} alt={it.alt} width={visual.tall ? 360 : 300} height={visual.tall ? 640 : 375} loading="lazy" decoding="async" data-i={i} />
        ))}
      </div>
    );
  }
  return (
    <ul className="ft-strip m-0 list-none p-0" aria-label="A week of posts planned by Autopilot">
      {WEEK.map((d) => (
        <li key={d}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the salon week's own small WebP posts */}
          <img src={`/marketing/week/${d}-300.webp`} alt="" width={300} height={375} loading="lazy" decoding="async" />
        </li>
      ))}
    </ul>
  );
}

export function Features() {
  return (
    <section id="features" className="scroll-mt-28 py-16">
      <Container>
        <Reveal>
          <SectionHeading align="left" eyebrow="Everything in one app" title="A whole marketing team, without the payroll." className="mb-9 max-w-3xl" />
        </Reveal>
        <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ title, text, soon, note, wide }) => {
            const visual = VISUALS[title];
            return (
              <li key={title} className={cn("flex", wide && "md:col-span-2 lg:col-span-3")}>
                <Reveal className="flex w-full">
                  <GlassCard interactive padding="none" className={cn("flex w-full flex-col overflow-hidden", wide && "lg:flex-row-reverse lg:items-stretch")}>
                    {visual && <div className={cn("bg-soft", wide && "lg:w-[58%] lg:shrink-0")}>{<FeatureVisual visual={visual} />}</div>}
                    <div className={cn("flex flex-col gap-3 p-6 sm:p-7", wide && "lg:justify-center")}>
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
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
