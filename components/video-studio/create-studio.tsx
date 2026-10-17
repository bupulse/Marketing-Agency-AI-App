"use client";

/**
 * <CreateStudio> is the Video Studio's Create page, first release (docs/VIDEO_APP_INTEGRATION.md, task 6): Motion
 * videos only. The owner picks a product, a template, where it will be posted, the shape, the length, an opening line
 * (the Brain's suggestions) and the voice-over, and presses Generate: Claude designs it (POST /api/video/design, video
 * credits, given back for a design that fails). Each design shows its research score, its caption check and the facts
 * to check; "Make the MP4" draws and encodes it in this browser (lib/video-engine/encode.ts) and saves it into the
 * Gallery's "Video Studio" folder. A port of the lab's video-lab/site/client/create.ts, without Seedance, Premium 3D,
 * presenters, edit and extend (later releases).
 *
 * Props:
 *   products     the company's products and services ({ id, name }), at least one
 *   templates    the Motion templates without presenters (lib/video-engine/templates.ts, no art direction)
 *   categories   the template categories that have templates, in catalogue order
 *   initialJobs  the latest Motion jobs (lib/video-studio/library.ts listStudioJobs)
 *   credits      { used, limit, resetsAt } of the plan's video credits, for "N left" and the paywall
 *   price        video credits per design (CLAUDE_VIDEO_CREDITS)
 *   voicePrice   video credits for a new voice-over take (VOICE_OVER_CREDITS); the same take again is free
 *   tracks       the music library's active tracks (public files, mixed into the MP4 in the browser, free)
 *   timeZone     the business's time zone, for the times on the job cards (the same on the server and in the browser)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clapperboard, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Badge, Button, Field, GlassCard, Select, useToast } from "@/components/ui";
import { useUsageBlock } from "@/components/billing/upgrade-dialog";
import { finishJobVideoUpload, loadJobForDrawing, loadOpeningLines, startJobVideoUpload } from "@/app/dashboard/video/actions";
import { discardUpload } from "@/app/dashboard/gallery/actions";
import { cn } from "@/lib/cn";
import { GALLERY_VIDEO_BUCKET, POSTER_MAX_BYTES } from "@/lib/media/rules";
import { createClient } from "@/lib/supabase/client";
import type { HookSuggestion } from "@/lib/video-engine/brain/suggest";
import type { DesignScore, CaptionScore } from "@/lib/video-engine/brain/score";
import type { FactWarning } from "@/lib/video-engine/factcheck";
import type { Photos } from "@/lib/video-engine/draw";
import { canvasSize, totalMs, type MotionSpec, type Ratio } from "@/lib/video-engine/spec";
import type { VoiceCue } from "@/lib/video-engine/voice";
import { pickTrack } from "@/lib/music/tracks";
import type { StudioJob, StudioTrack } from "@/lib/video-studio/library";
import type { JobVoice } from "@/lib/video-studio/voice";

export type StudioTemplate = { id: string; category: string; name: string; blurb: string; seconds: number | null; hook: string | null };

type Props = {
  products: { id: string; name: string }[];
  templates: StudioTemplate[];
  categories: { id: string; name: string }[];
  initialJobs: StudioJob[];
  credits: { used: number; limit: number; resetsAt: string | null };
  price: number;
  voicePrice: number;
  tracks: StudioTrack[];
  timeZone: string;
};

type PlatformKey = "tiktok" | "instagram" | "facebook" | "youtube";

const PLATFORM_CHOICES: { id: PlatformKey | null; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "youtube", label: "YouTube Shorts" },
  { id: null, label: "Anywhere" },
];
/** The shapes social posts use (the engine has more). */
const SHAPES: { id: Ratio; label: string; box: string }[] = [
  { id: "9:16", label: "Vertical 9:16", box: "h-4 w-[9px]" },
  { id: "4:5", label: "Portrait 4:5", box: "h-4 w-[13px]" },
  { id: "1:1", label: "Square 1:1", box: "size-4" },
  { id: "16:9", label: "Wide 16:9", box: "h-[9px] w-4" },
];
const LENGTHS = [8, 10, 12, 15, 20, 30];
/** The MP4's quality: what Reels, TikTok and Shorts show best. */
const MP4_QUALITY = "1080p" as const;
/**
 * 4 Mbit/s, under the encoder's default (about 6 at 1080p): about 7.5 MB for 15 s. Gallery videos share a 100 MB cap per
 * company (MEDIA_COMPANY_VIDEO_MAX_BYTES), and the networks re-encode to about this rate anyway.
 */
