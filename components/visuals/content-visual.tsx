"use client";

/**
 * <ContentVisual> shows the picture (image or carousel) and the video that come with a piece of content, draws them
 * when they are still pending, and lets the owner change them: another photo, style pack or template, the slide
 * texts, a new picture, captions and music for the video, or removing either. docs/CONTENT_VISUALS.md.
 *
 * Props:
 *   contentId    The GeneratedContent version (Studio); omit for an Autopilot group (no "make a new one").
 *   image        Its image or carousel visual (lib/visuals/queries.ts loadVisuals / pickVisuals), or null.
 *   video        Its video visual, or null.
 *   videoInPlan  Whether the company's plan has video; false shows "Add video to your plan".
 *   album        The product's or campaign's album ("product:<id>"), where "Swap photo" opens the gallery.
 *   autoVideo    Start making a pending video as soon as this shows (default true). Autopilot cards pass false and
 *                show "Video ready to render" with a button instead, so one page does not make many at once.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Clapperboard, ImageIcon, Music, PenLine, RefreshCw, Replace, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { MediaPicker } from "@/components/media/media-picker";
import { changeVideoMusic, changeVideoVoice, loadSoundOptions } from "@/app/dashboard/visuals/actions";
import { isMood, MOOD_LABEL } from "@/lib/music/tracks";
import { DEFAULT_VOICE_ID, VOICES } from "@/lib/voice/voices";
import { changeVideo, changeVisual, deleteVisual, remakeVisual, renderVisual } from "@/app/dashboard/visuals/actions";
import { cn } from "@/lib/cn";
import { PACKS } from "@/lib/designs/packs";
import { TEMPLATES } from "@/lib/designs/templates/registry";
import { VISUAL_LIMITS, VIDEO_LIMITS, VIDEO_REMOVED_NOTE, VIDEO_RETENTION_MESSAGE, type VisualView } from "@/lib/visuals/types";
import { useVideoRender } from "./use-video-render";

type Props = { contentId?: string; image: VisualView | null; video: VisualView | null; videoInPlan: boolean; album?: string; autoVideo?: boolean };

export function ContentVisual({ contentId, image, video, videoInPlan, album, autoVideo = true }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <ImagePart contentId={contentId} visual={image} album={album} />
      <VideoPart contentId={contentId} visual={video} videoInPlan={videoInPlan} autoStart={autoVideo} hasImage={!!image?.items.length} />
    </div>
  );
}

function useRun() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const r = await action();
      if (!r.ok) return toast(r.error ?? "Something went wrong.", "error");
      if (done) toast(done, "success");
      router.refresh();
    });
  return { run, pending, router, toast };
}

// ---- the picture ----

function ImagePart({ contentId, visual, album }: { contentId?: string; visual: VisualView | null; album?: string }) {
  const { run, pending, router, toast } = useRun();
  const [index, setIndex] = useState(0);
  const [drawing, setDrawing] = useState<{ drawn: number; total: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const started = useRef<string | null>(null);
  const plan = visual?.imagePlan;
  const slides = plan?.slides ?? [];
  const [texts, setTexts] = useState(() => slides.map((s) => ({ headline: s.headline, subline: s.subline, chip: s.chip })));

  // A pending picture is drawn a few slides per call until it is ready (each call stays inside the host's time limit).
  useEffect(() => {
    if (!visual || visual.status !== "pending") {
      started.current = null;
      return;
    }
    if (started.current === visual.id) return;
    started.current = visual.id;
    let stop = false;
    void (async () => {
      for (let i = 0; i < VISUAL_LIMITS.maxCarouselSlides + 2 && !stop; i++) {
        const r = await renderVisual(visual.id);
        if (!r.ok) {
          toast(r.error, "error");
          break;
        }
        // Another tab or call is drawing it: wait for it instead of drawing twice.
        if (r.status === "rendering") {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        setDrawing({ drawn: r.drawn, total: r.total });
        if (r.status !== "pending") break;
      }
      setDrawing(null);
      router.refresh();
    })();
    return () => {
      stop = true;
    };
  }, [visual, router, toast]);

  if (!visual) {
    return contentId ? (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line p-4">
        <span className="flex items-center gap-2 text-[14px] text-muted">
          <ImageIcon aria-hidden className="size-5" /> No picture yet.
        </span>
        <Button size="sm" disabled={pending} leading={<Sparkles aria-hidden className="size-4" />} onClick={() => run(() => remakeVisual(contentId, "image"))}>
          Make the picture
        </Button>
      </div>
    ) : null;
  }

  const items = visual.items;
  const current = Math.min(index, Math.max(0, items.length - 1));
  const slide = slides[current];
  const isCarousel = slides.length > 1;
  const busy = pending || !!drawing || visual.status === "pending";

  function saveTexts() {
    run(async () => {
      const r = await changeVisual(visual!.id, { slides: texts.map((t, i) => ({ index: i, ...t })) });
      if (r.ok) setEditing(false);
      return r;
    }, "The picture is being drawn again with your text.");
  }

  return (
    <section aria-label="Picture" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">{isCarousel ? `Carousel, ${slides.length} slides` : "Picture"}</h3>
        {plan && <Badge tone="neutral">{PACKS.find((p) => p.id === plan.pack)?.name ?? plan.pack}</Badge>}
        {slides.some((s) => s.source === "ai") && <Badge tone="violet">AI photo</Badge>}
        {visual.status === "failed" && <Badge tone="danger">Not finished</Badge>}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative aspect-[4/5] w-full max-w-xs overflow-hidden rounded-2xl bg-soft">
          {items[current] ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
            <img src={items[current].url} alt={slide?.headline ?? "Picture"} className="size-full object-cover" />
          ) : (
            <span role="status" className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-[14px] text-muted">
              <RefreshCw aria-hidden className={cn("size-6", busy && "animate-spin")} />
              {drawing ? `Drawing slide ${Math.min(drawing.drawn + 1, drawing.total)} of ${drawing.total}…` : visual.status === "failed" ? (visual.error ?? "The picture could not be drawn.") : "Drawing your picture…"}
            </span>
          )}
          {items.length > 1 && (
            <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" aria-label="Previous slide" disabled={current === 0} onClick={() => setIndex(current - 1)}>
                <ChevronLeft aria-hidden className="size-4" />
              </Button>
              <span className="rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
                {current + 1} / {items.length}
              </span>
              <Button variant="outline" size="sm" aria-label="Next slide" disabled={current >= items.length - 1} onClick={() => setIndex(current + 1)}>
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {[...new Set(slides.map((s) => s.note).filter(Boolean))].map((n) => (
            <p key={n} className="text-[13px] text-muted">
              {n}
            </p>
          ))}
          {plan?.notes.map((n) => (
            <p key={n} className="text-[13px] text-muted">
              {n}
            </p>
          ))}
          {(plan?.aiExhausted || slides.some((s) => s.note?.startsWith("AI images for this month used"))) && (
            <Button href="/dashboard/billing" size="sm" variant="outline" className="self-start">
              Get an image pack (+50 AI images)
            </Button>
          )}
          {visual.status === "failed" && visual.error && (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {visual.error}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Style">
              <Select value={plan?.pack} disabled={busy} onChange={(e) => run(() => changeVisual(visual.id, { pack: e.target.value }))}>
                {PACKS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Template">
              <Select value={slide?.template} disabled={busy} onChange={(e) => run(() => changeVisual(visual.id, { template: e.target.value }))}>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} leading={<Replace aria-hidden className="size-4" />} onClick={() => setPicker(true)}>
              {isCarousel ? "Swap this slide's photo" : "Swap photo"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              leading={<PenLine aria-hidden className="size-4" />}
              onClick={() => {
                setTexts(slides.map((s) => ({ headline: s.headline, subline: s.subline, chip: s.chip })));
                setEditing((e) => !e);
              }}
            >
              Edit text
            </Button>
            {contentId && (
              <Button variant="outline" size="sm" disabled={busy} title="A new art direction. AI photos use image credits." leading={<RefreshCw aria-hidden className="size-4" />} onClick={() => run(() => remakeVisual(contentId, "image"), "A new picture is on its way.")}>
                New picture
              </Button>
            )}
            {visual.status === "failed" && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => renderVisual(visual.id))}>
                Try again
              </Button>
            )}
            {confirm ? (
              <span className="inline-flex gap-2">
                <Button variant="outline" size="sm" className="border-danger text-danger" disabled={pending} onClick={() => run(() => deleteVisual(visual.id), "The picture was removed.")}>
                  Yes, remove
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" disabled={busy} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => setConfirm(true)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="flex flex-col gap-4 rounded-2xl bg-soft p-4">
          {texts.map((t, i) => (
            <fieldset key={i} className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-1 text-[13px] font-medium text-muted">{isCarousel ? `Slide ${i + 1}` : "Text on the picture"}</legend>
              <Field label="Headline">
                <Input value={t.headline} maxLength={VISUAL_LIMITS.headline} onChange={(e) => setTexts(texts.map((x, j) => (j === i ? { ...x, headline: e.target.value } : x)))} />
              </Field>
              <Field label="Subline">
                <Input value={t.subline} maxLength={VISUAL_LIMITS.subline} onChange={(e) => setTexts(texts.map((x, j) => (j === i ? { ...x, subline: e.target.value } : x)))} />
              </Field>
              <Field label="Chip">
                <Input value={t.chip} maxLength={VISUAL_LIMITS.chip} onChange={(e) => setTexts(texts.map((x, j) => (j === i ? { ...x, chip: e.target.value } : x)))} />
              </Field>
            </fieldset>
          ))}
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={saveTexts}>
              Save and redraw
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <MediaPicker
        open={picker}
        onOpenChange={setPicker}
        initialFolder={album}
        title="Choose a photo for this slide"
        onPick={([photo]) => photo && run(() => changeVisual(visual.id, { swap: { index: current, photoPath: photo.path } }), "The slide is being drawn with your photo.")}
      />
    </section>
  );
}

// ---- the video ----

function VideoPart({ contentId, visual, videoInPlan, autoStart, hasImage }: { contentId?: string; visual: VisualView | null; videoInPlan: boolean; autoStart: boolean; hasImage: boolean }) {
  const { run, pending, router } = useRun();
  const render = useVideoRender(visual, () => router.refresh());
  const [captions, setCaptions] = useState<string[] | null>(null);
  const [music, setMusic] = useState<File | null>(null);
  const [opened, setOpened] = useState(autoStart);
  const started = useRef<string | null>(null);
  const plan = visual?.videoPlan;
  const { run: startRender } = render;

  // While the video robot is on, a pending video is made automatically (docs/VIDEO_ROBOT.md); the owner may still
  // make it now. The screen looks again every minute so the finished video appears.
  const robotBusy = visual?.status === "pending" && (visual.robot === "queued" || visual.robot === "making");
  const { refresh } = router;
  useEffect(() => {
    if (!robotBusy || render.busy) return;
    const timer = setInterval(() => refresh(), 60_000);
    return () => clearInterval(timer);
  }, [robotBusy, render.busy, refresh]);

  // A pending video is made when it is opened: right away on the content page, on "Make the video" on Autopilot cards.
  useEffect(() => {
    if (visual && visual.status !== "pending" && !render.busy) started.current = null;
    if (!visual || visual.status !== "pending" || !opened || started.current === visual.id || robotBusy) return;
    started.current = visual.id;
    void startRender(music);
  }, [visual, opened, music, startRender, render.busy, robotBusy]);

  const comingSoon = (
    <label className="flex items-center gap-2 text-[13px] text-muted">
      <input type="checkbox" disabled className="size-4" /> AI video (coming soon)
    </label>
  );

  if (!videoInPlan) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-soft p-4 text-[14px]">
        <span className="flex items-center gap-2 text-muted">
          <Clapperboard aria-hidden className="size-5" /> {hasImage ? "The picture is used for video posts." : "Videos are not in your plan."}
        </span>
        <Button href="/dashboard/upgrade?feature=video" size="sm" variant="outline">
          Add video to your plan
        </Button>
      </div>
    );
  }
  if (!visual || !plan) {
    return contentId ? (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line p-4">
        <span className="flex items-center gap-2 text-[14px] text-muted">
          <Clapperboard aria-hidden className="size-5" /> No video yet.
        </span>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => remakeVisual(contentId, "video"))}>
          Make a video
        </Button>
      </div>
    ) : null;
  }

  // A video being made again keeps showing (and stays on its posts) until the new one is saved.
  const ready = !!visual.items[0];
  const remaking = ready && visual.status !== "ready";
  // The 30-day clean-up removed the file; the posts went out and the video stays on the social accounts.
  const removed = visual.status === "ready" && !visual.items[0] && visual.error === VIDEO_REMOVED_NOTE;
  const seconds = Math.ceil(plan.totalMs / 1000);
  const redo = () =>
    run(async () => {
      const r = await changeVideo(visual.id, {});
      if (r.ok) {
        started.current = null;
        setOpened(true);
      }
      return r;
    });

  return (
    <section aria-label="Video" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">Video, {seconds} seconds</h3>
        <Badge tone="neutral">{plan.scenes.length} scenes</Badge>
        {visual.status === "pending" && !render.busy && <Badge tone="blue">{robotBusy ? "Being made automatically" : "Video ready to render"}</Badge>}
        {visual.status === "failed" && <Badge tone="danger">{ready ? "New version not made" : "Not made"}</Badge>}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-2xl bg-soft">
          {ready && !render.busy ? (
            <video src={visual.items[0].url} controls playsInline preload="metadata" className="size-full object-cover" aria-label="Your video" />
          ) : (
            <div role="status" className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center text-[13px] text-muted">
              <Clapperboard aria-hidden className={cn("size-6", render.busy && "animate-pulse")} />
              {render.phase === "rendering" && `Making your video… ${Math.round(render.progress * 100)}%`}
              {render.phase === "loading" && "Getting ready…"}
              {render.phase === "uploading" && "Saving your video…"}
              {!render.busy && visual.status === "pending" && visual.robot === "queued" && "Being made automatically (usually within 30 min)."}
              {!render.busy && visual.status === "pending" && visual.robot === "making" && "Being made automatically right now…"}
              {!render.busy && visual.status === "pending" && visual.robot === "browser" && "We could not make it automatically. Make it here in your browser."}
              {!render.busy && visual.status === "pending" && !visual.robot && "Your video plan is ready."}
              {!render.busy && visual.status === "failed" && (visual.error ?? "The video could not be made here.")}
              {!render.busy && removed && `${VIDEO_REMOVED_NOTE}. It is still on your social accounts.`}
              {render.busy && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden>
                  <div className="h-full bg-pulse-blue transition-[width]" style={{ width: `${Math.round((render.phase === "uploading" ? 1 : render.progress) * 100)}%` }} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {render.error && (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {render.error}
            </p>
          )}
          {visual.status === "failed" && hasImage && !ready && <p className="text-[13px] text-muted">Until then, the picture is used for video posts.</p>}
          {remaking && !render.busy && (
            <p className="text-[13px] text-muted">
              {visual.status === "failed" ? `${visual.error ?? "The new version could not be made."} Your current video is kept.` : "A new version is waiting to be made. Your current video stays until it is saved."}
            </p>
          )}
          {render.musicSkipped && <p className="text-[13px] text-muted">Your music could not be added in this browser, so the video has no sound.</p>}
          <p className="text-[13px] text-muted">
            {visual.robot ? "Made automatically (or in your browser) from your photos and script" : "Made in your browser from your photos and script"}, {VIDEO_LIMITS.width}x{VIDEO_LIMITS.height}, captions included. It counts {seconds} seconds of your plan&apos;s video; making it again counts only the seconds it gets longer.
          </p>
          <div className="flex flex-wrap gap-2">
            {visual.status === "pending" && !render.busy && visual.robot === "queued" && (
              <Button size="sm" variant="outline" leading={<Clapperboard aria-hidden className="size-4" />} onClick={() => {
                started.current = visual.id;
                void render.run(music);
              }}>
                Make it now
              </Button>
            )}
            {visual.status === "pending" && !render.busy && !robotBusy && (
              <Button size="sm" leading={<Clapperboard aria-hidden className="size-4" />} onClick={() => (opened ? void render.run(music) : setOpened(true))}>
                Make the video
              </Button>
            )}
            {render.busy && (
              <Button size="sm" variant="ghost" onClick={render.cancel}>
                Stop
              </Button>
            )}
            {visual.status !== "pending" && (
              <Button size="sm" variant="outline" disabled={pending || render.busy} leading={<RefreshCw aria-hidden className="size-4" />} onClick={redo}>
                {visual.status === "failed" ? "Try again" : "Make it again"}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={render.busy} leading={<PenLine aria-hidden className="size-4" />} onClick={() => setCaptions(captions ? null : plan.scenes.map((s) => s.text))}>
              Edit captions
            </Button>
            <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm font-medium", render.busy && "pointer-events-none opacity-50")}>
              <Music aria-hidden className="size-4" />
              {music ? music.name.slice(0, 24) : "Add your music"}
              <input type="file" accept="audio/*" className="sr-only" onChange={(e) => setMusic(e.target.files?.[0] ?? null)} />
            </label>
            {music && visual.status === "ready" && !render.busy && (
              <Button size="sm" variant="outline" onClick={() => void render.run(music)}>
                Add music to the video
              </Button>
            )}
            {contentId && (
              <Button size="sm" variant="ghost" disabled={pending || render.busy} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => run(() => deleteVisual(visual.id), "The video was removed.")}>
                Remove
              </Button>
            )}
          </div>
          <SoundChoices visual={visual} disabled={render.busy} onChanged={() => {
            started.current = null;
            setOpened(true);
          }} />
          <p className="text-[12px] text-muted">{VIDEO_RETENTION_MESSAGE}</p>
          {comingSoon}
          <p className="text-[12px] text-muted">Only music you own or may use. It is added in your browser and never stored on its own.</p>
        </div>
      </div>

      {captions && (
        <div className="flex flex-col gap-3 rounded-2xl bg-soft p-4">
          {captions.map((c, i) => (
            <Field key={i} label={`Scene ${i + 1}`}>
              <Textarea rows={2} maxLength={VIDEO_LIMITS.sceneText} value={c} onChange={(e) => setCaptions(captions.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await changeVideo(visual.id, { texts: captions });
                  if (r.ok) {
                    setCaptions(null);
                    started.current = null;
                    setOpened(true);
                  }
                  return r;
                }, "Your captions are saved. The video is made again.")
              }
            >
              Save and make again
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCaptions(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- voiceover and music (docs/VOICE_AND_MUSIC.md) ----

type SoundOptions = { tracks: { id: string; title: string; moods: string[] }[]; voiceInPlan: boolean; used: number; limit: number };

/** Voice on or off, which voice, "Regenerate voiceover", and the music track, with the month's voiceover characters. */
function SoundChoices({ visual, disabled, onChanged }: { visual: VisualView; disabled: boolean; onChanged: () => void }) {
  const { run, pending } = useRun();
  const [options, setOptions] = useState<SoundOptions | null>(null);
  const plan = visual.videoPlan;
  useEffect(() => {
    let live = true;
    void loadSoundOptions().then((r) => live && r.ok && setOptions(r));
    return () => {
      live = false;
    };
  }, []);
  if (!plan) return null;
  const voiceOn = plan.voice?.enabled !== false;
  const voiceId = plan.voice?.voiceId ?? DEFAULT_VOICE_ID;
  const busy = disabled || pending;
  const change = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    run(async () => {
      const r = await action();
      if (r.ok) onChanged();
      return r;
    });

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-soft p-4">
      <h4 className="text-[14px] font-semibold">Sound</h4>
      {options && !options.voiceInPlan ? (
        <p className="text-[13px] text-muted">Voiceover is not in your plan. <a href="/dashboard/upgrade?feature=voice" className="font-semibold text-pulse-blue underline">Add voiceover</a></p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" className="size-4" checked={voiceOn} disabled={busy} onChange={(e) => change(() => changeVideoVoice(visual.id, { enabled: e.target.checked, voiceId }))} />
            Voiceover
          </label>
          <Field label="Voice">
            <Select value={voiceId} disabled={busy || !voiceOn} onChange={(e) => change(() => changeVideoVoice(visual.id, { enabled: true, voiceId: e.target.value }))}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.gender === "female" ? "female" : "male"})
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" variant="outline" disabled={busy || !voiceOn} onClick={() => change(() => changeVideoVoice(visual.id, { enabled: true, voiceId, regenerate: true }))}>
            Regenerate voiceover
          </Button>
        </div>
      )}
      {plan.voice?.note && <p className="text-[13px] text-muted">{plan.voice.note}</p>}
      {options && options.limit > 0 && (
        <p className="text-[13px] text-muted">
          Voiceover: {options.used.toLocaleString("en-US")} of {options.limit.toLocaleString("en-US")} characters this month
        </p>
      )}
      <Field label="Music">
        <Select value={plan.music?.trackId ?? ""} disabled={busy || !options} onChange={(e) => change(() => changeVideoMusic(visual.id, e.target.value || null))}>
          <option value="">No music</option>
          {plan.music && !options?.tracks.some((t) => t.id === plan.music!.trackId) && <option value={plan.music.trackId}>{plan.music.title}</option>}
          {options?.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} · {t.moods.map((m) => (isMood(m) ? MOOD_LABEL[m] : m)).join(", ")}
            </option>
          ))}
        </Select>
      </Field>
      {options && options.tracks.length === 0 && <p className="text-[13px] text-muted">The music library is empty for now, so videos have no background music.</p>}
      {plan.music?.attribution && !plan.music.owned && <p className="text-[12px] text-muted">Music: {plan.music.attribution}</p>}
    </div>
  );
}
