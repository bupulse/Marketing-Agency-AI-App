"use client";

import { CalendarCheck, CheckCheck, Clapperboard, ImageIcon, Info, Pencil, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { approveAllPosts, planNextWeek, regeneratePlannedPost, removePlannedPost } from "@/app/dashboard/autopilot/actions";
import { AccountAvatar } from "@/components/publishing/network-icon";
import { ContentVisual } from "@/components/visuals/content-visual";
import { Badge, Button, GlassCard, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AutopilotView, ViewCard, ViewDay } from "@/lib/autopilot/view";
import { MediaThumb } from "@/components/visuals/media-thumb";

const GOAL_LABEL = { awareness: "Awareness", engagement: "Engagement", sales: "Sales", trust: "Trust" } as const;

function dayLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`));
}

function timeLabel(iso: string | null, timeZone: string) {
  if (!iso) return "No time set";
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

const FORMAT_LABEL: Record<string, string> = { ARTICLE: "Article", CAROUSEL: "Carousel", SCRIPT: "Video script" };

function PostCard({ card, timeZone, videoInPlan }: { card: ViewCard; timeZone: string; videoInPlan: boolean }) {
  const [active, setActive] = useState(card.posts[0]?.id);
  // The picture and video panel; opening it makes a pending video (one card at a time, not the whole week at once).
  const [visualOpen, setVisualOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const post = card.posts.find((p) => p.id === active) ?? card.posts[0];
  const cover = card.posts.flatMap((p) => p.mediaUrls)[0];

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    start(async () => {
      const result = await action();
      toast(result.ok ? (result.message ?? "Done.") : (result.error ?? "Something went wrong."), result.ok ? "success" : "error");
    });
  }

  return (
    <GlassCard as="article" aria-label={card.ideaName} className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <div className="flex gap-4">
        <div className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-2xl bg-soft sm:w-28">
          {cover ? (
            <MediaThumb url={cover} className="size-full object-cover" loading="lazy" />
          ) : (
            <span className="flex size-full items-center justify-center text-muted">
              <ImageIcon aria-hidden className="size-6" />
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] leading-tight font-semibold tracking-[-0.02em]">{card.ideaName}</h3>
            {card.goal && <Badge tone="violet">{GOAL_LABEL[card.goal]}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {card.status === "PENDING_APPROVAL" && <Badge tone="blue">Needs your approval</Badge>}
            {card.status === "SCHEDULED" && <Badge tone="success">Scheduled</Badge>}
            {card.status === "DRAFT" && <Badge tone="danger">Needs a picture</Badge>}
            {card.image?.kind === "carousel" && <Badge tone="neutral">Carousel</Badge>}
            {card.video?.status === "pending" && <Badge tone="violet">{card.video.robot === "queued" || card.video.robot === "making" ? "Video being made" : "Video ready to render"}</Badge>}
            {card.video && card.video.items.length > 0 && <Badge tone="success">Video ready</Badge>}
          </div>
          <p className="text-[13px] text-muted">
            {card.posts.map((p) => `${p.label} ${timeLabel(p.scheduledAt, timeZone)}`).join(" · ")}
          </p>
        </div>
      </div>

      {post && (
        <div className="flex flex-col gap-3">
          <div role="tablist" aria-label="Preview per account" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {card.posts.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === post.id}
                onClick={() => {
                  setActive(p.id);
                  setExpanded(false);
                }}
                className={cn(
                  "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors duration-300",
                  p.id === post.id ? "border-line bg-glass-strong text-text" : "border-transparent text-muted hover:text-text",
                )}
              >
                <AccountAvatar network={p.network} name={p.accountName} size={22} />
                {p.label}
                {FORMAT_LABEL[p.format] && <span className="text-[12px] text-muted">{FORMAT_LABEL[p.format]}</span>}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="rounded-2xl bg-soft p-4">
            {post.title && <p className="mb-2 font-semibold">{post.title}</p>}
            <p className={cn("text-[15px] break-words whitespace-pre-wrap", !expanded && "line-clamp-6")}>{post.text}</p>
            {post.hashtags.length > 0 && <p className="mt-3 text-[15px] font-medium break-words text-pulse-blue">{post.hashtags.join(" ")}</p>}
            {post.text.length > 260 && (
              <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-2 min-h-11 cursor-pointer text-sm font-semibold text-pulse-blue">
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
            <p className="mt-2 text-[12px] text-muted">For {post.accountName}</p>
          </div>
        </div>
      )}

      {visualOpen && (card.image || card.video) && (
        <div className="rounded-2xl border border-line p-4">
          <ContentVisual image={card.image ?? null} video={card.video ?? null} videoInPlan={videoInPlan} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(card.image || card.video) && (
          <Button variant="outline" size="sm" aria-expanded={visualOpen} leading={card.video ? <Clapperboard aria-hidden className="size-4" /> : <ImageIcon aria-hidden className="size-4" />} onClick={() => setVisualOpen((o) => !o)}>
            {visualOpen ? "Hide picture" : card.video?.status === "pending" ? "Make the video" : "Picture and video"}
          </Button>
        )}
        <Button href={`/dashboard/calendar?post=${post?.id ?? ""}`} variant="outline" size="sm" leading={<Pencil aria-hidden className="size-4" />}>
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          title="Writes this post again. Uses 1 text credit."
          leading={<RefreshCw aria-hidden className={cn("size-4", pending && "animate-spin")} />}
          onClick={() => run(() => regeneratePlannedPost(card.groupId))}
        >
          Regenerate (1 credit)
        </Button>
        {confirming ? (
          <span className="inline-flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={pending} className="border-danger text-danger" onClick={() => run(() => removePlannedPost(card.groupId))}>
              Yes, remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button variant="outline" size="sm" disabled={pending} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
    </GlassCard>
  );
}

function DaySection({ day, timeZone, videoInPlan }: { day: ViewDay; timeZone: string; videoInPlan: boolean }) {
  return (
    <section aria-label={dayLabel(day.date)} className="flex flex-col gap-3">
      <h3 className="px-1 text-[15px] font-semibold text-muted">{dayLabel(day.date)}</h3>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-2">
        {day.cards.map((card) => (
          <PostCard key={card.groupId} card={card} timeZone={timeZone} videoInPlan={videoInPlan} />
        ))}
      </div>
    </section>
  );
}

function weekLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "long" }).format(new Date(iso));
}

/** Upcoming posts by day, with the big "Approve all" and the "Plan next week now" button. */
export function PlanBoard({ view, creditsLeft }: { view: AutopilotView; creditsLeft: number }) {
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const note = view.latestRun?.note;
  const canPlan = view.config.connectionIds.length > 0;

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    start(async () => {
      const result = await action();
      toast(result.ok ? (result.message ?? "Done.") : (result.error ?? "Something went wrong."), result.ok ? "success" : "error");
    });
  }

  return (
    <section aria-labelledby="autopilot-plan" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <h2 id="autopilot-plan" className="text-xl font-semibold tracking-[-0.02em]">
            Your upcoming posts
          </h2>
          <p className="text-[14px] text-muted">
            {creditsLeft} text {creditsLeft === 1 ? "credit" : "credits"} left this month. Next plan: week of {weekLabel(view.nextWeekStart, view.timeZone)}.
          </p>
        </div>
        <Button
          variant={view.pendingCount > 0 ? "outline" : "primary"}
          size="md"
          disabled={pending || !canPlan || view.nextWeekPlanned}
          leading={view.nextWeekPlanned ? <CalendarCheck aria-hidden className="size-5" /> : <Sparkles aria-hidden className={cn("size-5", pending && "animate-pulse")} />}
          onClick={() => run(planNextWeek)}
        >
          {pending ? "Writing your posts…" : view.nextWeekPlanned ? "Next week is planned" : "Plan next week now"}
        </Button>
      </div>

      {pending && (
        <p role="status" className="px-1 text-[14px] text-muted">
          Autopilot is writing and designing your posts. This takes about a minute, so keep this page open.
        </p>
      )}

      {note && (
        <div role="note" className="flex items-start gap-3 rounded-2xl border border-line bg-soft p-4 text-[14px]">
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-blue" />
          <p>{note}</p>
        </div>
      )}

      {view.pendingCount > 0 && (
        <GlassCard strong className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-lg font-semibold tracking-[-0.02em]">
              {view.pendingCount} {view.pendingCount === 1 ? "post is" : "posts are"} waiting for you
            </p>
            <p className="text-[14px] text-muted">Look through them, edit or remove any, then approve. They go out at the times shown.</p>
          </div>
          <Button size="lg" disabled={pending} leading={<CheckCheck aria-hidden className="size-5" />} onClick={() => run(approveAllPosts)} className="w-full shrink-0 whitespace-nowrap sm:w-auto">
            Approve all
          </Button>
        </GlassCard>
      )}

      {view.days.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <Sparkles aria-hidden className="size-8 text-pulse-violet" />
          <h3 className="text-lg font-semibold">Nothing planned yet</h3>
          <p className="max-w-md text-[14px] text-muted">
            {view.config.enabled
              ? "Autopilot plans next week on Friday. You can also plan it now."
              : "Choose your accounts, switch Autopilot on and press Plan next week now."}
          </p>
          {view.photoCount === 0 && (
            <p className="max-w-md text-[14px] text-muted">
              Tip: <Link href="/dashboard/gallery" className="font-semibold text-pulse-blue underline-offset-4 hover:underline">upload some photos</Link> so your posts show your real work.
            </p>
          )}
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-6">
          {view.days.map((day) => (
            <DaySection key={day.date} day={day} timeZone={view.timeZone} videoInPlan={view.videoInPlan} />
          ))}
        </div>
      )}
    </section>
  );
}
