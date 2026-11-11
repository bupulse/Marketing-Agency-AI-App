import Link from "next/link";
import { Clapperboard, Coins, Film, MonitorSmartphone, Play, Sparkles } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { adBrainOverview, listAdJobs, type AdJobView } from "@/lib/ad-brain/service";
import { TERMINAL } from "@/lib/ad-brain/pipeline";
import { CARD, EmptyState, ExpandCard, PageHeader, StatGrid, StatTile, StatusPill, type PillTone } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { AutoRefresh } from "@/components/support-app/server/auto-refresh";
import { Button, Field, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { cancelAdAction, loadCapturesAction, runAdJobsNowAction, startAdAction } from "./actions";

export const metadata = { title: "Ad Brain" };

const STATUS: Record<string, { label: string; tone: PillTone }> = {
  queued: { label: "Queued", tone: "info" },
  understanding: { label: "Reading BuPulse", tone: "info" },
  concept: { label: "Choosing the concept", tone: "info" },
  script: { label: "Writing the script", tone: "info" },
  assets: { label: "Making the pictures and clips", tone: "info" },
  rendering: { label: "Editing", tone: "info" },
  judging: { label: "Being judged", tone: "info" },
  delivering: { label: "Saving", tone: "info" },
  ready: { label: "Ready", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  stopped: { label: "Stopped (limit)", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

const money = (n: number) => `$${n.toFixed(2)}`;
/** The judge's hard-rule checks that went wrong (a spoken call to action is the one that must be true). */
const flagged = (c: Record<string, boolean>) => [...(c.fakeScreen ? ["AI-drawn screen"] : []), ...(c.watermark ? ["watermark"] : []), ...(c.spokenCta === false ? ["no spoken call to action"] : []), ...(c.musicTooLoud ? ["music too loud"] : []), ...(c.kinyarwandaAiVoice ? ["AI Kinyarwanda voice"] : [])];

/** Admin -> Ad Brain: BuPulse's own self-made video ads (docs/AD_BRAIN.md). */
export default async function AdBrainPage({ searchParams }: PageProps<"/admin/ad-brain">) {
  await requirePermission("ai"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [overview, jobs] = await Promise.all([adBrainOverview(), listAdJobs(20)]);
  const open = jobs.some((j) => !(TERMINAL as readonly string[]).includes(j.status));
  return (
    <>
      {open && <AutoRefresh ms={10_000} />}
      <PageHeader icon={Clapperboard} tone="violet" title="Ad Brain" description="BuPulse's own 30-second video ads, made by AI from brief to finished ad. Each one lands in the company account's Videos library and on the Posts page waiting for your OK; nothing is published on its own." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {"error" in overview.account && <p role="alert" className={notice.warn}>{overview.account.error}</p>}
      <StatGrid cols={3} className="lg:grid-cols-3">
        <StatTile icon={Coins} tone="violet" label="Spent this month" value={`${money(overview.monthSpentUsd)} of ${money(overview.limits.monthlyUsd)}`} hint={`At most ${money(overview.limits.perAdUsd)} an ad. Change the limits in Settings.`} />
        <StatTile icon={Film} tone="violet" label="Ads made" value={String(jobs.filter((j) => j.status === "ready").length)} hint="The latest 20 are listed below." />
        <StatTile icon={MonitorSmartphone} tone="violet" label="Real screens" value={String(overview.screens)} hint="Ads only ever show real captures of BuPulse." />
      </StatGrid>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard icon={Sparkles} tone="violet" title="Make an ad" summary="About $2 to $3 and 15 to 30 minutes. One at a time." defaultOpen={!open}>
          <form action={startAdAction} className="flex flex-col gap-3">
            <Field label="Notes for the brain (optional)" hint="A goal or a feature to push, e.g. “Autopilot” or “posts in Kinyarwanda”. Leave empty to let it choose.">
              <Textarea name="notes" rows={3} maxLength={600} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={open}>Make an ad</Button>
            </div>
          </form>
          <form action={startAdAction} className="mt-3 border-t border-line pt-3">
            <input type="hidden" name="fixture" value="twist" />
            <p className="mb-2 text-[13px] text-muted">Free test: re-render the 10 November “Who&apos;s real?” ad from its cached files with the production renderer, then judge it (about $0.02) and deliver it.</p>
            <Button type="submit" variant="outline" size="sm" disabled={open}>Re-render the cached ad</Button>
          </form>
        </ExpandCard>
        <ExpandCard icon={Play} tone="violet" title="Keep it moving" summary="The scheduled jobs move ads on every 4 minutes.">
          <div className="flex flex-col gap-3 text-[14px]">
            <form action={runAdJobsNowAction}>
              <Button type="submit" size="sm">Move it on now</Button>
            </form>
            <form action={loadCapturesAction} className="flex flex-col gap-1">
              <p className="text-[13px] text-muted">Until the screen robot is built, the real dashboard captures of 10 November are loaded from this computer&apos;s prototype folder.</p>
              <div>
                <Button type="submit" variant="outline" size="sm">Load the real captures</Button>
              </div>
            </form>
            <p className="text-[13px] text-muted">
              Limits: <Link href="/admin/settings/content#ad-brain">Settings, Daily posts and videos</Link>. Costs: <Link href="/admin/ai">AI calls and spend</Link> (feature “adBrain”).
            </p>
          </div>
        </ExpandCard>
      </div>

      {jobs.length === 0 ? <EmptyState icon={Clapperboard} title="No ads yet" hint="Press “Make an ad”, or try the free cached one first." /> : <div className="flex flex-col gap-3">{jobs.map((j) => <JobCard key={j.id} job={j} />)}</div>}
    </>
  );
}

function JobCard({ job }: { job: AdJobView }) {
  const s = STATUS[job.status] ?? { label: job.status, tone: "muted" as PillTone };
  const done = (TERMINAL as readonly string[]).includes(job.status);
  return (
    <article className={cn(CARD, "flex flex-col gap-3 p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={s.tone} dot>{s.label}</StatusPill>
          <span className="text-[13px] text-muted">{dateTime(job.createdAt)}{job.mode !== "real" ? " · cached plan" : ""}</span>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <span className="font-semibold">{money(job.costUsd)}</span>
          {job.overall !== null && <StatusPill tone={job.overall >= 7 ? "good" : "warn"}>Judge {job.overall}/10</StatusPill>}
          {!done && (
            <form action={cancelAdAction}>
              <input type="hidden" name="id" value={job.id} />
              <Button type="submit" variant="ghost" size="sm">Cancel</Button>
            </form>
          )}
        </div>
      </div>
      {job.line && <p className="text-[14px]"><span className="font-semibold">{job.recipe}</span>: {job.line}</p>}
      {job.effects.length > 0 && <p className="text-[13px] text-muted">Effects: {job.effects.join(", ")}</p>}
      {job.error && <p className={notice.warn}>{job.error}</p>}
      <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
        {job.videoUrl ? (
          <video src={job.videoUrl} controls playsInline preload="metadata" className="aspect-[9/16] w-full max-w-[240px] rounded-xl bg-black" />
        ) : (
          <div className="hidden lg:block" />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          {job.segments.length > 0 && (
            <ExpandCard title="The plan" summary={`${job.segments.length} segments, ${job.seconds?.toFixed(1)} s`}>
              <ol className="flex flex-col gap-1 text-[13px]">
                {job.segments.map((g) => (
                  <li key={g.id} className="min-w-0">
                    <span className="font-mono text-muted">{g.start.toFixed(1)}-{g.end.toFixed(1)}</span> <span className="font-semibold">{g.id}</span> <span className="text-muted">[{g.source}]</span>
                    {g.tags?.act && <> [ACT] {g.tags.act}</>}
                    {g.tags?.audio && <> [AUDIO] {g.tags.audio}</>}
                    {g.tags?.fx && <> [FX] {g.tags.fx}</>}
                    {g.tags?.title && <> [TITLE] {g.tags.title}</>}
                  </li>
                ))}
              </ol>
            </ExpandCard>
          )}
          {job.scores && (
            <p className="text-[13px] text-muted">
              {Object.entries(job.scores).map(([k, v]) => `${k} ${v}`).join(" · ")}
              {job.checks && ` · hard rules flagged: ${flagged(job.checks).join(", ") || "none"}`}
            </p>
          )}
          {job.caption && <p className="text-[13px]"><span className="font-semibold">Caption:</span> {job.caption} {job.hashtags.map((h) => `#${h}`).join(" ")}</p>}
          <ExpandCard title="Progress" summary={job.log.at(-1)?.note ?? "Waiting to start."}>
            <ol className="flex flex-col gap-1 text-[13px]">
              {job.log.map((l, i) => (
                <li key={i}><span className="text-muted">{dateTime(l.at)}</span> <span className="font-semibold">{l.step}</span>: {l.note}</li>
              ))}
            </ol>
          </ExpandCard>
          {job.postGroupId && <Link href="/dashboard/posts" className="text-[13px]">Open the Posts page (sign in as the BuPulse company account) to approve it.</Link>}
        </div>
      </div>
    </article>
  );
}
