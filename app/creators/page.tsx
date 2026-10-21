import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Smartphone, Wallet } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { CampaignCard } from "@/components/creators/marketplace/campaign-card";
import { MarketFiltersForm } from "@/components/creators/marketplace/filters";
import { CreatorsFrame } from "@/components/creators/marketplace/header";
import { publicViewer } from "@/lib/creators/auth";
import { hasFilters, readMarketFilters } from "@/lib/creators/market-filters";
import { marketplace } from "@/lib/creators/marketplace";

export const dynamic = "force-dynamic";

// The creator marketplace (docs/CREATOR_MARKETPLACE.md): every listed campaign, filtered by the query string
// (platform, sort=pay, type, when), each linking to its page /c/<slug>. Public and indexed.

export const metadata: Metadata = {
  title: "Creator campaigns: get paid for your views",
  description: "Companies in Rwanda pay content creators for the views their posts make. Find a campaign, post on your own Instagram, Facebook or TikTok, and get paid by Mobile Money.",
  alternates: { canonical: "/creators" },
};

const STEPS = [
  { icon: Smartphone, title: "Pick a campaign", text: "Read the brief and the pay, then apply. With a creator account it takes one tap." },
  { icon: BadgeCheck, title: "Post on your account", text: "Post the day's task on your own Instagram, Facebook Page or TikTok and hand in the link." },
  { icon: Wallet, title: "Get paid for views", text: "BuPulse counts your views. The company pays you by Mobile Money after each month." },
];

export default async function CreatorsPage({ searchParams }: PageProps<"/creators">) {
  const filters = readMarketFilters(await searchParams);
  const [{ cards, total, types }, viewer] = await Promise.all([marketplace(filters), publicViewer()]);

  return (
    <CreatorsFrame viewer={viewer.kind}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-16 pt-6 sm:px-6">
        <section className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold leading-tight tracking-[-0.03em] sm:text-5xl">Get paid for your posts</h1>
          <p className="max-w-2xl text-[15px] text-muted sm:text-lg">
            Companies pay creators for the views their posts make. Find a campaign, post on your own account, and get paid by Mobile Money.
          </p>
          {viewer.kind === "guest" && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button href="/creators/signup">Make a creator account</Button>
              <Link href="/login?next=/creator" className="inline-flex min-h-11 items-center text-sm font-semibold text-pulse-blue underline">I have an account</Link>
            </div>
          )}
          {viewer.kind === "company" && (
            <p role="status" className="rounded-field bg-soft px-4 py-3 text-sm font-medium">
              Creators apply with a creator account. To run a campaign for your company, open Creators in your <Link href="/dashboard/creators" className="underline">dashboard</Link>.
            </p>
          )}
        </section>

        <GlassCard padding="none" className="p-4">
          <MarketFiltersForm filters={filters} types={types} />
        </GlassCard>

        <section aria-labelledby="list" className="flex flex-col gap-3">
          <h2 id="list" className="text-sm font-semibold text-muted">
            {cards.length === 1 ? "1 campaign" : `${cards.length} campaigns`}
            {hasFilters(filters) && total !== cards.length ? ` of ${total}` : ""}
          </h2>
          {cards.length === 0 ? (
            <GlassCard padding="lg" className="flex flex-col items-start gap-3">
              <p className="text-[15px] font-medium">{total === 0 ? "No campaigns are open right now. New ones come often: make your account now, and you can apply in one tap when they do." : "No campaign matches these filters."}</p>
              {total > 0 ? <Button href="/creators" size="sm" variant="outline">Show all campaigns</Button> : viewer.kind === "guest" ? <Button href="/creators/signup" size="sm">Make a creator account</Button> : null}
            </GlassCard>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => (
                <CampaignCard key={c.id} card={c} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-3 pt-4">
          <h2 id="how" className="text-xl font-semibold tracking-tight">How it works</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }) => (
              <GlassCard key={title} padding="none" className="flex flex-col gap-2 p-4">
                <Icon aria-hidden className="size-6 text-pulse-violet" />
                <h3 className="text-[15px] font-semibold">{title}</h3>
                <p className="text-sm text-muted">{text}</p>
              </GlassCard>
            ))}
          </div>
          <p className="text-[13px] text-muted">
            Free for creators. Each company shows its payment record: how many creators it paid and how fast. Something wrong with a campaign? Report it from its page.
          </p>
        </section>
      </main>
    </CreatorsFrame>
  );
}
