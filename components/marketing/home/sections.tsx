import { ArrowRight, Check } from "lucide-react";
import { Button, Container } from "@/components/ui";
import { ForCta } from "@/components/marketing/quote/cta";
import type { CtaMode } from "@/lib/quote/cta";
import type { RegionalPlan } from "@/lib/region-prices";
import { ChatDemo } from "./chat-demo";
import { RiseIn } from "./rise-in";
import "./motion.css";

// The home page's server-rendered sections. Every number here comes from the visitor's region's live plans (Admin ->
// Plans and Regions, lib/region-prices.ts) or from how the product works (docs/CONTENT.md, docs/WIDGET.md), so the
// page never says more than the plans do.

const facts = [
  { title: "Posted at lunchtime", text: "Between 11:30 and 13:30, the hours that work best for posts. You can change the times." },
  { title: "Kinyarwanda or English", text: "Posts for Rwanda are written in Kinyarwanda unless you choose English." },
  { title: "Nothing gets lost", text: "A post you didn’t get to moves to the next day, up to three times." },
  { title: "One calendar, every page", text: "Instagram, Facebook, TikTok, LinkedIn and YouTube, planned in one place." },
];

export function DailyPostFacts() {
  return (
    <section aria-label="How daily posts work" data-scene="light" className="pb-16 sm:pb-24">
      <Container>
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((f) => (
            <RiseIn as="li" key={f.title} className="glass flex flex-col gap-2 rounded-[24px] p-5">
              <h3 className="m-0 flex items-center gap-2 text-[17px] font-semibold">
                <Check aria-hidden className="size-4 shrink-0 text-pulse-blue" />
                {f.title}
              </h3>
              <p className="m-0 text-[15px] leading-relaxed text-muted">{f.text}</p>
            </RiseIn>
          ))}
        </ul>
      </Container>
    </section>
  );
}

const fmt = new Intl.NumberFormat("en-US");

/** Plans that include the website chat, with their monthly replies: "Business (500 replies a month)". */
function chatPlans(plans: RegionalPlan[]) {
  return plans.filter((p) => p.features.includes("websiteChat") && (p.limits.chat ?? 0) > 0);
}

export function ChatSection({ plans }: { plans: RegionalPlan[] }) {
  const withChat = chatPlans(plans);
  return (
    <section id="chat" aria-labelledby="chat-title" data-scene="light" className="scroll-mt-24 py-20 sm:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex min-w-0 flex-col gap-6">
            <RiseIn>
              <p className="m-0 text-sm font-semibold tracking-[0.14em] text-new uppercase">Website chat</p>
              <h2 id="chat-title" className="m-0 mt-3 text-[clamp(30px,4.6vw,54px)] leading-[1.05] font-bold tracking-[-0.035em]">
                A chat that answers your customers <span className="text-gradient">while you work.</span>
              </h2>
            </RiseIn>
            <RiseIn>
              <p className="m-0 text-lg leading-relaxed text-muted">
                Add one line of code to your website. The chat answers visitors from what you told BuPulse about your
                business, day and night. When someone wants a price, a booking or to buy, it asks for their name and phone
                number or email, saves them in your Leads and emails you straight away.
              </p>
            </RiseIn>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {[
                "Answers questions about your products, prices, hours and delivery",
                "Every lead saved in one list, so no customer is forgotten",
                ...(withChat.length > 0
                  ? [`Included in ${withChat.map((p) => `${p.name} (${fmt.format(p.limits.chat)} replies a month)`).join(" and ")}`]
                  : []),
              ].map((t) => (
                <RiseIn as="li" key={t} className="flex items-start gap-3 text-[16px] leading-relaxed">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
                    <Check aria-hidden className="size-3.5" />
                  </span>
                  {t}
                </RiseIn>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <ChatDemo />
            <p className="m-0 mt-3 text-center text-xs text-muted">Example conversation for a hardware shop.</p>
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * Facts in numbers, from how the product works and the plans' features; no prices (the home page tells the story,
 * the pricing page has the details). The AI presenter ads line is for Rwanda, where the Business plans are sold
 * (owner, 11 November 2026: Business and Business Pro include 2 a month).
 */
export function Numbers({ plans, mode }: { plans: RegionalPlan[]; mode: CtaMode }) {
  const paid = plans.filter((p) => !p.isTrial && p.monthlyPriceCents > 0);
  const dailyPlans = paid.filter((p) => p.features.includes("dailyPosts"));
  const dailyWhere = dailyPlans.length === paid.length ? "on every plan" : `on ${dailyPlans.map((p) => p.name).join(" and ")}`;
  const items = [
    dailyPlans.length > 0 ? { big: "1", unit: "post a day", text: `made for you and ready to approve, ${dailyWhere}` } : null,
    { big: "5", unit: "networks", text: "Instagram, Facebook, TikTok, LinkedIn and YouTube from one calendar" },
    { big: "11:30", unit: "to 13:30", text: "when your posts go out, unless you pick other times" },
    mode === "quote"
      ? { big: "2", unit: "AI presenter ads a month", text: "with the Business and Business Pro plans" }
      : { big: "1", unit: "line of code", text: "puts the BuPulse chat on your website" },
  ].filter((x): x is { big: string; unit: string; text: string } => x !== null);

  return (
    <section aria-labelledby="numbers-title" data-scene="light" className="py-20 sm:py-24">
      <Container>
        <RiseIn>
          <h2 id="numbers-title" className="m-0 mb-10 max-w-3xl text-[clamp(28px,4vw,46px)] leading-[1.08] font-bold tracking-[-0.03em]">
            What you get, in plain numbers.
          </h2>
        </RiseIn>
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((n) => (
            <RiseIn as="li" key={n.unit} className="nb-card glass flex flex-col gap-2 rounded-[26px] p-6">
              <span className="nb-big text-gradient">{n.big}</span>
              <strong className="text-[15px]">{n.unit}</strong>
              <span className="text-sm leading-relaxed text-muted">{n.text}</span>
            </RiseIn>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/** No prices on the home page (owner, 11 November 2026): one card that sends people to the pricing page. */
export function PlansTeaser() {
  return (
    <section id="plans" aria-labelledby="plans-title" data-scene="light" className="scroll-mt-24 py-16 sm:py-20">
      <Container>
        <RiseIn className="pt-card">
          <div aria-hidden className="pt-glow" />
          <div className="relative flex min-w-0 flex-col gap-3">
            <p className="m-0 text-sm font-semibold tracking-[0.14em] text-white uppercase">Plans</p>
            <h2 id="plans-title" className="m-0 text-[clamp(28px,4vw,48px)] leading-[1.06] font-bold tracking-[-0.03em] text-white">
              A plan for every size of business.
            </h2>
            <p className="m-0 max-w-xl text-lg text-white">
              <ForCta
                quote="Monthly or yearly, paid by Mobile Money or card. See what each plan includes, then ask for a free quote."
                trial="Monthly or yearly, paid by card. See what each plan includes, then try it free."
              />
            </p>
          </div>
          <div className="relative flex flex-wrap items-center gap-3">
            <Button href="/pricing" variant="white" size="lg" trailing={<ArrowRight aria-hidden className="size-[18px]" />}>
              See plans and prices
            </Button>
          </div>
        </RiseIn>
      </Container>
    </section>
  );
}
