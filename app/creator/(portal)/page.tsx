import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, CircleCheck, ChevronRight } from "lucide-react";
import { Badge, Button, GlassCard } from "@/components/ui";
import { PostStatus } from "@/components/creators/portal/post-status";
import { requireCreator } from "@/lib/creators/auth";
import { formatSpan, isCreatorNetwork, listWords, NETWORK_LABEL, networkLabel, taskRuleInWords } from "@/lib/creators/describe";
import { ymdOf } from "@/lib/creators/periods";
import { myCampaigns, recentlyStopped, todaysTasks } from "@/lib/creators/portal";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Your campaigns" };

const CAMPAIGN_STATUS: Record<string, string> = { LIVE: "Live", PAUSED: "Paused", ENDED: "Ended", DRAFT: "Not started" };

export default async function CreatorHome() {
  const { profile } = await requireCreator();
  const [campaigns, today, stopped, connections] = await Promise.all([
    myCampaigns(profile.id),
    todaysTasks(profile.id),
    recentlyStopped(profile.id),
    prisma.creatorConnection.findMany({ where: { profileId: profile.id, status: "ACTIVE" }, select: { network: true } }),
  ]);
  const connected = new Set(connections.map((c) => c.network));
  const needed = [...new Set(campaigns.filter((c) => c.status === "JOINED" && c.campaign.status === "LIVE").flatMap((c) => c.campaign.platforms))].filter((n) => isCreatorNetwork(n) && !connected.has(n));
  const first = profile.name.split(/\s+/)[0];

  return (
    <>
      <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Hi {first}</h1>

      {needed.length > 0 && (
        <GlassCard padding="none" role="status" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-[15px] font-medium">
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-violet" />
            Connect your {listWords(needed.map(networkLabel))}: BuPulse reads your views from your connected accounts, and only their posts count.
          </p>
          <Button href="/creator/connections" size="sm" className="shrink-0">Connect</Button>
        </GlassCard>
      )}

      {stopped.length > 0 && (
        <GlassCard padding="none" className="flex flex-col gap-2 p-4">
          <h2 className="text-[15px] font-semibold">Stopped earning lately</h2>
          <ul className="flex flex-col gap-2">
            {stopped.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <PostStatus status={p.status} />
                  <Link href={`/creator/campaigns/${p.campaign.id}`} className="font-medium underline">{p.campaign.name}</Link>
                  <span className="text-muted">{networkLabel(p.network)}</span>
                </span>
                {p.statusReason && <span className="text-muted">{p.statusReason}</span>}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <section aria-labelledby="today" className="flex flex-col gap-3">
        <h2 id="today" className="text-lg font-semibold tracking-tight">Today&apos;s tasks</h2>
        {today.length === 0 ? (
          <p className="text-[15px] text-muted">{campaigns.some((c) => c.campaign.status === "LIVE") ? "Nothing to post today." : "No tasks yet."}</p>
        ) : (
          today.map((t) => (
            <GlassCard key={`${t.task.id}|${t.day}`} padding="none" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t.campaign.name}</p>
                <p className="text-[15px] font-semibold">{t.task.title}</p>
                <p className="text-sm text-muted">{taskRuleInWords(t.task)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                  {t.left === 0 ? <CircleCheck aria-hidden className="size-4 text-success" /> : null}
                  {t.handedIn} of {t.due} handed in
                </p>
              </div>
              {t.left > 0 ? (
                <Button href={`/creator/tasks/${t.task.id}?day=${t.day}`} size="sm" className="shrink-0">Hand in</Button>
              ) : (
                <Button href={`/creator/tasks/${t.task.id}?day=${t.day}`} size="sm" variant="outline" className="shrink-0">See</Button>
              )}
            </GlassCard>
          ))
        )}
      </section>

      <section aria-labelledby="campaigns" className="flex flex-col gap-3">
        <h2 id="campaigns" className="text-lg font-semibold tracking-tight">Your campaigns</h2>
        {campaigns.length === 0 ? (
          <GlassCard padding="md">
            <p className="text-[15px] text-muted">No campaigns yet. When a company picks you, you get an email with a link, and its campaign appears here.</p>
          </GlassCard>
        ) : (
          campaigns.map(({ id, status, campaign }) => (
            <Link key={id} href={`/creator/campaigns/${campaign.id}`} className="glass flex items-center justify-between gap-3 rounded-glass p-4 no-underline hover:bg-soft">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{campaign.business.name}</p>
                <p className="truncate text-[15px] font-semibold">{campaign.name}</p>
                <p className="text-sm text-muted">
                  {formatSpan(ymdOf(campaign.startsOn), ymdOf(campaign.endsOn))} · {listWords(campaign.platforms.filter(isCreatorNetwork).map((n) => NETWORK_LABEL[n]))}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={status === "REMOVED" ? "danger" : campaign.status === "LIVE" ? "success" : "neutral"}>{status === "REMOVED" ? "Left" : (CAMPAIGN_STATUS[campaign.status] ?? campaign.status)}</Badge>
                <ChevronRight aria-hidden className="size-5 text-muted" />
              </div>
            </Link>
          ))
        )}
      </section>
    </>
  );
}
