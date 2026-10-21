import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ChevronRight, CircleCheck } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { CompanyLogo } from "@/components/creators/marketplace/campaign-card";
import { requireCreator } from "@/lib/creators/auth";
import { formatSpan, taskRuleInWords } from "@/lib/creators/describe";
import { logoUrls } from "@/lib/creators/logos";
import { dayIn, ymdOf } from "@/lib/creators/periods";
import { todaysTasks } from "@/lib/creators/portal";
import { coversDay } from "@/lib/creators/tasks";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Tasks" };

// Tasks (docs/CREATOR_MARKETPLACE.md, "The creator's dashboard", owner decision: pick, then tasks): first the joined
// campaigns with what is due today; tapping one (?campaign=<id>) shows only that campaign's tasks. With one campaign it
// opens straight into it.

export default async function TasksPage({ searchParams }: PageProps<"/creator/tasks">) {
  const query = await searchParams;
  const { profile } = await requireCreator();
  const [joined, today] = await Promise.all([
    prisma.campaignCreator.findMany({
      where: { profileId: profile.id, status: "JOINED", campaign: { status: { not: "ENDED" } } },
      orderBy: { joinedAt: "desc" },
      select: { campaign: { select: { id: true, name: true, status: true, business: { select: { name: true, logoUrl: true, timezone: true } } } } },
    }),
    todaysTasks(profile.id),
  ]);
  const campaigns = joined.map((j) => j.campaign);
  const asked = typeof query.campaign === "string" ? campaigns.find((c) => c.id === query.campaign) : undefined;
  const chosen = asked ?? (campaigns.length === 1 ? campaigns[0] : undefined);

  if (!chosen) {
    const logos = await logoUrls(campaigns.map((c) => c.business.logoUrl));
    return (
      <>
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Tasks</h1>
        {campaigns.length === 0 ? (
          <GlassCard padding="md" className="flex flex-col items-start gap-3">
            <p className="text-[15px] text-muted">No tasks yet: they come with the campaigns you join.</p>
            <Button href="/creators" size="sm">Find campaigns</Button>
          </GlassCard>
        ) : (
          <>
            <p className="text-[15px] text-muted">Pick a campaign to see its tasks.</p>
            {campaigns.map((c) => {
              const mine = today.filter((t) => t.campaign.id === c.id);
              const left = mine.filter((t) => t.left > 0).length;
              return (
                <Link key={c.id} href={`/creator/tasks?campaign=${c.id}`} className="glass flex items-center gap-3 rounded-glass p-4 no-underline hover:bg-soft">
                  <CompanyLogo name={c.business.name} url={c.business.logoUrl ? (logos.get(c.business.logoUrl) ?? null) : null} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">{c.business.name}</p>
                    <p className="truncate text-[15px] font-semibold">{c.name}</p>
                    <p className={`text-sm ${left ? "font-medium text-pulse-violet" : "text-muted"}`}>
                      {c.status !== "LIVE" ? (c.status === "PAUSED" ? "Paused" : "Not started yet") : mine.length === 0 ? "Nothing due today" : left === 0 ? "Done for today" : `${left} task${left === 1 ? "" : "s"} to hand in today`}
                    </p>
                  </div>
                  <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
                </Link>
              );
            })}
          </>
        )}
      </>
    );
  }

  const tz = chosen.business.timezone || "UTC";
  const day = dayIn(new Date(), tz);
  const mine = today.filter((t) => t.campaign.id === chosen.id);
  const tasks = await prisma.creatorTask.findMany({ where: { campaignId: chosen.id }, orderBy: { startsOn: "asc" } });
  const others = tasks.filter((t) => !coversDay(t, day));
  const live = chosen.status === "LIVE";

  return (
    <>
      {campaigns.length > 1 && (
        <Link href="/creator/tasks" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted no-underline hover:text-text">
          <ArrowLeft aria-hidden className="size-4" /> All campaigns
        </Link>
      )}
      <div>
        <p className="text-sm font-medium text-muted">{chosen.business.name}</p>
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{chosen.name}</h1>
        <Link href={`/creator/campaigns/${chosen.id}`} className="text-sm font-medium text-pulse-blue underline">Campaign, posts and pay</Link>
      </div>
      {!live && <p role="status" className="rounded-field bg-soft px-4 py-3 text-sm font-medium">{chosen.status === "PAUSED" ? "The company paused this campaign. Hand-ins open again when it goes on." : "This campaign has not started yet."}</p>}

      <section aria-labelledby="today" className="flex flex-col gap-3">
        <h2 id="today" className="text-lg font-semibold tracking-tight">Today</h2>
        {mine.length === 0 ? (
          <p className="text-[15px] text-muted">Nothing to post today.</p>
        ) : (
          mine.map((t) => (
            <GlassCard key={`${t.task.id}|${t.day}`} padding="none" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">{t.task.title}</p>
                <p className="text-sm text-muted">{taskRuleInWords(t.task)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                  {t.left === 0 ? <CircleCheck aria-hidden className="size-4 text-success" /> : null}
                  {t.handedIn} of {t.due} handed in
                </p>
              </div>
              <Button href={`/creator/tasks/${t.task.id}?day=${t.day}`} size="sm" variant={t.left > 0 ? "primary" : "outline"} className="shrink-0">
                {t.left > 0 ? "Hand in" : "See"}
              </Button>
            </GlassCard>
          ))
        )}
      </section>

      {others.length > 0 && (
        <section aria-labelledby="other" className="flex flex-col gap-3">
          <h2 id="other" className="text-lg font-semibold tracking-tight">Other days</h2>
          {others.map((t) => {
            const started = ymdOf(t.startsOn) <= day;
            return (
              <GlassCard key={t.id} padding="none" className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{t.title}</p>
                  <p className="text-sm text-muted">{formatSpan(ymdOf(t.startsOn), ymdOf(t.endsOn))} · {taskRuleInWords(t)}</p>
                </div>
                {live && started && <Button href={`/creator/tasks/${t.id}`} size="sm" variant="outline">Open</Button>}
              </GlassCard>
            );
          })}
        </section>
      )}
    </>
  );
}
