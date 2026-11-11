import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { Container } from "@/components/ui";
import { formatPlanPrice } from "@/components/billing/helpers";
import { CtaButton, ForCta } from "@/components/marketing/quote/cta";
import type { RegionalPlan } from "@/lib/region-prices";
import { cn } from "@/lib/cn";
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
    <section aria-label="How daily posts work" className="pb-16 sm:pb-24">
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
    <section id="chat" aria-labelledby="chat-title" data-tint="violet" className="scroll-mt-24 py-20 sm:py-28">
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

/** Facts in numbers, all read from the plans or the product. Shown only when there is something true to show. */
export function Numbers({ plans }: { plans: RegionalPlan[] }) {
  const paid = plans.filter((p) => !p.isTrial && p.monthlyPriceCents > 0);
  const cheapest = paid.reduce<RegionalPlan | null>((a, p) => (!a || p.monthlyPriceCents < a.monthlyPriceCents ? p : a), null);
  const skits = paid.reduce<RegionalPlan | null>((a, p) => ((p.limits.skitsPerWeek ?? 0) > (a?.limits.skitsPerWeek ?? 0) ? p : a), null);
  const dailyPlans = paid.filter((p) => p.features.includes("dailyPosts"));
  const dailyWhere = dailyPlans.length === paid.length ? "on every plan" : `on ${dailyPlans.map((p) => p.name).join(" and ")}`;
  const items = [
    dailyPlans.length > 0 ? { big: "1", unit: "post a day", text: `made for you and ready to approve, ${dailyWhere}` } : null,
    { big: "5", unit: "networks", text: "Instagram, Facebook, TikTok, LinkedIn and YouTube from one calendar" },
    { big: "11:30", unit: "to 13:30", text: "when your posts go out, unless you pick other times" },
    skits && skits.limits.skitsPerWeek ? { big: String(skits.limits.skitsPerWeek), unit: "talking skits a week", text: `in Kinyarwanda with a real voice, on ${skits.name}` } : null,
    cheapest ? { big: formatPlanPrice(cheapest, "MONTH"), unit: "a month", text: `to start, with ${cheapest.name}` } : null,
  ].filter((x): x is { big: string; unit: string; text: string } => x !== null);

  return (
    <section aria-labelledby="numbers-title" className="py-20 sm:py-24">
      <Container>
        <RiseIn>
          <h2 id="numbers-title" className="m-0 mb-10 max-w-3xl text-[clamp(28px,4vw,46px)] leading-[1.08] font-bold tracking-[-0.03em]">
            What you get, in plain numbers.
          </h2>
        </RiseIn>
        <ul className={cn("m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2", items.length >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
          {items.map((n, i) => (
            <RiseIn as="li" key={n.unit} className="nb-card glass flex flex-col gap-2 rounded-[26px] p-6">
              <span className="nb-big text-gradient" style={{ ["--d" as string]: i }}>
                {n.big}
              </span>
              <strong className="text-[15px]">{n.unit}</strong>
              <span className="text-sm leading-relaxed text-muted">{n.text}</span>
            </RiseIn>
          ))}
        </ul>
      </Container>
    </section>
  );
}

export function PricingTeaser({ plans }: { plans: RegionalPlan[] }) {
  const shown = plans.filter((p) => !p.isTrial);
  if (shown.length === 0) return null;
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-24 py-20 sm:py-24">
      <Container>
        <RiseIn className="mb-10 flex flex-col gap-3">
          <p className="m-0 text-sm font-semibold tracking-[0.14em] text-ok uppercase">Pricing</p>
          <h2 id="pricing-title" className="m-0 text-[clamp(30px,4.6vw,54px)] leading-[1.05] font-bold tracking-[-0.035em]">
            Simple plans, priced for where you are.
          </h2>
          <p className="m-0 max-w-2xl text-lg text-muted">
            <ForCta
              quote="Pay monthly, or yearly and get two months free. By MTN MoMo, Airtel Money or card. Cancel any time."
              trial="Pay monthly, or yearly and save. Try it free first, no card needed. Cancel any time."
            />
          </p>
        </RiseIn>
        <ul className={cn("m-0 grid list-none grid-cols-1 gap-5 p-0", shown.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
          {shown.map((p) => (
            <RiseIn
              as="li"
              key={p.key}
              className={cn("glass relative flex flex-col gap-4 rounded-[28px] p-6 sm:p-7", p.highlight && "glass-strong ring-2 ring-pulse-violet/60")}
            >
              {p.highlight && (
                <span className="absolute -top-3 right-6 rounded-full bg-brand-gradient px-3 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}
              <div className="flex flex-col gap-1">
                <h3 className="m-0 text-xl font-bold">{p.name}</h3>
                <p className="m-0 text-sm text-muted">{p.description}</p>
              </div>
              <p className="m-0">
                <span className="text-[34px] font-bold tracking-[-0.03em]">{formatPlanPrice(p, "MONTH")}</span>
                <span className="text-muted"> / month</span>
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
                {p.highlights.slice(0, 4).map((h) => (
                  <li key={h} className="flex items-start gap-2.5">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-blue" />
                    {h}
                  </li>
                ))}
              </ul>
            </RiseIn>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <CtaButton size="lg" trailing={<ArrowRight aria-hidden className="size-[18px]" />} />
          <Link href="/pricing" className="inline-flex min-h-11 items-center gap-1.5 px-2 font-semibold">
            Compare every plan <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      </Container>
    </section>
  );
}
