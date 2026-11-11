import Link from "next/link";
import { Clapperboard, Coins, Film, MonitorSmartphone, Play, Sparkles } from "lucide-react";
import { cancelAdAction, captureScreensAction, loadCapturesAction, makeVariantsAction, runAdJobsNowAction, startAdAction } from "@/app/admin/(console)/(ai)/ad-brain/actions";
import { dateTime } from "@/lib/admin/format";
import type { AdJobView, adBrainOverview } from "@/lib/ad-brain/service";
import { isFinished } from "@/lib/ad-brain/status";
import { cn } from "@/lib/cn";
import { AutoRefresh } from "@/components/support-app/server/auto-refresh";
import { Button, Field, Textarea } from "@/components/ui";
import { CARD, EmptyState, ExpandCard, PageHeader, StatGrid, StatTile, StatusPill, type PillTone } from "../kit";
import { notice } from "../ui";
import { FormChips } from "../kit/form-chips";

export type AdBrainOverview = Awaited<ReturnType<typeof adBrainOverview>>;

const STATUS: Record<string, { label: string; tone: PillTone }> = {
  waiting: { label: "Waiting its turn", tone: "muted" },
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

const KIND_OPTIONS = [
  { value: "ad", label: "Ad", hint: "Sells BuPulse, still feels like content" },
  { value: "content", label: "Content", hint: "A tip or a moment, BuPulse only mentioned" },
];
const VARIANT_OPTIONS = [
  { value: "1x1", label: "Just this one" },
  { value: "3x1", label: "3 hooks" },
  { value: "1x2", label: "2 CTAs" },
  { value: "3x2", label: "3 hooks x 2 CTAs" },
];
/** The judge's hard-rule checks that went wrong (a spoken call to action is the one that must be true). */
const flagged = (c: Record<string, boolean>) => [...(c.fakeScreen ? ["AI-drawn screen"] : []), ...(c.watermark ? ["watermark"] : []), ...(c.spokenCta === false ? ["no spoken call to action"] : []), ...(c.musicTooLoud ? ["music too loud"] : []), ...(c.kinyarwandaAiVoice ? ["AI Kinyarwanda voice"] : [])];

/**
 * Admin -> Ad Brain (docs/AD_BRAIN.md): three figures, "Make an ad" and "Keep it moving" as cards, then a card per ad
 * (status, cost, judge, the video, the tagged plan, the progress log). The page (app/admin/(console)/(ai)/ad-brain)
 * loads the data; the admin preview draws it with made-up data.
 */
export function AdBrainView({ overview, jobs, message }: { overview: AdBrainOverview; jobs: AdJobView[]; message: { notice?: string; error?: string } }) {
  const open = jobs.some((j) => !isFinished(j.status));
  return (
    <>
      {open && <AutoRefresh ms={10_000} />}
      <PageHeader icon={Clapperboard} tone="violet" title="Ad Brain" description="BuPulse's own 30-second video ads, made by AI from brief to finished ad. Each one lands in the company account's Videos library and on the Posts page waiting for your OK; nothing is published on its own." />
      {message.notice && <p role="status" className={notice.ok}>{message.notice}</p>}
      {message.error && <p role="alert" className={notice.bad}>{message.error}</p>}
      {"error" in overview.account && <p role="alert" className={notice.warn}>{overview.account.error}</p>}
      <StatGrid cols={3} className="lg:grid-cols-3">
        <StatTile icon={Coins} tone="violet" label="Spent this month" value={`${money(overview.monthSpentUsd)} of ${money(overview.limits.monthlyUsd)}`} hint={`At most ${money(overview.limits.perAdUsd)} an ad. Change the limits in Settings.`} />
        <StatTile icon={Film} tone="violet" label="Ads made" value={String(jobs.filter((j) => j.status === "ready").length)} hint="The latest 20 are listed below." />
        <StatTile icon={MonitorSmartphone} tone="violet" label="Real screens" value={String(overview.screens)} hint="Real captures of BuPulse with real data; empty pages are kept out." />
      </StatGrid>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard icon={Sparkles} tone="violet" title="Make an ad" summary="About $2 to $3 and 15 to 30 minutes. One at a time." defaultOpen={!open}>
          <form action={startAdAction} className="flex flex-col gap-3">
            <FormChips name="kind" legend="What kind of video" defaultValue="ad" options={KIND_OPTIONS} />
            <FormChips name="variants" legend="Variants (ads only)" hint="Other hooks and CTAs on the same video, made after it. Each one costs about a hook clip and a CTA line (roughly $0.50 to $1)." defaultValue="1x1" options={VARIANT_OPTIONS} />
            <Field label="Notes for the brain (optional)" hint="A goal or a feature to push, e.g. “Autopilot” or “posts in Kinyarwanda”. Leave empty to let it choose.">
              <Textarea name="notes" rows={3} maxLength={600} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={open}>Make it</Button>
            </div>
          </form>
          {overview.fixtures && (
            <form action={startAdAction} className="mt-3 border-t border-line pt-3">
              <p className="mb-2 text-[13px] text-muted">Tests and development: re-render a cached ad from its files with the production renderer, then judge it (about 1 cent) and deliver it.</p>
              <FormChips name="fixture" legend="Cached ad" hideLegend defaultValue="twist" className="mb-2" options={[{ value: "twist", label: "“Who's real?” (10 Nov)" }, { value: "wall", label: "Poster wall" }]} />
              <Button type="submit" variant="outline" size="sm" disabled={open}>Re-render the cached ad</Button>
            </form>
          )}
        </ExpandCard>
        <ExpandCard icon={Play} tone="violet" title="Keep it moving" summary="The scheduled jobs move ads on every 4 minutes.">
          <div className="flex flex-col gap-3 text-[14px]">
            <form action={runAdJobsNowAction}>
              <Button type="submit" size="sm">Move it on now</Button>
            </form>
            <form action={captureScreensAction} className="flex flex-col gap-1">
              <p className="text-[13px] text-muted">
                The screen robot opens the company account&apos;s real pages (read only) and captures them at phone and desktop size. It does this by itself when the captures are a day old.{" "}
                {overview.capturedAt ? `Last capture: ${dateTime(overview.capturedAt)}.` : "No capture yet."}
              </p>
              <div>
                <Button type="submit" variant="outline" size="sm">Capture the screens now</Button>
              </div>
            </form>
            {overview.fixtures && (
              <form action={loadCapturesAction} className="flex flex-col gap-1">
                <p className="text-[13px] text-muted">Tests and development only: the 10 November captures from this computer&apos;s prototype folder, used while there is no robot capture.</p>
                <div>
                  <Button type="submit" variant="ghost" size="sm">Load the prototype captures</Button>
                </div>
              </form>
            )}
            <p className="text-[13px] text-muted">
              Limits: <Link href="/admin/settings/ad-brain">Settings, Ad Brain limits</Link>. Costs: <Link href="/admin/ai">AI calls and spend</Link> (feature “adBrain”).
            </p>
          </div>
        </ExpandCard>
      </div>

      {jobs.length === 0 ? <EmptyState icon={Clapperboard} title="No ads yet" hint="Press “Capture the screens now”, then “Make an ad”." /> : <div className="flex flex-col gap-3">{jobs.map((j) => <JobCard key={j.id} job={j} />)}</div>}
    </>
  );
}

function JobCard({ job }: { job: AdJobView }) {
  const s = STATUS[job.status] ?? { label: job.status, tone: "muted" as PillTone };
  return (
    <article className={cn(CARD, "flex flex-col gap-3 p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={s.tone} dot>{s.label}</StatusPill>
          <StatusPill tone={job.kind === "content" ? "info" : "muted"}>{job.kind === "content" ? "Content" : "Ad"}</StatusPill>
          {job.variantLabel && <StatusPill tone="muted">Variant: {job.variantLabel}</StatusPill>}
          <span className="text-[13px] text-muted">{dateTime(job.createdAt)}{job.mode !== "real" ? " · cached plan" : ""}</span>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <span className="font-semibold">{money(job.costUsd)}</span>
          {job.overall !== null && <StatusPill tone={job.overall >= 7 ? "good" : "warn"}>Judge {job.overall}/10</StatusPill>}
          {!isFinished(job.status) && (
            <form action={cancelAdAction}>
              <input type="hidden" name="id" value={job.id} />
              <Button type="submit" variant="ghost" size="sm">Cancel</Button>
            </form>
          )}
        </div>
      </div>
      {job.line && <p className="text-[14px]"><span className="font-semibold">{job.recipe}</span>: {job.line}</p>}
      {job.effects.length > 0 && <p className="text-[13px] text-muted">Effects: {job.effects.join(", ")}</p>}
      {job.ctaText && <p className="text-[13px] text-muted">Spoken CTA: “{job.ctaText}”</p>}
      {job.error && <p className={notice.warn}>{job.error}</p>}
      {job.canVary && (
        <form action={makeVariantsAction} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <input type="hidden" name="id" value={job.id} />
          <FormChips name="variants" legend="Make variants of this ad" defaultValue="3x1" options={VARIANT_OPTIONS.slice(1)} />
          <Button type="submit" variant="outline" size="sm">Make variants</Button>
        </form>
      )}
      <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
        {job.videoUrl ? <video src={job.videoUrl} controls playsInline preload="metadata" className="aspect-[9/16] w-full max-w-[240px] rounded-xl bg-black" /> : <div className="hidden lg:block" />}
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
          {job.postGroupId && <Link href="/dashboard/content" className="text-[13px]">Open the Posts page (signed in as the BuPulse company account) to approve it.</Link>}
        </div>
      </div>
    </article>
  );
}