const MP4_BITRATE = 4_000_000;

const STATUS: Record<string, { label: string; tone: "neutral" | "blue" | "violet" | "success" | "danger" }> = {
  designing: { label: "Designing", tone: "violet" },
  designed: { label: "Designed", tone: "blue" },
  ready: { label: "MP4 ready", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

function Pills<T extends string | null>({ label, options, value, onChange }: { label: string; options: { id: T; label: string; box?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id ?? "none"}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold",
            value === o.id ? "border-pulse-blue bg-ok-bg text-ok" : "border-line bg-transparent text-text hover:bg-soft",
          )}
        >
          {o.box && <span aria-hidden className={cn("rounded-[3px] border-2 border-current", o.box)} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-[13px] text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function CreateStudio({ products, templates, categories, initialJobs, credits, price, voicePrice, tracks, timeZone }: Props) {
  const { toast } = useToast();
  const { handleBody, dialog } = useUsageBlock({ limit: credits.limit, resetsAt: credits.resetsAt });
  const [productId, setProductId] = useState(products[0].id);
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates.find((t) => t.category === categories[0]?.id)?.id ?? templates[0].id);
  const [platform, setPlatform] = useState<PlatformKey | null>("tiktok");
  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [seconds, setSeconds] = useState(15);
  const [voice, setVoice] = useState(true);
  const [lines, setLines] = useState<HookSuggestion[]>([]);
  const [chosen, setChosen] = useState<HookSuggestion | null>(null);
  const [generating, setGenerating] = useState(false);
  const [used, setUsed] = useState(credits.used);
  const [jobs, setJobs] = useState<StudioJob[]>(initialJobs);

  const left = Math.max(0, credits.limit - used);
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const shown = useMemo(() => templates.filter((t) => t.category === category), [templates, category]);

  // The Brain's opening lines for these choices (free); a line that no longer fits is dropped.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const res = await loadOpeningLines({ productId, templateId, seconds, platform }).catch(() => null);
      if (!live) return;
      const next = res?.ok ? res.lines : [];
      setLines(next);
      setChosen((c) => (c && next.some((l) => l.line === c.line) ? c : null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [productId, templateId, seconds, platform]);

  const pickTemplate = (t: StudioTemplate) => {
    setTemplateId(t.id);
    if (t.seconds && LENGTHS.includes(t.seconds)) setSeconds(t.seconds);
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/video/design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, templateId, hookId: chosen?.hookId ?? template.hook ?? "auto", ratio, seconds, platform, voice, chosenHook: chosen ? { hookId: chosen.hookId, line: chosen.line } : null }),
      });
      const body = (await res.json().catch(() => null)) as { jobs?: StudioJob[]; message?: string } | null;
      if (res.status === 402 && handleBody(body)) return;
      const made = (body?.jobs ?? []).map((j) => ({ ...j, videoUrl: null, posterUrl: null }));
      if (made.length) setJobs((list) => [...made, ...list.filter((j) => !made.some((m) => m.id === j.id))]);
      if (!res.ok) {
        toast(body?.message ?? "The video could not be designed. Please try again.", "error");
        return;
      }
      setUsed((u) => u + made.filter((j) => j.status === "designed").length * price);
      toast("Your video is designed. Check it, then make the MP4.", "success");
    } catch {
      toast("The video could not be designed. Check your connection and try again.", "error");
    } finally {
      setGenerating(false);
    }
  };

  const replaceJob = useCallback((job: StudioJob) => setJobs((list) => list.map((j) => (j.id === job.id ? job : j))), []);
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "Product";

  return (
    <div className="flex flex-col gap-6">
      <GlassCard className="flex flex-col gap-6 p-5 sm:p-6">
        <Field label="Product or service">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Section title="Template" hint="The look, the camera and the pacing. Claude fills it with your product's facts and photos.">
          <Pills label="Template category" options={categories.map((c) => ({ id: c.id, label: c.name }))} value={category} onChange={setCategory} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={t.id === templateId}
                onClick={() => pickTemplate(t)}
                className={cn("flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 text-left", t.id === templateId ? "border-pulse-blue bg-ok-bg" : "border-line hover:bg-soft")}
              >
                <span className="text-sm font-semibold">{t.name}</span>
                <span className="text-[13px] text-muted">{t.blurb}</span>
                {t.seconds && <span className="text-xs text-muted">Suggested: {t.seconds} s</span>}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Made for" hint="Text stays clear of that app's buttons, and the pacing and caption follow what works there.">
          <Pills label="Made for" options={PLATFORM_CHOICES} value={platform} onChange={setPlatform} />
        </Section>

        <div className="grid gap-6 sm:grid-cols-2">
          <Section title="Shape">
            <Pills label="Shape" options={SHAPES} value={ratio} onChange={setRatio} />
          </Section>
          <Section title="Length">
            <Pills label="Length" options={LENGTHS.map((s) => ({ id: String(s), label: `${s} s` }))} value={String(seconds)} onChange={(v) => setSeconds(Number(v))} />
          </Section>
        </div>

        {lines.length > 0 && (
          <Section title="Opening line" hint="What the first second says: lines that work for this kind of video. Optional; without one, Claude picks.">
            <div role="group" aria-label="Opening line" className="flex flex-wrap gap-2">
              {lines.map((l) => (
                <button
                  key={l.line}
                  type="button"
                  title={`${l.name}. ${l.why}`}
                  aria-pressed={chosen?.line === l.line}
                  onClick={() => setChosen((c) => (c?.line === l.line ? null : l))}
                  className={cn("inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm", chosen?.line === l.line ? "border-transparent bg-brand-gradient text-white" : "border-line hover:bg-soft")}
                >
                  “{l.line}”
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Voice-over" hint={`A voice reads the video's lines in your company's voice: ${voicePrice} video credits when you make the MP4, free when you make it again.`}>
          <Pills
            label="Voice-over"
            options={[
              { id: "on", label: "With a voice-over" },
              { id: "off", label: "Text only" },
            ]}
            value={voice ? "on" : "off"}
            onChange={(v) => setVoice(v === "on")}
          />
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="text-sm text-muted">
            Uses {price} video credits ({left} of {credits.limit} left this month). Given back if the design fails.
          </p>
          <Button onClick={generate} disabled={generating} leading={generating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}>
            {generating ? "Designing… (up to a minute)" : "Generate"}
          </Button>
        </div>
      </GlassCard>

      <section aria-label="Your videos" className="flex flex-col gap-3">
        <h2 className="px-1 text-lg font-semibold">Your videos</h2>
        {jobs.length === 0 ? (
          <GlassCard className="flex items-center gap-3 p-5 text-sm text-muted">
            <Clapperboard className="size-5" aria-hidden />
            Your designs appear here. Generate your first video above.
          </GlassCard>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} templateName={templates.find((t) => t.id === j.templateId)?.name ?? j.templateId ?? "Template"} productName={productName} timeZone={timeZone} voicePrice={voicePrice} tracks={tracks} onSaved={replaceJob} onCharged={(n) => setUsed((u) => u + n)} onBlocked={handleBody} />
            ))}
          </div>
        )}
      </section>
      {dialog}
    </div>
  );
}

