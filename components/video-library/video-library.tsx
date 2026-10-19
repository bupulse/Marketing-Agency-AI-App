"use client";

/**
 * <VideoLibrary> is the Videos page (docs/VIDEO_STUDIO_SPLIT.md): every video BuPulse made for the company, newest first,
 * with the Video Studio bar on top. Videos are made on the studio (studio.bupulse.com, a new tab, signed in with one
 * click through /dashboard/video/open); here they are watched, downloaded, scheduled (studio videos) and deleted
 * (studio videos; a post's slideshow video is managed from its post).
 *
 * Props:
 *   initialVideos  lib/video-library/service.ts listLibraryVideos
 *   studio         "open" (the button works), "plan" (no video credits: "Upgrade to use") or "off" (coming soon)
 *   credits        { used, limit, resetsAt } of the plan's video credits
 *   canBuy         the person may buy (the billing permission): "Buy credits" goes to Billing
 *   reason         why the studio did not open (?studio=…), shown once
 *   focus          a video to open on (?v=<job id>, from the "Your video is ready" email)
 *   timeZone       the business's time zone, for the dates
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clapperboard, Download, ExternalLink, Film, Loader2, Trash2 } from "lucide-react";
import { Badge, Button, buttonClasses, Field, GlassCard, Input, Meter, Textarea, useToast } from "@/components/ui";
import { deleteLibraryVideo, loadLibrary, loadScheduleOptions, scheduleStudioVideo } from "@/app/dashboard/video/actions";
import { cn } from "@/lib/cn";
import type { Network } from "@/lib/social/types";
import type { LibraryVideo } from "@/lib/video-library/service";
import type { ScheduleOptions } from "@/lib/video-studio/schedule";

export type StudioState = "open" | "plan" | "off";

type Props = {
  initialVideos: LibraryVideo[];
  studio: StudioState;
  credits: { used: number; limit: number; resetsAt: string | null };
  canBuy: boolean;
  reason: string | null;
  focus: string | null;
  timeZone: string;
};

type Filter = "all" | "studio" | "slideshow";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "studio", label: "Video Studio" },
  { id: "slideshow", label: "Post videos" },
];

const ENGINE_LABEL: Record<string, string> = { motion: "Motion", premium3d: "Premium 3D", seedance: "AI video" };
const NETWORK_LABEL: Record<Network, string> = { instagram: "Instagram Reels", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts", linkedin: "LinkedIn" };
const ASPECT: Record<string, string> = { "9:16": "aspect-[9/16]", "4:5": "aspect-[4/5]", "1:1": "aspect-square", "16:9": "aspect-video" };

const REASON_TEXT: Record<string, string> = {
  off: "The Video Studio is not open yet. Your videos are all here, and you will see the button as soon as it opens.",
  permission: "Your role cannot make videos. Ask your company owner or an admin.",
  plan: "Your plan has no video credits, so the Video Studio cannot open. Add video credits to your plan to make videos.",
  error: "The Video Studio could not open just now. Please try again.",
};

const seconds = (ms: number | null) => (ms ? `${Math.round(ms / 1000)} s` : null);

function Pills<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn("min-h-11 cursor-pointer rounded-full border px-4 text-sm font-medium", value === o.id ? "border-pulse-blue bg-soft text-text" : "border-line text-muted hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The bar on top: the Video Studio button (or why it is not there) and the plan's video credits. */
function StudioBar({ studio, credits, canBuy, timeZone }: Pick<Props, "studio" | "credits" | "canBuy" | "timeZone">) {
  const left = Math.max(0, credits.limit - credits.used);
  return (
    <GlassCard className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
        <span className="flex items-center gap-2 text-[17px] font-semibold">
          <Clapperboard aria-hidden className="size-5 text-pulse-blue" />
          Video Studio
          {studio === "off" && <Badge tone="violet">Coming soon</Badge>}
        </span>
        <span className="text-sm text-muted">
          {studio === "off"
            ? "Animated product videos, 3D clips and AI video, designed from your products and photos. It opens soon."
            : "Make animated product videos, 3D clips and AI video from your products and photos. It opens in a new tab, already signed in."}
        </span>
      </div>
      {studio !== "off" && credits.limit > 0 && (
        <div className="flex min-w-0 basis-56 flex-col gap-1.5">
          <Meter value={credits.used} max={credits.limit} label="Video credits used" />
          <span className="text-xs text-muted">
            {left.toLocaleString("en-GB")} of {credits.limit.toLocaleString("en-GB")} video credits left
            {credits.resetsAt ? `, until ${new Date(credits.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone })}` : ""}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {studio === "open" && (
          // A plain link, not next/link: it must never be prefetched (each visit writes a sign-in ticket).
          <a href="/dashboard/video/open" target="_blank" rel="noopener" className={buttonClasses({ size: "md" })}>
            Open Video Studio
            <ExternalLink aria-hidden className="size-4" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        {studio === "plan" && (
          <Button href={canBuy ? "/dashboard/billing" : "/dashboard/usage"} variant="outline">
            Upgrade to use
          </Button>
        )}
        {studio === "open" && canBuy && (
          <Button href="/dashboard/billing" variant="ghost">
            Buy credits
          </Button>
        )}
      </div>
    </GlassCard>
  );
}

/**
 * "Schedule" on a studio video: one post per chosen account (createPosts, like the composer), each network with its own
 * caption (the video's for its platform, else the Brain's), which the owner can change. Every caption must pass the
 * caption check, done again when scheduling. TikTok and YouTube get the reminder email with the video at the time.
 */
function SchedulePanel({ video, timeZone, onScheduled }: { video: LibraryVideo; timeZone: string; onScheduled: (count: number, next: string | null) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ScheduleOptions | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [captions, setCaptions] = useState<Partial<Record<Network, { text: string; tags: string }>>>({});
  const [mode, setMode] = useState<"queue" | "schedule">("queue");
  const [local, setLocal] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setOpen(true);
    if (options) return;
    const res = await loadScheduleOptions(video.id);
    if (!res.ok) return setProblem(res.error);
    const o: ScheduleOptions = { accounts: res.accounts, captions: res.captions, credit: res.credit, timezone: res.timezone };
    setOptions(o);
    setPicked(o.accounts.filter((a) => a.usable).map((a) => a.id));
    setCaptions(Object.fromEntries(Object.entries(o.captions).map(([n, c]) => [n, { text: c!.text, tags: c!.hashtags.join(" ") }])));
  };

  const schedule = async () => {
    if (!options || saving) return;
    setSaving(true);
    setProblem(null);
    const networks = new Set(options.accounts.filter((a) => picked.includes(a.id)).map((a) => a.network));
    const sent = Object.fromEntries([...networks].map((n) => [n, { text: captions[n]?.text ?? "", hashtags: (captions[n]?.tags ?? "").split(/[\s,]+/).filter(Boolean) }]));
    const res = await scheduleStudioVideo(video.id, { connectionIds: picked, when: mode === "queue" ? { mode: "queue" } : { mode: "schedule", local }, captions: sent });
    setSaving(false);
    if (!res.ok) return setProblem(res.error);
    onScheduled(res.postIds.length, res.scheduledAt);
    setOpen(false);
    const at = res.scheduledAt ? new Date(res.scheduledAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }) : "";
    toast(`Scheduled on ${res.postIds.length} ${res.postIds.length === 1 ? "account" : "accounts"}${at ? ` for ${at}` : ""}. It is in your calendar.`, "success");
  };

  if (!open) {
    return (
      <Button size="sm" onClick={load} leading={<CalendarClock className="size-4" aria-hidden />}>
        Schedule
      </Button>
    );
  }
  const networks = options ? [...new Set(options.accounts.filter((a) => picked.includes(a.id)).map((a) => a.network))] : [];
  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-line p-3 text-sm">
      {!options && !problem && <Loader2 className="size-4 animate-spin" aria-label="Loading" />}
      {options && options.accounts.length === 0 && <p className="text-muted">Connect Instagram, Facebook, TikTok or YouTube in Channels first.</p>}
      {options && options.accounts.length > 0 && (
        <>
          <div role="group" aria-label="Accounts" className="flex flex-wrap gap-2">
            {options.accounts.map((a) => (
              <label key={a.id} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4", a.usable ? "cursor-pointer" : "opacity-60")}>
                <input type="checkbox" className="accent-[var(--color-pulse-blue)]" disabled={!a.usable} checked={picked.includes(a.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))} />
                {a.name} <span className="text-xs text-muted">{NETWORK_LABEL[a.network]}</span>
                {!a.usable && <span className="text-xs text-danger">reconnect it in Channels</span>}
              </label>
            ))}
          </div>
          {networks.map((n) => {
            const c = options.captions[n];
            return (
              <div key={n} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{NETWORK_LABEL[n]} caption</span>
                  {c && <Badge tone={c.score >= 70 ? "success" : "neutral"}>Check {c.score}/100</Badge>}
                </div>
                <Textarea rows={4} value={captions[n]?.text ?? ""} onChange={(e) => setCaptions((m) => ({ ...m, [n]: { text: e.target.value, tags: m[n]?.tags ?? "" } }))} aria-label={`${NETWORK_LABEL[n]} caption`} />
                <Input value={captions[n]?.tags ?? ""} onChange={(e) => setCaptions((m) => ({ ...m, [n]: { text: m[n]?.text ?? "", tags: e.target.value } }))} aria-label={`${NETWORK_LABEL[n]} hashtags`} placeholder="#kigali #yourshop" />
                {c && c.missed.length > 0 && <p className="text-xs text-muted">The check would like: {c.missed.slice(0, 2).join(" ")}</p>}
                {(n === "tiktok" || n === "youtube") && <p className="text-xs text-muted">At the time, you get an email with the video and this caption to post it yourself.</p>}
              </div>
            );
          })}
          {options.credit && <p className="text-xs text-muted">The music credit goes at the end of every post: “{options.credit}”.</p>}
          <div className="flex flex-wrap items-end gap-3">
            <Pills label="When" options={[{ id: "queue" as const, label: "Next free time" }, { id: "schedule" as const, label: "Pick a time" }]} value={mode} onChange={setMode} />
            {mode === "schedule" && (
              <Field label={`Date and time (${options.timezone})`}>
                <Input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={schedule} disabled={saving || picked.length === 0 || (mode === "schedule" && !local)} leading={saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CalendarClock className="size-4" aria-hidden />}>
              Schedule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {problem && <p className="text-sm text-danger">{problem}</p>}
    </div>
  );
}

/** Delete with a confirmation step in the card (the viewer never shows confirm dialogs). */
function DeleteButton({ video, onDeleted }: { video: LibraryVideo; onDeleted: () => void }) {
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const res = await deleteLibraryVideo(video.id);
    setBusy(false);
    setAsking(false);
    if (!res.ok) return toast(res.error, "error");
    toast("Video deleted.", "success");
    onDeleted();
  };
  if (!asking) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setAsking(true)} leading={<Trash2 className="size-4" aria-hidden />}>
        Delete
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      Delete this video for good?
      <Button size="sm" variant="outline" onClick={remove} disabled={busy} leading={busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : undefined}>
        Yes, delete
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Keep it
      </Button>
    </span>
  );
}

function VideoCard({ video, focused, timeZone, onChange, onDeleted }: { video: LibraryVideo; focused: boolean; timeZone: string; onChange: (v: LibraryVideo) => void; onDeleted: () => void }) {
  const length = seconds(video.durationMs);
  const made = new Date(video.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
  const next = video.posts.next ? new Date(video.posts.next).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }) : null;
  return (
    <GlassCard id={`video-${video.id}`} padding="sm" className={cn("flex min-w-0 flex-col gap-3", focused && "ring-2 ring-pulse-blue")}>
      <div className={cn("mx-auto w-full max-w-[22rem] overflow-hidden rounded-2xl bg-black", ASPECT[video.ratio] ?? "aspect-[9/16]")}>
        <video src={video.videoUrl} poster={video.posterUrl ?? undefined} controls playsInline preload="metadata" className="size-full object-contain" aria-label={video.title} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{video.title}</span>
        {video.isNew && <Badge tone="violet">New</Badge>}
        <Badge tone="neutral">{video.source === "studio" ? (ENGINE_LABEL[video.engine ?? ""] ?? "Studio") : "Post video"}</Badge>
      </div>
      <p className="text-sm text-muted">
        {[made, length, video.ratio].filter(Boolean).join(" · ")}
        <br />
        {video.posts.count > 0 ? `In ${video.posts.count} ${video.posts.count === 1 ? "post" : "posts"}${next ? `, next ${next}` : ""}.` : "Not posted yet."}
      </p>
      <div className="flex flex-wrap gap-2">
        {video.source === "studio" && <SchedulePanel video={video} timeZone={timeZone} onScheduled={(n, at) => onChange({ ...video, posts: { count: video.posts.count + n, next: video.posts.next && at && video.posts.next < at ? video.posts.next : (at ?? video.posts.next) } })} />}
        {video.downloadUrl && (
          <a href={video.downloadUrl} className={buttonClasses({ size: "sm", variant: "ghost" })}>
            <Download aria-hidden className="size-4" />
            Download
          </a>
        )}
        {video.source === "slideshow" && video.postHref && (
          <Button size="sm" variant="ghost" href={video.postHref}>
            Open its post
          </Button>
        )}
        {video.source === "studio" && <DeleteButton video={video} onDeleted={onDeleted} />}
      </div>
    </GlassCard>
  );
}

export function VideoLibrary({ initialVideos, studio, credits, canBuy, reason, focus, timeZone }: Props) {
  const [videos, setVideos] = useState(initialVideos);
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => (filter === "all" ? videos : videos.filter((v) => v.source === filter)), [videos, filter]);

  // The "Your video is ready" email opens on its video.
  useEffect(() => {
    if (focus) document.getElementById(`video-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  // Back from the studio tab: new videos may be ready.
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await loadLibrary();
      if (res.ok) setVideos((old) => res.videos.map((v) => ({ ...v, isNew: v.isNew || old.some((o) => o.key === v.key && o.isNew) })));
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {reason && REASON_TEXT[reason] && <p className="rounded-2xl bg-soft p-4 text-sm">{REASON_TEXT[reason]}</p>}
      <StudioBar studio={studio} credits={credits} canBuy={canBuy} timeZone={timeZone} />
      {videos.length === 0 ? (
        <GlassCard padding="lg" className="flex flex-col items-center gap-3 text-center">
          <Film aria-hidden className="size-8 text-pulse-blue" />
          <span className="text-[17px] font-semibold">No videos yet</span>
          <span className="max-w-md text-sm text-muted">
            {studio === "open"
              ? "Open the Video Studio and make your first video. When it is ready it appears here, and we email you."
              : "Your videos will appear here: the ones the Video Studio makes for you, and the videos of your daily posts."}
          </span>
        </GlassCard>
      ) : (
        <>
          <Pills label="Show" options={FILTERS} value={filter} onChange={setFilter} />
          {shown.length === 0 ? (
            <p className="text-sm text-muted">No videos of this kind yet.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
              {shown.map((v) => (
                <VideoCard
                  key={v.key}
                  video={v}
                  focused={v.source === "studio" && v.id === focus}
                  timeZone={timeZone}
                  onChange={(next) => setVideos((list) => list.map((x) => (x.key === next.key ? next : x)))}
                  onDeleted={() => setVideos((list) => list.filter((x) => x.key !== v.key))}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
