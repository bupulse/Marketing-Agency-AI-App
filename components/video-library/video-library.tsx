"use client";

/**
 * <VideoLibrary> is the Videos page (docs/VIDEO_STUDIO_SPLIT.md): every video BuPulse made for the company, newest first,
 * with the Video Studio bar on top. Videos are made on the studio (studio.bupulse.com, a new tab, signed in with one
 * click through /dashboard/video/open) or uploaded here ("Upload a video", components/video-library/upload-dialog.tsx);
 * here they are watched, downloaded, scheduled (studio and uploaded videos) and deleted (the same; a post's slideshow
 * video is managed from its post).
 * Each video is a media card (components/media-cards VideoCard: the liquid-glass panel with its actions rises on hover or
 * focus) and opens in the full player (MediaPlayer, the same actions in its side panel); Schedule opens a dialog.
 *
 * Props:
 *   initialVideos  lib/video-library/service.ts listLibraryVideos
 *   upload         "Upload a video": the company's products (for "What is it about?") and its video storage (used, cap)
 *   studio         "open" (the button works), "plan" (no video credits: "Upgrade to use") or "off" (coming soon)
 *   credits        { used, limit, resetsAt } of the plan's video credits
 *   canBuy         the person may buy (the billing permission): "Buy credits" goes to Billing
 *   reason         why the studio did not open (?studio=…), shown once
 *   focus          a video to open on (?v=<job id>, from the "Your video is ready" email)
 *   timeZone       the business's time zone, for the dates
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Clapperboard, Download, ExternalLink, Film, Loader2, Trash2, Upload } from "lucide-react";
import { Badge, Button, buttonClasses, Dialog, Field, GlassCard, Input, Meter, Textarea, useToast } from "@/components/ui";
import { durationLabel, glassButtonClass, libraryPlayerItem, libraryVideoCard, MediaPlayer, VideoCard, type PlayerItem } from "@/components/media-cards";
import { deleteLibraryVideo, loadLibrary, loadScheduleOptions, scheduleStudioVideo } from "@/app/dashboard/video/actions";
import { WhatsAppShare } from "@/components/share/whatsapp-share";
import { UploadVideoDialog } from "./upload-dialog";
import { cn } from "@/lib/cn";
import { whatsappCaption } from "@/lib/share/whatsapp";
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
  upload: { products: { id: string; name: string }[]; storage: { used: number; max: number } };
};

type Filter = "all" | "studio" | "upload" | "slideshow";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "studio", label: "Video Studio" },
  { id: "upload", label: "Uploaded" },
  { id: "slideshow", label: "Post videos" },
];

const NETWORK_LABEL: Record<Network, string> = { instagram: "Instagram Reels", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts", linkedin: "LinkedIn", twitter: "X (Twitter)" };

const REASON_TEXT: Record<string, string> = {
  off: "The Video Studio is not open yet. Your videos are all here, and you will see the button as soon as it opens.",
  permission: "Your role cannot make videos. Ask your company owner or an admin.",
  plan: "Your plan has no video credits, so the Video Studio cannot open. Add video credits to your plan to make videos.",
  error: "The Video Studio could not open just now. Please try again.",
};

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
 * "Schedule" on a studio video, in a dialog: one post per chosen account (createPosts, like the composer), each network
 * with its own caption (the video's for its platform, else the Brain's), which the owner can change. Every caption must
 * pass the caption check, done again when scheduling. TikTok and YouTube get the reminder email with the video at the
 * time.
 */