const asScore = (v: unknown): DesignScore | null => (v && typeof v === "object" && typeof (v as DesignScore).score === "number" ? (v as DesignScore) : null);
const asWarnings = (v: unknown): FactWarning[] => (Array.isArray(v) ? (v as FactWarning[]).filter((w) => w && typeof w.message === "string") : []);

type CardProps = {
  job: StudioJob;
  templateName: string;
  productName: (id: string) => string;
  timeZone: string;
  voicePrice: number;
  tracks: StudioTrack[];
  onSaved: (job: StudioJob) => void;
  /** Video credits a voice-over took (for "N left"). */
  onCharged: (credits: number) => void;
  /** The paywall for a 402 answer; true when it took over. */
  onBlocked: (body: unknown) => boolean;
};

/** The voice-over of a design (POST /api/video/jobs/<id>/voice): null with the reason when the MP4 is made without one. */
async function fetchVoice(jobId: string): Promise<{ voice: JobVoice | null; credits: number; problem: string | null; blocked?: unknown }> {
  try {
    const res = await fetch(`/api/video/jobs/${encodeURIComponent(jobId)}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = (await res.json().catch(() => null)) as { voice?: JobVoice | null; credits?: number; message?: string } | null;
    if (res.status === 402) return { voice: null, credits: 0, problem: "Your video credits are used up, so this MP4 has no voice-over.", blocked: body };
    if (!res.ok) return { voice: null, credits: 0, problem: body?.message ?? "The voice-over could not be made, so this MP4 has none." };
    return { voice: body?.voice ?? null, credits: body?.credits ?? 0, problem: null };
  } catch {
    return { voice: null, credits: 0, problem: "The voice-over could not be reached, so this MP4 has none." };
  }
}

function JobCard({ job, templateName, productName, timeZone, voicePrice, tracks, onSaved, onCharged, onBlocked }: CardProps) {
  const { toast } = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const [step, setStep] = useState("");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  // "auto": the design's mood (spec.music), varied by the job; a track id; or "none".
  const [musicChoice, setMusicChoice] = useState<string>(job.music?.trackId ?? (job.status === "ready" ? "none" : "auto"));
  const suggested = useMemo(() => pickTrack(tracks, job.spec?.music ?? null, job.id), [tracks, job.spec, job.id]);
  const track = musicChoice === "none" ? null : musicChoice === "auto" ? suggested : (tracks.find((t) => t.id === musicChoice) ?? suggested);
  // The designer always writes say lines; they are spoken only when the owner asked for a voice-over.
  const hasLines = job.voice && !!job.spec?.scenes.some((s) => s.say?.trim());
  const busy = useRef(false);
  const status = STATUS[job.status] ?? { label: job.status, tone: "neutral" as const };
  const score = asScore(job.score);
  const caption = asScore(job.captionScore) as CaptionScore | null;
  const warnings = asWarnings(job.warnings);

  const makeMp4 = async () => {
    if (busy.current) return;
    busy.current = true;
    setProgress(0);
    let uploaded: string | null = null;
    try {
      setStep("Loading the photos and fonts…");
      const drawing = await loadJobForDrawing(job.id);
      if (!drawing.ok) throw new Error(drawing.error);
      // The voice-over first: the design is stretched to fit its lines. Without it the MP4 is still made.
      let spec = drawing.spec;
      let voice: { url: string; cues: VoiceCue[] } | null = null;
      const notes: string[] = [];
      if (hasLines) {
        setStep("Recording the voice-over…");
        const v = await fetchVoice(job.id);
        if (v.blocked) onBlocked(v.blocked);
        if (v.voice) {
          spec = v.voice.spec;
          voice = { url: v.voice.url, cues: v.voice.cues };
          if (v.credits) onCharged(v.credits);
          notes.push(v.voice.cached ? "Voice-over reused (free)." : `Voice-over: ${v.credits} credits.`);
          if (!v.voice.fits) notes.push("Some voice lines were cut to fit 30 seconds.");
          if (v.voice.note) notes.push(v.voice.note);
        } else if (v.problem) notes.push(v.problem);
        setVoiceNote(notes.join(" ") || null);
      }
      // Loaded only here: the encoder and the drawing code are large and only this button needs them.
      const [{ encodeSpecMp4, loadPhotos, loadSpecFonts }, { drawSpecFrame }] = await Promise.all([import("@/lib/video-engine/encode"), import("@/lib/video-engine/draw")]);
      const [photos] = await Promise.all([loadPhotos(drawing.photoUrls, drawing.cutoutUrls), loadSpecFonts(spec)]);
      setStep("Making the MP4 in this browser…");
      const blob = await encodeSpecMp4(spec, photos, { voice, musicUrl: track?.url ?? null, quality: MP4_QUALITY, bitrate: MP4_BITRATE, onProgress: (f) => setProgress(f) });
      const poster = await posterOf(spec, photos, drawSpecFrame);
      setStep("Saving it to your Gallery…");
      const start = await startJobVideoUpload(job.id, blob.size);
      if (!start.ok) throw new Error(start.error);
      const { target, destination } = start;
      const bucket = createClient().storage.from(GALLERY_VIDEO_BUCKET);
      const { error } = await bucket.uploadToSignedUrl(target.path, target.token, blob, { contentType: "video/mp4" });
      if (error) throw new Error("The video did not upload. Please try again.");
      uploaded = target.path;
      if (target.poster && poster) await bucket.uploadToSignedUrl(target.poster.path, target.poster.token, poster, { contentType: "image/jpeg" }).catch(() => null);
      const size = canvasSize(spec, MP4_QUALITY);
      const done = await finishJobVideoUpload(job.id, { path: target.path, destination, name: `${productName(job.productId ?? "")} - ${templateName}`.slice(0, 120), width: size.width, height: size.height, musicTrackId: track?.id ?? null });
      if (!done.ok) throw new Error(done.error);
      uploaded = null;
      onSaved(done.job);
      toast(`MP4 ready (${(blob.size / 1024 / 1024).toFixed(1)} MB), saved in your Gallery.${notes.length ? ` ${notes.join(" ")}` : ""}`, "success");
    } catch (error) {
      if (uploaded) void discardUpload(uploaded);
      toast(error instanceof Error ? error.message : "The MP4 could not be made. Please try again.", "error");
    } finally {
      busy.current = false;
      setProgress(null);
      setStep("");
    }
  };

  return (
    <GlassCard className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{templateName}</span>
          <span className="text-xs text-muted">
            {[job.platform ? PLATFORM_CHOICES.find((p) => p.id === job.platform)?.label : "Anywhere", job.ratio, `${job.seconds} s`, new Date(job.createdAt).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone })].join(" · ")}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {score && <Badge tone={score.score >= 80 ? "success" : "neutral"}>Research {score.score}/100</Badge>}
          {caption && <Badge tone={caption.score >= 70 ? "success" : "neutral"}>Caption {caption.score}/100</Badge>}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>

      {job.videoUrl && (
        <video src={job.videoUrl} poster={job.posterUrl ?? undefined} controls playsInline loop className="max-h-[480px] w-full rounded-xl bg-black object-contain" />
      )}

      {job.status === "failed" && job.error && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {job.error}
        </p>
      )}

      {job.caption && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Caption</span>
          <p className="whitespace-pre-line text-sm">{job.caption}</p>
          {job.hashtags.length > 0 && <p className="text-sm text-ok">{job.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>}
        </div>
      )}

      {(warnings.length > 0 || (score?.failed.length ?? 0) > 0 || (caption?.missed.length ?? 0) > 0) && (
        <details className="rounded-xl bg-soft p-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            Check before posting ({warnings.length + (score?.failed.length ?? 0) + (caption?.missed.length ?? 0)})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {warnings.map((w, i) => (
              <li key={`w${i}`} className={cn("flex gap-2", w.problem === "not-in-brief" ? "text-danger" : "text-text")}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {w.where}: {w.message}
                </span>
              </li>
            ))}
            {score?.failed.map((f, i) => (
              <li key={`s${i}`} className="text-muted">
                {f.scene ? `Scene ${f.scene}: ` : ""}
                {f.reason}
              </li>
            ))}
            {caption?.missed.map((m, i) => (
              <li key={`c${i}`} className="text-muted">
                Caption: {m}
              </li>
            ))}
          </ul>
        </details>
      )}

      {(job.status === "designed" || job.status === "ready") && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant={job.status === "ready" ? "outline" : "primary"} onClick={makeMp4} disabled={progress !== null} leading={progress !== null ? <Loader2 className="size-4 animate-spin" aria-hidden /> : job.status === "ready" ? <CheckCircle2 className="size-4" aria-hidden /> : <Clapperboard className="size-4" aria-hidden />}>
            {progress !== null ? `${Math.round(progress * 100)}%` : job.status === "ready" ? "Make the MP4 again" : "Make the MP4"}
          </Button>
          {job.videoUrl && (
            <Button size="sm" variant="ghost" href={job.videoUrl} target="_blank" rel="noopener noreferrer" leading={<ExternalLink className="size-4" aria-hidden />}>
              Open the MP4
            </Button>
          )}
          <span className="text-xs text-muted">{step || "Made in this browser: free, about a minute. Use Chrome or Edge."}</span>
        </div>
      )}
      {(job.status === "designed" || job.status === "ready") && tracks.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Music" className="min-w-56 flex-1" hint={track?.attribution ? `Its licence asks for a credit: “${track.attribution}” goes on the posts.` : "Free. Mixed under the voice, quieter while it speaks."}>
            <Select value={musicChoice} onChange={(e) => setMusicChoice(e.target.value)} disabled={progress !== null}>
              <option value="auto">{suggested ? `Matches the design: ${suggested.title}` : "Matches the design"}</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
              <option value="none">No music</option>
            </Select>
          </Field>
          {track && <audio key={track.id} src={track.url} controls preload="none" className="h-10 max-w-full" aria-label={`Listen to ${track.title}`} />}
        </div>
      )}
      {(job.status === "designed" || job.status === "ready") && hasLines && (
        <p className="text-xs text-muted">{voiceNote ?? `With a voice-over: ${voicePrice} video credits the first time, free when made again.`}</p>
      )}
    </GlassCard>
  );
}

/** The poster: a small JPEG of the frame at one second (or a third of the way in). */
async function posterOf(spec: MotionSpec, photos: Photos, draw: typeof import("@/lib/video-engine/draw").drawSpecFrame): Promise<Blob | null> {
  try {
    const { width, height } = canvasSize(spec, "480p");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    draw(ctx, spec, photos, Math.min(1000, totalMs(spec) / 3), { quality: "480p" });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
    return blob && blob.size <= POSTER_MAX_BYTES ? blob : null;
  } catch {
    return null;
  }
}
