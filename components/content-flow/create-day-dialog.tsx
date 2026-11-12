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

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ImagePlus, PenLine, SlidersHorizontal, Sparkles, Upload, Wand2, X } from "lucide-react";
import { createDayContentAction } from "@/app/dashboard/content/day-actions";
import { MediaPicker, type PickedPhoto } from "@/components/media/media-picker";
import { MakingScreen } from "@/components/visuals/making-screen";
import { fromSetProgress, type MakingProgress } from "@/components/visuals/making-progress";
import { useSetProgress } from "./use-set-progress";
import { ChoiceCards, ChoiceChips } from "@/components/app/kit/a-choice-cards";
import { Button, Chip, Dialog, Field, Textarea, useToast } from "@/components/ui";
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

/** Tap-to-pick ideas for "Describe today's content": a tap fills the box, the owner can still change the words. */
function briefIdeas(subjectName: string, general: boolean): string[] {
  const it = general ? "our business" : subjectName;
  return [`Promote ${it} this week`, "Announce a special offer", "Share a happy customer's story", `Show how ${general ? "we work" : "it is made or used"}`, "Thank our customers"];
}

export function CreateDayContent({ scope, path, subjectName, networks, allowance, album, label = "Create today's content", openOnAsk = false }: { scope: ContentScope; path: string; subjectName: string; networks: NetworkChoice[]; allowance: Allowance; album?: string; label?: string; /** Opens by itself on ?create=1 (+ Create → New post, components/app/nav.ts). */ openOnAsk?: boolean }) {
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
  // After Create: the day's sets the server is making, followed on the loading screen until they are ready.
  const [making, setMaking] = useState<{ groupIds: string[]; reel: boolean; posts: number } | null>(null);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const polled = useSetProgress(open && making ? making.groupIds : [], () => router.refresh());
  // A new key each time the dialog opens: a double click or a retry of the same request is not run twice.
  const [requestKey, setRequestKey] = useState("");
  // ?create=1 opens the dialog once, then leaves the address (a reload or Back does not open it again).
  const params = useSearchParams();
  const asked = openOnAsk && params.get("create") === "1";
  const [seenAsk, setSeenAsk] = useState(false);
  if (asked !== seenAsk) {
    setSeenAsk(asked);
    if (asked) {
      setRequestKey(globalThis.crypto.randomUUID());
      setOpen(true);
    }
  }
  useEffect(() => {
    if (!asked) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("create");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [asked]);

  const toggle = (n: Network) => setChosen((list) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n]));
  const each = mode === "own" ? 1 : Math.min(perApp, allowance.postsPerApp);
  const posts = chosen.length * each;
  const designed = (mode === "own" ? (overlays ? chosen.filter((n) => NETWORK_STYLE[n].video !== "always").length : 0) : chosen.filter((n) => NETWORK_STYLE[n].video !== "always").length) * each;
  // Videos BuPulse is likely to make: it decides picture or video per post when the run starts (format.ts), mostly
  // video on TikTok and YouTube, within the videos left (an album video, if any, costs nothing).
  const videos = mode === "own" ? 0 : expectedVideos({ networks: chosen, perApp: each, preference: format, videoInPlan: allowance.videoInPlan, videosLeft: allowance.videosLeft });
  const cost = runCost({ mode, design, posts, designed, aiPhotos: allowance.aiPhotos, textLeft: allowance.textLeft, imagesLeft: allowance.imagesLeft, videos, videosLeft: allowance.videosLeft, voice: allowance.voice, voiceCharsLeft: allowance.voiceCharsLeft });
  const missing = mode === "describe" && !brief.trim() ? "Describe today's content." : mode === "own" && media.length === 0 ? "Choose your photos or videos." : mode === "own" && !caption.trim() ? "Write your caption." : null;
  const madePosts = making?.posts ?? posts;
  const live = making ? fromSetProgress(making.groupIds.flatMap((id) => polled.get(id) ?? [])) : null;
  const screen: MakingProgress | null = pending
    ? { step: "captions", reel: videos > 0, music: videos > 0, images: [] }
    : making
      ? (live ?? { step: "images", fraction: null, reel: making.reel, music: making.reel, images: [] })
      : null;
  const doneOk = !!making && screen?.step === "ready" && !screen.failed;

  function close() {
    setOpen(false);
    setMaking(null);
  }

  // Everything made: "Ready" stays a moment, then the dialog goes (the page behind already shows the posts).
  useEffect(() => {
    if (!doneOk) return;
    const timer = setTimeout(() => {
      setOpen(false);
      setMaking(null);
    }, 2_500);
    return () => clearTimeout(timer);
  }, [doneOk]);

  function submit() {
    setError(null);
    setStartedAt(Date.now());
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
      // The day's sets being made on the server: the dialog stays on the loading screen with their real progress (it
      // may be closed any time; the page behind shows the same). Otherwise it closes, as before.
      const live = (res.sets ?? []).filter((s) => s.drawing || s.reel);
      if (live.length > 0) setMaking({ groupIds: live.map((s) => s.groupId), reel: live.some((s) => s.reel), posts: res.posts });
      else setOpen(false);
      setBrief("");
      setCaption("");
      setMedia([]);
      // Already on the page: refresh it. A push to the same address followed by a refresh raced, and the page could keep
      // showing "Nothing for today yet" until a reload (found 3 November 2026). Elsewhere, the push loads fresh data
      // (the action revalidated the Posts pages).
      if (`${window.location.pathname}${window.location.search}` === path) router.refresh();
      else router.push(path, { scroll: false });
    });
  }

  return (
    <>
      <Button onClick={() => { setRequestKey(globalThis.crypto.randomUUID()); setOpen(true); }} leading={<Sparkles aria-hidden className="size-4" />}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && (o ? setOpen(true) : close())} title="Create today's content" description={`Posts for ${subjectName}, for today. They wait for your OK on this page (or go out on their own where your settings say so).`}>
        {/* While the run writes the captions and plans the set, then while the server makes the set's pictures and
            reel: the loading screen, not the form, with the server's real progress (useSetProgress) once there is a
            set. One screen throughout, so the number never goes back. */}
        {screen && (
          <div className="mb-5 flex flex-col gap-4">
            <MakingScreen key="making" progress={screen} startedAt={startedAt} title={`Making ${madePosts === 1 ? "1 post" : `${madePosts} posts`}`} />
            {making && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-muted">{screen.step === "ready" ? (screen.failed ? "Your posts are made; open them to try the pictures again." : "Everything is made. Your posts are on the page.") : "You can close this: BuPulse keeps making them, and the page shows them when they are ready."}</p>
                <Button variant={screen.step === "ready" ? "primary" : "outline"} size="sm" onClick={close}>
                  {screen.step === "ready" ? "See your posts" : "Close"}
                </Button>
              </div>
            )}
          </div>
        )}
        <div className={cn("@container flex flex-col gap-5", screen && "hidden")}>
          <ChoiceCards
            label="How to make it"
            value={manual ? "manual" : "ai"}
            onChange={(v) => {
              setManual(v === "manual");
              setMode(v === "manual" ? "describe" : "ai");
            }}
            items={[
              { value: "ai", label: "AI makes it for me", hint: "A caption for each app from your Business info, then pictures and videos (your own Photos first).", icon: Wand2 },
              { value: "manual", label: "I'll create it", hint: "Say what to post today, or bring your own photos and caption.", icon: PenLine, tone: "violet" },
            ]}
          />

          {manual && (
            <ChoiceCards
              label="How you create it"
              value={mode === "own" ? "own" : "describe"}
              onChange={(v) => setMode(v)}
              items={[
                { value: "describe", label: "Describe it", hint: "Tell BuPulse what to post; it writes and designs it.", icon: PenLine, tone: "indigo" },
                { value: "own", label: "Bring my own", hint: "Your photos or videos and one caption, fitted to each app.", icon: Upload, tone: "pink" },
              ]}
            />
          )}

          {mode === "describe" && (
            <div className="flex flex-col gap-2">
              <Field label="What should today's posts say?" hint="Tap an idea, or write your own in a few words.">
                <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={1000} rows={2} placeholder="Promote the hydro tower for schools this week…" />
              </Field>
              <ul aria-label="Ideas" className="flex flex-wrap gap-2">
                {briefIdeas(subjectName, scope.kind === "general").map((idea) => (
                  <li key={idea}>
                    <Chip selected={brief === idea} onClick={() => setBrief(idea)} className="px-3.5 py-1.5 text-[13px]">
                      {idea}
                    </Chip>
                  </li>
                ))}
              </ul>
            </div>
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
                  {media.length ? "Change" : "Choose from Photos"}
                </Button>
              </div>
              {mode === "own" && (
                <ChoiceChips
                  label="Your photos"
                  value={overlays ? "designs" : "plain"}
                  onChange={(v) => setOverlays(v === "designs")}
                  items={[
                    { value: "plain", label: "Use them as they are" },
                    { value: "designs", label: "Add BuPulse designs on top" },
                  ]}
                />
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
            <ChoiceCards
              label="Pictures"
              value={design}
              onChange={(v) => setDesign(v)}
              items={[
                { value: "ai", label: "Unique AI pictures", hint: allowance.aiPhotos ? "A new finished ad for every post. Uses AI image credits (your own photos when they run out)." : "No AI image credits left this month, or not in your plan.", icon: Sparkles, disabled: !allowance.aiPhotos },
                { value: "free", label: "Your own photos", hint: "Your product photos as they are. No credits used.", icon: ImagePlus, tone: "violet" },
              ]}
            />
          )}

          {mode !== "own" && (
            <details className="group rounded-2xl border border-line bg-surface open:pb-1 dark:bg-white/[0.03]">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px] font-semibold">More choices</span>
                  <span className="truncate text-[12.5px] text-muted">
                    {each === 1 ? "1 post" : `${each} posts`} per app · {PRICE_CHOICE_LABEL[price]} · {FORMAT_PREFERENCE_LABEL[format]}
                  </span>
                </span>
                <ChevronDown aria-hidden className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div className="flex flex-col gap-4 px-4 pt-2 pb-3">
                {allowance.postsPerApp > 1 ? (
                  <ChoiceChips
                    label="Posts per app"
                    value={String(each)}
                    onChange={(v) => setPerApp(Number(v))}
                    items={Array.from({ length: allowance.postsPerApp }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                    hint={`Your plan allows up to ${allowance.postsPerApp} per app a day, counting what this ${scope.kind === "general" ? "page" : scope.kind} already has today.`}
                  />
                ) : (
                  <p className="text-[13px] text-muted">Your plan makes 1 post per app a day.</p>
                )}
                <ChoiceChips
                  label="Price"
                  value={price}
                  onChange={(v) => setPrice(v)}
                  items={PRICE_CHOICES.map((p) => ({ value: p, label: PRICE_CHOICE_LABEL[p] }))}
                  hint={price === "auto" ? "At most about 1 post in 4 shows the price, never two in a row." : price === "with" ? "Every post states the price (it needs one)." : "No price in captions or designs: posts that start conversations."}
                />
                <ChoiceChips label="Format" value={format} onChange={(v) => setFormat(v)} items={FORMAT_PREFERENCES.map((f) => ({ value: f, label: FORMAT_PREFERENCE_LABEL[f] }))} hint={formatHint(format, allowance)} />
              </div>
            </details>
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
              {`Create ${posts === 1 ? "1 post" : `${posts} posts`}`}
            </Button>
          </div>
        </div>
      </Dialog>
      <MediaPicker open={picking} onOpenChange={setPicking} multiple max={10} initialFolder={album} title="Choose photos or videos" onPick={(list) => setMedia(list)} />
    </>
  );
}
