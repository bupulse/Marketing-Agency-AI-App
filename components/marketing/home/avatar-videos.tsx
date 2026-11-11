import { Captions, Clapperboard, Mic, PenLine } from "lucide-react";
import { Container } from "@/components/ui";
import { ForCta } from "@/components/marketing/quote/cta";
import { AutoVideo, TapVideo } from "./inline-video";
import { RiseIn } from "./rise-in";
import "./motion.css";

// "It was AI all along": the whole "Who's real?" ad, how an AI presenter video is made, and more examples. Every
// clip is one of BuPulse's own ads (made 10 November 2026 with an AI presenter, to market BuPulse itself); the page
// says so, and says what an ad for the visitor's own business would be about.

const steps = [
  {
    icon: PenLine,
    title: "You tell us what to sell",
    text: "A product, a new service, this week's offer. Send a few photos if you have them.",
  },
  {
    icon: Clapperboard,
    title: "We write a script that stops the scroll",
    text: "Short and hook-first: the first two seconds give people a reason to keep watching.",
  },
  {
    icon: Mic,
    title: "An AI presenter films it",
    text: "A realistic person, filmed like a phone selfie in a place that suits your business.",
  },
  {
    icon: Captions,
    title: "Captions, your name and a call to action",
    text: "Word-by-word captions and an end card that tells people how to reach you. Ready for Reels, TikTok, Facebook and YouTube Shorts.",
  },
];

const examples = [
  { id: "ugc-salon", title: "A salon owner", text: "“Who answers your Instagram?”" },
  { id: "ugc-construction", title: "A site manager", text: "“Did anyone see your project?”" },
  { id: "ugc-reveal", title: "Split screen", text: "A whole week of posts, explained in 12 seconds." },
  { id: "ugc-autopilot", title: "Autopilot", text: "A week of posts in one tap." },
];

export function AvatarVideos() {
  return (
    <section id="ai-videos" aria-labelledby="ai-videos-title" data-tint="violet" className="scroll-mt-24 py-20 sm:py-28">
      <Container>
        {/* Phones: heading, then the ad, then the steps. Wide screens: the ad stays pinned beside the text. */}
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-6">
          <div className="flex min-w-0 flex-col gap-6">
            <RiseIn>
              <p className="m-0 text-sm font-semibold tracking-[0.14em] text-new uppercase">AI presenter videos</p>
              <h2
                id="ai-videos-title"
                className="m-0 mt-3 text-[clamp(32px,5vw,56px)] leading-[1.04] font-bold tracking-[-0.035em]"
              >
                It was AI all along. <span className="text-gradient">That’s the point.</span>
              </h2>
            </RiseIn>
            <RiseIn>
              <p className="m-0 max-w-2xl text-lg leading-relaxed text-muted">
                BuPulse made the ad on this page. The man, the android and the woman who takes his place are all AI:
                nobody stood in front of a camera. We make the same kind of short video ad for your business, with a
                presenter who talks to your customers about what you sell.
              </p>
            </RiseIn>
          </div>

          <div className="av-phone-wrap lg:sticky lg:top-28 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="av-phone">
              <AutoVideo
                small="/marketing/avatar/whos-real-360.mp4"
                large="/marketing/avatar/whos-real-540.mp4"
                poster="/marketing/avatar/whos-real-poster.webp"
                label="BuPulse ad “Who’s real?”: a presenter asks which post was made by AI, turns into an android, then shows BuPulse’s posts screens. 30 seconds, with captions."
                className="size-full rounded-[30px]"
              />
            </div>
            <p className="m-0 mt-4 text-center text-sm text-muted">“Who’s real?” · 30 s · made by BuPulse with an AI presenter</p>
          </div>

          <div className="flex min-w-0 flex-col gap-6 lg:col-start-1">
            <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
              {steps.map(({ icon: Icon, title, text }, i) => (
                <RiseIn as="li" key={title} className="glass flex gap-4 rounded-[24px] p-5">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h3 className="m-0 text-[17px] font-semibold">
                      <span className="sr-only">Step {i + 1}: </span>
                      {title}
                    </h3>
                    <p className="m-0 text-[15px] leading-relaxed text-muted">{text}</p>
                  </div>
                </RiseIn>
              ))}
            </ol>
            <RiseIn className="rounded-[24px] border border-line bg-soft p-5 text-[15px] leading-relaxed">
              <strong className="block text-base">Good to know</strong>
              <span className="text-muted">
                AI presenters speak English. AI voices are not good enough in Kinyarwanda yet, so we don’t use them:
                Kinyarwanda videos use a real Rwandan voice, recorded as a voice note.{" "}
                <ForCta
                  quote="The Business Pro plan includes talking skits in Kinyarwanda every week. AI presenter ads are made on request: ask for them in your free quote."
                  trial="AI presenter ads are made on request: ask for them in a custom plan."
                />
              </span>
            </RiseIn>
          </div>
        </div>

        <div className="mt-20">
          <RiseIn className="mb-6 flex flex-col gap-2">
            <h3 className="m-0 text-2xl font-bold tracking-[-0.02em]">More AI presenters we made</h3>
            <p className="m-0 max-w-2xl text-muted">
              Each of these is an ad BuPulse made to market itself. Yours would be about your business, your products and
              your prices. Press play for sound.
            </p>
          </RiseIn>
          <ul className="av-row m-0 list-none p-0">
            {examples.map((e) => (
              <li key={e.id} className="av-tile">
                <TapVideo
                  src={`/marketing/avatar/${e.id}-360.mp4`}
                  poster={`/marketing/avatar/${e.id}-poster.webp`}
                  label={`${e.title}: ${e.text}`}
                  className="aspect-[9/16] rounded-[22px] bg-black"
                />
                <p className="m-0 mt-3 font-semibold">{e.title}</p>
                <p className="m-0 text-sm text-muted">{e.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
