import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { PayoutStatus, PostStatus } from "@/components/creators/portal/post-status";
import { requireCreator } from "@/lib/creators/auth";
import { amount, count, formatDay, formatSpan, networkLabel, creatorPayInWords, taskRuleInWords } from "@/lib/creators/describe";
import { dayIn, ymdOf } from "@/lib/creators/periods";
import { campaignForCreator } from "@/lib/creators/portal";
import { coversDay } from "@/lib/creators/tasks";

export const metadata: Metadata = { title: "Campaign" };

/** The last day of a period ("YYYY-MM-DD"): the day before its end. */
const lastDayOf = (endsAt: Date, tz: string) => dayIn(new Date(endsAt.getTime() - 1), tz);

export default async function CreatorCampaignPage({ params }: PageProps<"/creator/campaigns/[id]">) {
  const { id } = await params;
  const { profile } = await requireCreator();
  const data = await campaignForCreator(profile.id, id);
  if (!data) notFound();
  const { campaign, tasks, posts, periods, membership } = data;
  const tz = campaign.business.timezone || "UTC";
  const today = dayIn(new Date(), tz);
  const open = periods.find((p) => p.status === "OPEN");
  const pay = creatorPayInWords(campaign.payRules, { viewTargetPerCreator: campaign.viewTargetPerCreator, viewTargetCampaign: campaign.viewTargetCampaign }, campaign.currency);
  const canHandIn = membership.status === "JOINED" && campaign.status === "LIVE";

  return (
    <>
      <Link href="/creator" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted no-underline hover:text-text">
        <ArrowLeft aria-hidden className="size-4" /> Campaigns
      </Link>
      <div>
        <p className="text-sm font-medium text-muted">{campaign.business.name}</p>
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{campaign.name}</h1>
        <p className="text-sm text-muted">{formatSpan(ymdOf(campaign.startsOn), ymdOf(campaign.endsOn))}</p>
      </div>
      {membership.status === "REMOVED" && <p role="status" className="rounded-field bg-soft px-4 py-3 text-sm font-medium">The company took you off this campaign. Your earnings and payouts stay here.</p>}
      {campaign.status === "PAUSED" && <p role="status" className="rounded-field bg-soft px-4 py-3 text-sm font-medium">The company paused this campaign. Your posts keep counting views; hand-ins open again when it goes on.</p>}

      {open && (
        <GlassCard padding="none" className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Earned this month</p>
            <p className="text-2xl font-bold">{amount(open.earned, campaign.currency)}</p>
            <p className="text-xs text-muted">Until {formatDay(lastDayOf(open.endsAt, tz))}, paid after</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Views this month</p>
            <p className="text-xl font-semibold">{count(open.views)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Views that earn</p>
            <p className="text-xl font-semibold">{count(open.countedViews)}</p>
          </div>
        </GlassCard>
      )}

      <section aria-labelledby="tasks" className="flex flex-col gap-3">
        <h2 id="tasks" className="text-lg font-semibold tracking-tight">Tasks</h2>
        {tasks.length === 0 && <p className="text-[15px] text-muted">The company has not added tasks yet.</p>}
        {tasks.map((t) => {
          const now = coversDay(t, today);
          return (
            <GlassCard key={t.id} padding="none" className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{t.title}</p>
                  <p className="text-sm text-muted">{formatSpan(ymdOf(t.startsOn), ymdOf(t.endsOn))} · {taskRuleInWords(t)}</p>
                </div>
                {canHandIn && ymdOf(t.startsOn) <= today && (
                  <Button href={`/creator/tasks/${t.id}${now ? `?day=${today}` : ""}`} size="sm" variant={now ? "primary" : "outline"}>
                    {now ? "Hand in" : "Open"}
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{t.instructions}</p>
            </GlassCard>
          );
        })}
      </section>

      <section aria-labelledby="posts" className="flex flex-col gap-3">
        <h2 id="posts" className="text-lg font-semibold tracking-tight">Your posts</h2>
        {posts.length === 0 && <p className="text-[15px] text-muted">Nothing handed in yet.</p>}
        {posts.map((p) => (
          <GlassCard key={p.id} padding="none" className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <PostStatus status={p.status} />
              <span className="text-sm font-semibold">{networkLabel(p.network)}</span>
              <span className="text-sm text-muted">{p.submission.title} · {formatDay(ymdOf(p.submission.day))}</span>
            </div>
            {p.statusReason && <p className="text-sm text-muted">{p.statusReason}</p>}
            {(p.status === "TRACKING" || p.status === "FINAL" || p.views > 0) && (
              <p className="text-sm">
                <span className="font-semibold">{count(p.views)}</span> views · {count(p.likes)} likes · {count(p.comments)} comments · {count(p.shares)} shares
              </p>
            )}
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start break-all text-sm text-pulse-blue">
              Open the post <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </GlassCard>
        ))}
      </section>

      {periods.length > 0 && (
        <section aria-labelledby="months" className="flex flex-col gap-3">
          <h2 id="months" className="text-lg font-semibold tracking-tight">Months</h2>
          {periods.map((p) => (
            <GlassCard key={p.id} padding="none" className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <p className="text-[15px] font-semibold">Month {p.index}</p>
                <p className="text-sm text-muted">{formatSpan(dayIn(p.startsAt, tz), lastDayOf(p.endsAt, tz))} · {count(p.views)} views</p>
                {p.payout?.reference && <p className="text-sm text-muted">Reference {p.payout.reference}</p>}
                {p.payout && p.payout.deductions > 0 && <p className="text-sm text-muted">{amount(p.payout.deductions, campaign.currency)} taken off for posts that stopped earning</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold">{amount(p.payout?.amount ?? p.earned, campaign.currency)}</span>
                {p.payout ? <PayoutStatus status={p.payout.status} /> : <span className="text-xs text-muted">{p.status === "OPEN" ? "so far" : "nothing earned"}</span>}
              </div>
            </GlassCard>
          ))}
        </section>
      )}

      <section aria-labelledby="about" className="flex flex-col gap-3">
        <h2 id="about" className="text-lg font-semibold tracking-tight">About the campaign</h2>
        <GlassCard padding="none" className="flex flex-col gap-3 p-4">
          <p className="whitespace-pre-wrap text-sm">{campaign.brief}</p>
          {campaign.rules && (
            <>
              <h3 className="text-sm font-semibold">Rules</h3>
              <p className="whitespace-pre-wrap text-sm">{campaign.rules}</p>
            </>
          )}
          {campaign.mentions.length > 0 && <p className="text-sm">Each caption must include {campaign.mentions.length > 1 ? `one of ${campaign.mentions.join(", ")}` : campaign.mentions[0]}.</p>}
          {pay.length > 0 && (
            <>
              <h3 className="text-sm font-semibold">Pay</h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {pay.map((l) => (
                  <li key={l}>{l}.</li>
                ))}
              </ul>
            </>
          )}
        </GlassCard>
      </section>
    </>
  );
}
