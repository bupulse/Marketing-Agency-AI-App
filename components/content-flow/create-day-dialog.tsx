"use client";

/**
 * "Create today's content" (docs/CONTENT.md): the owner chooses how today's posts are made, for which apps and with
 * which kind of design, sees what the run uses, and confirms. Results land in the day view as drafts.
 *
 *   AI makes it for me     captions per app from the Knowledge base, then pictures and videos (Gallery first)
 *   I'll create it
 *     Describe today's content   a brief (and optional photos); the AI does the rest
 *     Bring my own               the owner's photos or videos and one caption, adapted per app
 */

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, PenLine, Sparkles, Upload, Wand2, X } from "lucide-react";
import { createDayContentAction } from "@/app/dashboard/content/day-actions";
import { MediaPicker, type PickedPhoto } from "@/components/media/media-picker";
import { Button, Chip, Dialog, Field, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ContentScope } from "@/lib/content-board/filters";
import { runCost, type DayMode, type DesignChoice } from "@/lib/content-flow/cost";
import { NETWORK_STYLE } from "@/lib/content-flow/networks";
import type { Network } from "@/lib/social/types";

export type NetworkChoice = { network: Network; label: string; connected: boolean };
export type Allowance = { textLeft: number; imagesLeft: number; aiPhotos: boolean; videoInPlan: boolean; videoSecondsLeft: number; voice: boolean; voiceCharsLeft: number };

const DEFAULT_NETWORKS: Network[] = ["instagram", "facebook", "linkedin"];

function Option({ selected, onSelect, icon, title, text, disabled }: { selected: boolean; onSelect: () => void; icon: ReactNode; title: string; text: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-card border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-pulse-blue bg-ok-bg" : "border-line bg-glass hover:bg-soft",
      )}
    >
      <span aria-hidden className={cn("mt-0.5 shrink-0", selected ? "text-pulse-blue" : "text-muted")}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-muted">{text}</span>
      </span>
    </button>
  );
}

