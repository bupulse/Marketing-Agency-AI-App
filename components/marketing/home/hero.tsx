import { ArrowRight } from "lucide-react";
import { RotatingWords } from "@/components/motion";
import { Button } from "@/components/ui";
import { heroWords } from "@/lib/content/site";
import { HeroScene } from "./hero-scene";

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="mx-auto grid w-full max-w-7xl items-center gap-10 px-4 pt-12 pb-8 sm:px-6 md:pt-16 lg:grid-cols-[1.2fr_1fr] lg:gap-12 lg:px-8"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <p className="glass animate-rise flex items-center gap-2.5 self-start rounded-full px-3.5 py-2 text-[13px] leading-snug font-medium">
          <span aria-hidden className="size-2 shrink-0 animate-ping-soft rounded-full bg-pulse-blue" />
          Welcome, business owner. Whatever you do, we’ve got your marketing.
        </p>
        <h1
          id="hero-title"
          className="animate-rise m-0 text-[clamp(30px,8vw,40px)] leading-[1.06] font-bold tracking-[-0.035em] [animation-delay:120ms] sm:text-[clamp(40px,5vw,60px)]"
        >
          The marketing team for your <RotatingWords words={heroWords} className="max-w-full" wordClassName="text-gradient" />
        </h1>
        <p className="animate-rise m-0 max-w-xl text-[19px] leading-relaxed text-muted [animation-delay:240ms]">
          Tell BuPulse about your business once. It writes your posts, designs your graphics and chats with your website
          visitors, so you can get back to running the business.
        </p>
        <div className="animate-rise flex flex-wrap gap-3 [animation-delay:360ms]">
          <Button href="/signup" size="lg" trailing={<ArrowRight aria-hidden className="size-[18px]" />}>
            Book a free demo
          </Button>
          <Button href="#how" variant="ghost" size="lg">
            See how it works
          </Button>
        </div>
        <p className="animate-rise m-0 text-[13px] text-muted [animation-delay:360ms]">
          Free demo, then a free trial · No marketing experience needed · Cancel anytime
        </p>
      </div>
      <HeroScene />
    </section>
  );
}
