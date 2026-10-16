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
import { Button, Chip, Dialog, Field, Select, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ContentScope } from "@/lib/content-board/filters";
import { runCost, type DayMode, type DesignChoice } from "@/lib/content-flow/cost";
import { expectedVideos, FORMAT_PREFERENCE_LABEL, FORMAT_PREFERENCES, type FormatPreference } from "@/lib/content-flow/format";
import { NETWORK_STYLE } from "@/lib/content-flow/networks";
import { PRICE_CHOICE_LABEL, PRICE_CHOICES, type PriceChoice } from "@/lib/content-flow/price";
import type { Network } from "@/lib/social/types";

export type NetworkChoice = { network: Network; label: string; connected: boolean };
export type Allowance = { textLeft: number; imagesLeft: number; aiPhotos: boolean; videoInPlan: boolean; videosLeft: number; voice: boolean; voiceCharsLeft: number; postsPerApp: number };

const DEFAULT_NETWORKS: Network[] = ["instagram", "facebook", "linkedin"];

/** When the answer never arrived: the run may have finished all the same. */
export const LOST = "We lost the connection before BuPulse answered. Your posts may have been made: the page behind now shows what is there. Check it before trying again.";

function formatHint(format: FormatPreference, allowance: Allowance): string {
  if (!allowance.videoInPlan) return "Videos are not in your plan: pictures and carousels, and TikTok / YouTube get a script to film yourself.";
  if (allowance.videosLeft < 1) return "Your plan's videos are used up for now (today's or this month's): pictures and carousels this time.";
  if (format === "video") return "Videos wherever they fit, within your videos; LinkedIn still gets some pictures.";
  if (format === "image") return "Pictures and carousels on Instagram, Facebook and LinkedIn; TikTok and YouTube stay videos.";
  return "BuPulse picks picture, carousel or video for each post: mostly videos on TikTok and YouTube, a mix on Instagram and Facebook, mostly pictures on LinkedIn.";
}

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
  const [perApp, setPerApp] = useState(1);
  const [price, setPrice] = useState<PriceChoice>("auto");
  const [format, setFormat] = useState<FormatPreference>("auto");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A new key each time the dialog opens: a double click or a retry of the same request is not run twice.
  const [requestKey, setRequestKey] = useState("");

  const toggle = (n: Network) => setChosen((list) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n]));
  const each = mode === "own" ? 1 : Math.min(perApp, allowance.postsPerApp);
  const posts = chosen.length * each;
  const designed = (mode === "own" ? (overlays ? chosen.filter((n) => NETWORK_STYLE[n].video !== "always").length : 0) : chosen.filter((n) => NETWORK_STYLE[n].video !== "always").length) * each;
  // Videos BuPulse is likely to make: it decides picture or video per post when the run starts (format.ts), mostly
  // video on TikTok and YouTube, within the videos left (an album video, if any, costs nothing).
  const videos = mode === "own" ? 0 : expectedVideos({ networks: chosen, perApp: each, preference: format, videoInPlan: allowance.videoInPlan, videosLeft: allowance.videosLeft });
  const cost = runCost({ mode, design, posts, designed, aiPhotos: allowance.aiPhotos, textLeft: allowance.textLeft, imagesLeft: allowance.imagesLeft, videos, videosLeft: allowance.videosLeft, voice: allowance.voice, voiceCharsLeft: allowance.voiceCharsLeft });
  const missing = mode === "describe" && !brief.trim() ? "Describe today's content." : mode === "own" && media.length === 0 ? "Choose your photos or videos." : mode === "own" && !caption.trim() ? "Write your caption." : null;

  function submit() {
    setError(null);
    start(async () => {
      // A request lost on the way back (the phone slept, the network dropped) must not take the page down: the posts
      // may well have been made, so the page behind is refreshed to show them and the dialog says so.
      const res = await createDayContentAction({
        scope,
        mode,
        design,
        networks: chosen,
        brief: mode === "describe" ? brief : undefined,
        caption: mode === "own" ? caption : undefined,
        mediaPaths: mode === "ai" ? undefined : media.map((m) => m.path),
        overlays: mode === "own" ? overlays : undefined,
        perApp: mode === "own" ? undefined : each,
        price: mode === "own" ? undefined : price,
        format: mode === "own" ? undefined : format,
        requestKey,
      }).catch(() => null);
      if (!res) {
        setError(LOST);
        router.refresh();
        return;
      }
      if (!res.ok) return setError(res.error);
      const parts = [`${res.posts === 1 ? "1 post" : `${res.posts} posts`} made for today`];
      if (res.videos) parts.push(`${res.videos === 1 ? "1 is a video" : `${res.videos} are videos`}`);
      if (res.scheduled) parts.push(`${res.scheduled} scheduled on their own`);
      if (res.notes.length) parts.push(res.notes.join(" "));
      if (res.skipped.length) parts.push(res.skipped.map((s) => s.reason).join(" "));
      if (res.contests) parts.push(`${res.contests === 1 ? "1 contest waits" : `${res.contests} contests wait`} for your prize and rules`);
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
        <div className="@container flex flex-col gap-5">
          <div role="radiogroup" aria-label="How to make it" className="grid gap-3 @md:grid-cols-2">
            <Option selected={!manual} onSelect={() => { setManual(false); setMode("ai"); }} icon={<Wand2 className="size-5" />} title="AI makes it for me" text="A caption, a 30-second video script and 3 ad headlines for each app, from your Knowledge base; then pictures and videos, your Gallery first." />
            <Option selected={manual} onSelect={() => { setManual(true); setMode("describe"); }} icon={<PenLine className="size-5" />} title="I'll create it" text="Describe what to post today, or bring your own photos and caption." />
          </div>

          {manual && (
            <div role="radiogroup" aria-label="How you create it" className="grid gap-3 @md:grid-cols-2">
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
            <div className="grid gap-4 @md:grid-cols-2">
              <Field label="Posts per app" hint={allowance.postsPerApp > 1 ? `Your plan allows up to ${allowance.postsPerApp} per app a day, counting what this ${scope.kind === "general" ? "page" : scope.kind} already has today.` : "Your plan makes 1 post per app a day."}>
                <Select value={String(each)} onChange={(e) => setPerApp(Number(e.target.value))} disabled={allowance.postsPerApp <= 1}>
                  {Array.from({ length: allowance.postsPerApp }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Price" hint={price === "auto" ? "At most about 1 post in 4 shows the price, never two in a row." : price === "with" ? "Every post states the price (it needs one)." : "No price in captions or designs: posts that start conversations."}>
                <Select value={price} onChange={(e) => setPrice(e.target.value as PriceChoice)}>
                  {PRICE_CHOICES.map((p) => (
                    <option key={p} value={p}>
                      {PRICE_CHOICE_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          {mode !== "own" && (
            <Field label="Format" hint={formatHint(format, allowance)}>
              <Select value={format} onChange={(e) => setFormat(e.target.value as FormatPreference)}>
                {FORMAT_PREFERENCES.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_PREFERENCE_LABEL[f]}
                    {f === "auto" ? " (default)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {mode !== "own" && (
            <div role="radiogroup" aria-label="Design" className="grid gap-3 @md:grid-cols-2">
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
              {pending ? "Writing captions, then pictures…" : `Create ${posts === 1 ? "1 post" : `${posts} posts`}`}
            </Button>
          </div>
        </div>
      </Dialog>
      <MediaPicker open={picking} onOpenChange={setPicking} multiple max={10} initialFolder={album} title="Choose photos or videos" onPick={(list) => setMedia(list)} />
    </>
  );
}
