"use client";

import { Clapperboard, Copy, LoaderCircle, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Chip, GlassCard, Select, Textarea, useToast } from "@/components/ui";
import { finishReelAction, recutReelAction, reelUploadAction, retryReelAction, startReelAction, stepReelAction } from "@/app/dashboard/video/reel-actions";
import type { ReelView } from "@/lib/reel-engine/engine";
import { buildReelSpec, reelCostUsd, REEL_LANGUAGES, type ReelLanguage, type ReelPlan } from "@/lib/reel-engine/story";
import { createClient } from "@/lib/supabase/client";

const STEP_EVERY_MS = 6000;
const FILMING = "Filming: start frames first, then each clip is filmed (a few minutes). Keep this tab open.";
const JOINING = "Putting your reel together. Keep this tab in front until it is done…";
const BEAT_LABEL: Record<string, string> = { hook: "1. Hook", use: "2. In use", result: "3. Result", cta: "4. Call to action" };

/**
 * "Unique AI reels" (docs/REEL_ENGINE.md), a temporary engine until the Video Studio's Seedance engine is ready: a
 * 30-second reel from 4 Google Veo clips with the company's own AI presenter, in Kinyarwanda or English. Test only:
 * every reel counts against the owner's test budget.
 */
export function UniqueReels({ products, brand, clipUsd, initialReel }: { products: { id: string; name: string }[]; brand: { name: string; color: string; contact: string | null }; clipUsd: number; initialReel: ReelView | null }) {
  const { toast } = useToast();
  const [subjectId, setSubjectId] = useState(products[0]?.id ?? "");
  const [brief, setBrief] = useState("");
  const [language, setLanguage] = useState<ReelLanguage>("Kinyarwanda");
  const [reel, setReel] = useState<ReelView | null>(initialReel);
  const [budget, setBudget] = useState<{ spent: number; cap: number } | null>(null);
  const unfinished = !!initialReel && (initialReel.status === "filming" || initialReel.status === "assembling");
  const [busy, setBusy] = useState<string | null>(unfinished ? FILMING : null);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<string | null>(null);
  const joining = useRef(false);
  // One step at a time: the next one is planned only when the last has answered. Browsers pause timers in a tab that
  // is in the background, so coming back to the tab (or opening the page again) carries on where the reel stopped.
  const stepping = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function step(id: string) {
    if (stepping.current) return;
    stepping.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const res = await stepReelAction(id).catch(() => ({ ok: false as const, error: "The connection was lost. The reel carries on when you are back." }));
    stepping.current = false;
    if (job.current !== id) return;
    if (!res.ok) {
      setError(res.error);
      setBusy(null);
      return;
    }
    setError(null);
    setReel(res.reel);
    setBudget({ spent: res.spent, cap: res.cap });
    if (res.reel.status === "filming") {
      setBusy(FILMING);
      timer.current = setTimeout(() => step(id), STEP_EVERY_MS);
    } else if (res.reel.status === "assembling") void join(res.reel);
    else setBusy(null);
  }

  // Carry on with an unfinished reel when the page opens, and whenever the tab comes back to the front.
  useEffect(() => {
    if (initialReel && unfinished) {
      job.current = initialReel.id;
      void step(initialReel.id);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && job.current && !joining.current) void step(job.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      job.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the reel the page opened with
  }, []);

  async function start() {
    setError(null);
    setReel(null);
    setBusy("Planning the story and your presenter…");
    const res = await startReelAction({ subjectId: subjectId || null, brief, language, tier: "lite" });
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    job.current = res.id;
    setBusy(FILMING);
    void step(res.id);
  }

  async function retry(id: string) {
    setError(null);
    setBusy(FILMING);
    const res = await retryReelAction(id);
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    job.current = id;
    void step(id);
  }

  /** The finished reel edited again from its clips (free). */
  async function recut(id: string) {
    setError(null);
    setBusy(JOINING);
    const res = await recutReelAction(id);
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    job.current = id;
    void step(id);
  }

  /** The 4 clips into one 30 s reel with subtitles and music, in this browser, then saved. */
  async function join(view: ReelView) {
    if (joining.current) return;
    joining.current = true;
    try {
      setBusy(JOINING);
      const [{ encodeSpecMp4, loadSpecFonts }, { beatOfTrack }] = await Promise.all([import("@/lib/video-engine/encode"), import("@/lib/reel-engine/beats")]);
      const plan: ReelPlan = { title: view.title, caption: view.caption, hashtags: view.hashtags, music: null, presenter: view.presenter ?? "", price: view.price, hook: view.hook, clips: view.clips.map((c) => ({ beat: c.beat as ReelPlan["clips"][number]["beat"], variant: "", camera: "", presenter: false, frame: "", motion: "", line: c.line, stress: c.stress, status: "done" })) };
      // The cuts land on the music's beat, found from the track itself (the library has no tempo).
      const spec = buildReelSpec(plan, view.clips.map((c) => c.clipUrl ?? ""), brand, await beatOfTrack(view.musicUrl));
      await loadSpecFonts(spec).catch(() => undefined);
      const blob = await encodeSpecMp4(spec, new Map(), { musicUrl: view.musicUrl, quality: "720p", onProgress: (f) => setBusy(`${JOINING} ${Math.round(f * 100)}%`) });
      const target = await reelUploadAction(view.id);
      if (!target.ok) throw new Error(target.error);
      const { error: uploadError } = await createClient().storage.from("gallery-videos").uploadToSignedUrl(target.path, target.token, blob, { contentType: "video/mp4", upsert: true });
      if (uploadError) throw new Error("The reel could not be saved. Please try again.");
      const done = await finishReelAction(view.id);
      if (!done.ok) throw new Error(done.error);
      setReel(done.reel);
      toast("Your reel is ready.", "success");
    } catch (e) {
      setError((e as Error).message || "The reel could not be put together.");
    } finally {
      joining.current = false;
      setBusy(null);
    }
  }

  return (
    <GlassCard as="section" aria-labelledby="unique-reels" padding="lg" className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow">
          <Clapperboard className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="unique-reels" className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-[-0.02em]">
            Unique AI reels <Badge tone="violet">Test</Badge>
          </h2>
          <p className="text-[15px] text-muted">A 30-second reel with your own AI presenter: a hook, your product in use, the result and a call to action, filmed by Google&rsquo;s AI video model. A different story every time.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {products.length > 0 && (
          <label className="flex flex-col gap-2 text-[15px] font-semibold">
            Product
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!!busy}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[15px] font-semibold">Language</legend>
          <div className="flex flex-wrap gap-2">
            {REEL_LANGUAGES.map((l) => (
              <Chip key={l} selected={language === l} onClick={() => setLanguage(l)} disabled={!!busy}>
                {l}
              </Chip>
            ))}
          </div>
        </fieldset>
      </div>
      <label className="flex flex-col gap-2 text-[15px] font-semibold">
        <span>
          Your idea <span className="font-normal text-muted">(optional)</span>
        </span>
        <Textarea rows={2} maxLength={800} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="For example: a farmer shows how much more she harvests since she has the tower" disabled={!!busy} />
      </label>
      <p className="text-[13px] text-muted">One reel costs about ${reelCostUsd(clipUsd).toFixed(2)} in AI (4 start frames and 4 clips of 8 seconds by Google&rsquo;s video model).</p>

      <div className="flex flex-col gap-3 rounded-2xl bg-soft p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px]">{busy ?? (budget ? `Test budget used: $${budget.spent.toFixed(2)} of $${budget.cap}.` : "Test only: each reel counts against the test budget.")}</p>
        <Button onClick={start} disabled={!!busy} trailing={busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Wand2 aria-hidden className="size-4" />}>
          Make my reel
        </Button>
      </div>
      {(error || reel?.status === "failed") && (
        <p role="alert" className="text-[14px] font-medium text-danger">
          {error ?? reel?.error ?? "This reel could not be made. Please try again."}
        </p>
      )}
      {reel?.status === "failed" && !busy && reel.clips.length > 0 && (
        <div>
          <Button size="sm" variant="outline" onClick={() => retry(reel.id)}>
            {reel.clips.some((c) => c.status === "done") ? "Try the failed clips again" : "Try this reel again"}
          </Button>
          <p className="mt-1 text-[13px] text-muted">What is already made (start frames and filmed clips) is kept.</p>
        </div>
      )}

      {reel?.reelUrl && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <video src={reel.reelUrl} controls playsInline className="w-full max-w-[320px] rounded-2xl bg-black" />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-lg font-semibold">{reel.title}</p>
            <p className="whitespace-pre-line text-[14px] text-muted">{[reel.caption, reel.hashtags.join(" ")].filter(Boolean).join("\n\n")}</p>
            <Button size="sm" variant="outline" leading={<Copy aria-hidden className="size-4" />} onClick={() => navigator.clipboard.writeText([reel.caption, reel.hashtags.join(" ")].filter(Boolean).join("\n\n")).then(() => toast("Caption copied.", "success"), () => undefined)}>
              Copy caption
            </Button>
            <p className="text-[13px] text-muted">Cost of this reel: ${reel.costUsd.toFixed(2)}.</p>
            <Button size="sm" variant="ghost" onClick={() => recut(reel.id)} disabled={!!busy}>
              Re-cut it (free)
            </Button>
          </div>
        </div>
      )}

      {reel && reel.clips.length > 0 && !reel.reelUrl && (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {reel.clips.map((c, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-2">
              <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-soft">
                {c.clipUrl ? (
                  <video src={c.clipUrl} muted loop autoPlay playsInline className="absolute inset-0 size-full object-cover" />
                ) : c.frameUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
                  <img src={c.frameUrl} alt="" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted">
                    <LoaderCircle aria-hidden className="size-5 animate-spin" />
                  </div>
                )}
              </div>
              <p className="text-[13px] font-semibold">{BEAT_LABEL[c.beat] ?? c.beat}</p>
              <p className="text-[12px] text-muted">{c.status === "done" ? "Filmed and checked" : c.status === "filming" ? "Filming…" : c.status === "framed" ? (c.problems.length ? "Filming again: the check found a problem" : "Start frame ready") : c.status === "failed" ? "Failed" : "Waiting"}</p>
              {c.line && <p className="text-[12px] italic">“{c.line}”</p>}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