function ScheduleForm({ video, timeZone, onScheduled, onCancel }: { video: LibraryVideo; timeZone: string; onScheduled: (count: number, next: string | null) => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [options, setOptions] = useState<ScheduleOptions | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [captions, setCaptions] = useState<Partial<Record<Network, { text: string; tags: string }>>>({});
  const [mode, setMode] = useState<"queue" | "schedule">("queue");
  const [local, setLocal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await loadScheduleOptions(video.id);
      if (!live) return;
      if (!res.ok) return setProblem(res.error);
      const o: ScheduleOptions = { accounts: res.accounts, captions: res.captions, credit: res.credit, timezone: res.timezone };
      setOptions(o);
      setPicked(o.accounts.filter((a) => a.usable).map((a) => a.id));
      setCaptions(Object.fromEntries(Object.entries(o.captions).map(([n, c]) => [n, { text: c!.text, tags: c!.hashtags.join(" ") }])));
    })();
    return () => {
      live = false;
    };
  }, [video.id]);

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
    const at = res.scheduledAt ? new Date(res.scheduledAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }) : "";
    toast(`Scheduled on ${res.postIds.length} ${res.postIds.length === 1 ? "account" : "accounts"}${at ? ` for ${at}` : ""}. It is in your calendar.`, "success");
  };

  const networks = options ? [...new Set(options.accounts.filter((a) => picked.includes(a.id)).map((a) => a.network))] : [];
  return (
    <div className="flex w-full flex-col gap-3 text-sm">
      {!options && !problem && <Loader2 className="size-5 animate-spin text-pulse-blue" aria-label="Loading" />}
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
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {problem && <p className="text-sm text-danger">{problem}</p>}
    </div>
  );
}

/**
 * A video's actions on dark glass (the card's panel and the player's panel): Schedule (studio and uploaded videos),
 * Download, Share to WhatsApp, Open its post (a post's slideshow video) and Delete, with its confirmation step in place
 * (the viewer never shows confirm dialogs).
 */
function VideoActions({ video, onSchedule, onDeleted }: { video: LibraryVideo; onSchedule: () => void; onDeleted: () => void }) {
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
  if (asking)
    return (
      <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-white">
        Delete this video for good?
        <button type="button" onClick={remove} disabled={busy} className={glassButtonClass("danger")}>
          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Yes, delete
        </button>
        <button type="button" onClick={() => setAsking(false)} className={glassButtonClass()}>
          Keep it
        </button>
      </span>
    );
  return (
    <>
      {video.source !== "slideshow" && (
        <button type="button" onClick={onSchedule} className={glassButtonClass("primary")}>
          <CalendarClock aria-hidden className="size-4" />
          Schedule
        </button>
      )}
      {video.downloadUrl && (
        <a href={video.downloadUrl} className={glassButtonClass()}>
          <Download aria-hidden className="size-4" />
          Download
        </a>
      )}
      {/* The share button and its notes in the dark theme's colours, readable on the glass. */}
      <span className="dark contents [&_button]:!border-white/30 [&_button]:!bg-white/15 [&_button]:!text-white [&_p]:!text-white/85">
        <WhatsAppShare media={[{ path: video.videoUrl, url: video.videoUrl }]} caption={whatsappCaption({ text: video.caption })} what="video" />
      </span>
      {video.source === "slideshow" && video.postHref && (
        <Link href={video.postHref} className={glassButtonClass()}>
          Open its post
        </Link>
      )}
      {video.source !== "slideshow" && (
        <button type="button" onClick={() => setAsking(true)} aria-label={`Delete ${video.title}`} className={glassButtonClass("danger")}>
          <Trash2 aria-hidden className="size-4" />
          Delete
        </button>
      )}
    </>
  );
}

/** What the player's side panel says about a video. */
function VideoFacts({ video, timeZone }: { video: LibraryVideo; timeZone: string }) {
  const next = video.posts.next ? new Date(video.posts.next).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }) : null;
  const rows: [string, string][] = [
    ["Made", new Date(video.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone })],
    ["Length", durationLabel(video.durationMs) ?? "—"],
    ["Shape", video.ratio],
    ["Posts", video.posts.count > 0 ? `In ${video.posts.count} ${video.posts.count === 1 ? "post" : "posts"}${next ? `, next ${next}` : ""}` : "Not posted yet"],
  ];
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[#a3a6c2]">{k}</dt>
            <dd className="text-right text-white">{v}</dd>
          </div>
        ))}
      </dl>
      {video.caption && <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-[13.5px] leading-relaxed whitespace-pre-line text-white/90">{video.caption}</p>}
    </>
  );
}