export function CreateDayContent({ scope, path, subjectName, networks, allowance, album, label = "Create today's content" }: { scope: ContentScope; path: string; subjectName: string; networks: NetworkChoice[]; allowance: Allowance; album?: string; label?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DayMode>("ai");
  const [manual, setManual] = useState(false);
  const [design, setDesign] = useState<DesignChoice>(allowance.aiPhotos ? "ai" : "free");
  const connected = networks.filter((n) => n.connected).map((n) => n.network);
  const [chosen, setChosen] = useState<Network[]>(connected.length ? connected : DEFAULT_NETWORKS);
  const [brief, setBrief] = useState("");
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<PickedPhoto[]>([]);
  const [overlays, setOverlays] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A new key each time the dialog opens: a double click or a retry of the same request is not run twice.
  const [requestKey, setRequestKey] = useState("");

  const toggle = (n: Network) => setChosen((list) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n]));
  const designed = mode === "own" ? (overlays ? chosen.filter((n) => NETWORK_STYLE[n].video !== "always").length : 0) : chosen.filter((n) => NETWORK_STYLE[n].video !== "always").length;
  // Videos BuPulse may make: TikTok and YouTube when the plan has video (the album's own video, if any, costs nothing).
  const videos = mode === "own" || !allowance.videoInPlan ? 0 : chosen.filter((n) => NETWORK_STYLE[n].video === "always").length;
  const cost = runCost({ mode, design, posts: chosen.length, designed, aiPhotos: allowance.aiPhotos, textLeft: allowance.textLeft, imagesLeft: allowance.imagesLeft, videos, videoSecondsLeft: allowance.videoSecondsLeft, voice: allowance.voice, voiceCharsLeft: allowance.voiceCharsLeft });
  const missing = mode === "describe" && !brief.trim() ? "Describe today's content." : mode === "own" && media.length === 0 ? "Choose your photos or videos." : mode === "own" && !caption.trim() ? "Write your caption." : null;

  function submit() {
    setError(null);
    start(async () => {
      const res = await createDayContentAction({
        scope,
        mode,
        design,
        networks: chosen,
        brief: mode === "describe" ? brief : undefined,
        caption: mode === "own" ? caption : undefined,
        mediaPaths: mode === "ai" ? undefined : media.map((m) => m.path),
        overlays: mode === "own" ? overlays : undefined,
        requestKey,
      });
      if (!res.ok) return setError(res.error);
      const parts = [`${res.posts === 1 ? "1 post" : `${res.posts} posts`} made for today`];
      if (res.scheduled) parts.push(`${res.scheduled} scheduled on their own`);
      if (res.skipped.length) parts.push(res.skipped.map((s) => s.reason).join(" "));
      if (res.failed.length) parts.push(`${res.failed.map((n) => NETWORK_STYLE[n].label).join(", ")} could not be written (not charged)`);
      toast(parts.join(". ") + ".", "success");
      setOpen(false);
      setBrief("");
      setCaption("");
      setMedia([]);
      router.push(path, { scroll: false });
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => { setRequestKey(globalThis.crypto.randomUUID()); setOpen(true); }} leading={<Sparkles aria-hidden className="size-4" />}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)} title="Create today's content" description={`Posts for ${subjectName}, for today. They wait for your OK on this page (or go out on their own where your settings say so).`}>
        <div className="flex flex-col gap-5">
          <div role="radiogroup" aria-label="How to make it" className="grid gap-3 sm:grid-cols-2">
            <Option selected={!manual} onSelect={() => { setManual(false); setMode("ai"); }} icon={<Wand2 className="size-5" />} title="AI makes it for me" text="Captions for each app from your Knowledge base, then pictures and videos from your Gallery first." />
            <Option selected={manual} onSelect={() => { setManual(true); setMode("describe"); }} icon={<PenLine className="size-5" />} title="I'll create it" text="Describe what to post today, or bring your own photos and caption." />
          </div>

          {manual && (
            <div role="radiogroup" aria-label="How you create it" className="grid gap-3 sm:grid-cols-2">
              <Option selected={mode === "describe"} onSelect={() => setMode("describe")} icon={<PenLine className="size-5" />} title="Describe today's content" text="Tell BuPulse what to post; it writes and designs it." />
              <Option selected={mode === "own"} onSelect={() => setMode("own")} icon={<Upload className="size-5" />} title="Bring my own" text="Your photos or videos and one caption, adapted to each app." />
            </div>
          )}

          {mode === "describe" && (
            <Field label="What should today's posts say?" hint="For example: Promote the hydro tower for schools this week, mention free installation.">
              <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={1000} rows={3} placeholder="Promote the hydro tower for schools this week…" />
            </Field>
          )}
          {mode === "own" && (
            <Field label="Your caption" hint="BuPulse adapts its length, hashtags and tone to each app, without changing what you say.">
              <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={4} />
            </Field>
          )}

          {mode !== "ai" && (
            <div className="flex flex-col gap-2">
              <p className="text-[14px] font-medium">{mode === "own" ? "Your photos or videos" : "Photos or videos to use (optional)"}</p>
              <div className="flex flex-wrap items-center gap-2">
                {media.map((m) => (
                  <span key={m.path} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt="" className="size-16 rounded-field object-cover" />
                    <button type="button" aria-label="Remove" onClick={() => setMedia((list) => list.filter((x) => x.path !== m.path))} className="absolute -right-2 -top-2 inline-flex size-7 items-center justify-center rounded-full bg-ink text-white">
                      <X aria-hidden className="size-4" />
                    </button>
                  </span>
                ))}
                <Button variant="outline" size="sm" onClick={() => setPicking(true)} leading={<ImagePlus aria-hidden className="size-4" />}>
                  {media.length ? "Change" : "Choose from Gallery"}
                </Button>
              </div>
              {mode === "own" && (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                  <input type="checkbox" checked={overlays} onChange={(e) => setOverlays(e.target.checked)} className="size-5 accent-pulse-blue" />
                  Add BuPulse designs over my photos (otherwise they are used as they are)
                </label>
              )}
            </div>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[14px] font-medium">Apps</legend>
            <div className="flex flex-wrap gap-2">
              {networks.map((n) => (
                <Chip key={n.network} selected={chosen.includes(n.network)} onClick={() => toggle(n.network)}>
                  {n.label}
                  {!n.connected && <span className="text-[12px] opacity-80"> · reminder</span>}
                </Chip>
              ))}
            </div>
            {chosen.some((n) => !networks.find((x) => x.network === n)?.connected) && <p className="text-[13px] text-muted">Apps that are not connected get the post as a reminder to post it yourself.</p>}
          </fieldset>

          {mode !== "own" && (
            <div role="radiogroup" aria-label="Design" className="grid gap-3 sm:grid-cols-2">
              <Option selected={design === "ai"} disabled={!allowance.aiPhotos} onSelect={() => setDesign("ai")} icon={<Sparkles className="size-5" />} title="AI designs (images with people)" text={allowance.aiPhotos ? "AI photos of people with your product where they fit; uses AI image credits." : "No AI images left this month, or not in your plan."} />
              <Option selected={design === "free"} onSelect={() => setDesign("free")} icon={<ImagePlus className="size-5" />} title="Free templates" text="Your photos and BuPulse designs. BuPulse picks the design for each post." />
            </div>
          )}

          <p role="status" className={cn("rounded-2xl px-4 py-3 text-[14px]", cost.enoughText ? "bg-soft" : "bg-danger-bg text-danger")}>
            {cost.message}
          </p>
          {error && (
            <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !cost.enoughText || missing !== null} title={missing ?? undefined}>
              {pending ? "Writing captions, then pictures…" : `Create ${chosen.length === 1 ? "1 post" : `${chosen.length} posts`}`}
            </Button>
          </div>
        </div>
      </Dialog>
      <MediaPicker open={picking} onOpenChange={setPicking} multiple max={10} initialFolder={album} title="Choose photos or videos" onPick={(list) => setMedia(list)} />
    </>
  );
}