export function VideoLibrary({ initialVideos, studio, credits, canBuy, reason, focus, timeZone, upload }: Props) {
  const [videos, setVideos] = useState(initialVideos);
  const [filter, setFilter] = useState<Filter>("all");
  const [uploading, setUploading] = useState(false);
  const [videoBytes, setVideoBytes] = useState(upload.storage.used);
  const shown = useMemo(() => (filter === "all" ? videos : videos.filter((v) => v.source === filter)), [videos, filter]);
  // The full player (the key of the video open in it) and the video being scheduled (a dialog, from a card or the
  // player). A key, not an index: the list reloads when the person comes back from the studio tab (newest first), and
  // an index would then point at another video.
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const playing = playingKey == null ? null : shown.findIndex((v) => v.key === playingKey);
  const [scheduling, setScheduling] = useState<LibraryVideo | null>(null);

  const update = (next: LibraryVideo) => setVideos((list) => list.map((x) => (x.key === next.key ? next : x)));
  const removed = (key: string) => {
    setPlayingKey(null);
    setVideos((list) => list.filter((x) => x.key !== key));
  };
  // Keyed by video: in the player, a "Delete this video for good?" asked on one video must not stay open on the next.
  const actionsOf = (v: LibraryVideo) => <VideoActions key={v.key} video={v} onSchedule={() => setScheduling(v)} onDeleted={() => removed(v.key)} />;
  const items: PlayerItem[] = shown.map((v) => ({ ...libraryPlayerItem(v), info: <VideoFacts video={v} timeZone={timeZone} />, actions: actionsOf(v) }));

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold">Your videos</h2>
        <Button variant="outline" onClick={() => setUploading(true)} leading={<Upload className="size-4" aria-hidden />}>
          Upload a video
        </Button>
      </div>
      <UploadVideoDialog
        open={uploading}
        onOpenChange={setUploading}
        products={upload.products}
        storage={{ used: videoBytes, max: upload.storage.max }}
        onUploaded={(video, bytes) => {
          setVideos((list) => [video, ...list.filter((x) => x.key !== video.key)]);
          setVideoBytes((b) => b + bytes);
        }}
      />
      {videos.length === 0 ? (
        <GlassCard padding="lg" className="flex flex-col items-center gap-3 text-center">
          <Film aria-hidden className="size-8 text-pulse-blue" />
          <span className="text-[17px] font-semibold">No videos yet</span>
          <span className="max-w-md text-sm text-muted">
            {studio === "open"
              ? "Open the Video Studio and make your first video, or upload one you already have. Studio videos appear here when they are ready, and we email you."
              : "Your videos will appear here: the ones the Video Studio makes for you, the ones you upload, and the videos of your daily posts."}
          </span>
        </GlassCard>
      ) : (
        <>
          <Pills label="Show" options={FILTERS} value={filter} onChange={setFilter} />
          {shown.length === 0 ? (
            <p className="text-sm text-muted">No videos of this kind yet.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-4 sm:gap-5">
              {shown.map((v, i) => (
                <VideoCard
                  key={v.key}
                  {...libraryVideoCard(v, timeZone)}
                  index={i}
                  focused={v.source === "studio" && v.id === focus}
                  badge={v.isNew ? <span className="rounded-full bg-pulse-violet px-2 py-1 text-[11.5px] leading-none font-semibold text-white">New</span> : undefined}
                  onOpen={() => setPlayingKey(v.key)}
                  actions={actionsOf(v)}
                />
              ))}
            </div>
          )}
        </>
      )}
      <MediaPlayer items={items} index={playing != null && playing >= 0 ? playing : null} onIndexChange={(i) => setPlayingKey(shown[i]?.key ?? null)} onClose={() => setPlayingKey(null)} />
      <Dialog open={scheduling != null} onOpenChange={(o) => !o && setScheduling(null)} title="Schedule this video" description={scheduling?.title} className="max-w-xl">
        {scheduling && (
          <ScheduleForm
            key={scheduling.key}
            video={scheduling}
            timeZone={timeZone}
            onCancel={() => setScheduling(null)}
            onScheduled={(n, at) => {
              const v = videos.find((x) => x.key === scheduling.key) ?? scheduling;
              update({ ...v, posts: { count: v.posts.count + n, next: v.posts.next && at && v.posts.next < at ? v.posts.next : (at ?? v.posts.next) } });
              setScheduling(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
