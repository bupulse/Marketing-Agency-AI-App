"use client";

import { Check, Copy, LoaderCircle, Sparkles, ThumbsDown, ThumbsUp, Wand2 } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Chip, GlassCard, Input, Textarea, useToast } from "@/components/ui";
import { editPictureAction, paintImageStep, ratePictureAction, startImageBatch, type PictureView } from "@/app/dashboard/designs/engine-actions";
import { chooseTiers, creditsOf, type Quality } from "@/lib/image-engine/director";
import { patternById } from "@/lib/image-engine/patterns";
import { cn } from "@/lib/cn";

const COUNTS = [4, 10, 20] as const;
const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: "auto", label: "Smart mix", hint: "The best ideas on Pro, the rest on Lite" },
  { value: "pro", label: "Best (Pro)", hint: "Every picture on Nano Banana Pro, 4 credits each" },
  { value: "lite", label: "Saver (Lite)", hint: "Every picture on Nano Banana, 1 credit each" },
];
const SHAPES = [
  { value: "4:5", label: "Feed (4:5)" },
  { value: "1:1", label: "Square" },
  { value: "9:16", label: "Story (9:16)" },
] as const;
/** Pictures painted at the same time. */
const PARALLEL = 2;

/**
 * "Unique AI ads" (docs/IMAGE_ENGINE.md): the image engine's team of agents makes 4, 10 or 20 finished adverts, each a
 * different idea with its own words and caption, never repeating what the company had before.
 */
export function UniqueAds({ subjectId, subjectName, credits }: { subjectId: string | null; subjectName: string | null; credits: { used: number; limit: number } }) {
  const { toast } = useToast();
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState<(typeof COUNTS)[number]>(4);
  const [quality, setQuality] = useState<Quality>("auto");
  const [shape, setShape] = useState<(typeof SHAPES)[number]["value"]>("4:5");
  const [pictures, setPictures] = useState<PictureView[]>([]);
  const [busy, setBusy] = useState<"planning" | "painting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(Math.max(0, credits.limit - credits.used));
  const run = useRef(0);

  const tiers = chooseTiers(count, left, quality);
  const cost = creditsOf(tiers);
  const pro = tiers.filter((t) => t === "pro").length;

  async function start() {
    setError(null);
    setBusy("planning");
    const res = await startImageBatch({ subjectId, brief, count, quality, aspectRatio: shape });
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    setLeft((l) => Math.max(0, l - res.credits));
    setBusy("painting");
    const mine = ++run.current;
    let more = true;
    // A few painters work at once; each call paints one picture and returns the whole batch.
    const worker = async () => {
      while (more && run.current === mine) {
        const step = await paintImageStep(res.batchId);
        if (run.current !== mine) return;
        if (!step.ok) {
          setError(step.error);
          more = false;
          return;
        }
        setPictures(step.pictures);
        more = step.left;
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (run.current === mine) setBusy(null);
  }

  const done = pictures.filter((p) => p.status === "done").length;
  return (
    <GlassCard as="section" aria-labelledby="unique-ads" padding="lg" className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow">
          <Sparkles className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="unique-ads" className="text-xl font-semibold tracking-[-0.02em]">
            Unique AI ads{subjectName ? ` for ${subjectName}` : ""}
          </h2>
          <p className="text-[15px] text-muted">A team of AI agents plans a different idea for every picture, paints the finished ad with its words, and checks it. Never the same picture twice.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="ads-brief" className="text-[15px] font-semibold">
          Your idea <span className="font-normal text-muted">(optional)</span>
        </label>
        <Textarea id="ads-brief" rows={3} maxLength={800} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="For example: show how it improves a farmer's harvest, a happy farmer in a greenhouse, and new designs at large scale" disabled={!!busy} />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-8">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[15px] font-semibold">How many</legend>
          <div className="flex flex-wrap gap-2">
            {COUNTS.map((c) => (
              <Chip key={c} selected={count === c} onClick={() => setCount(c)} disabled={!!busy}>
                {c}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[15px] font-semibold">Shape</legend>
          <div className="flex flex-wrap gap-2">
            {SHAPES.map((s) => (
              <Chip key={s.value} selected={shape === s.value} onClick={() => setShape(s.value)} disabled={!!busy}>
                {s.label}
              </Chip>
            ))}
          </div>
        </fieldset>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[15px] font-semibold">Quality</legend>
        <div className="flex flex-wrap gap-2">
          {QUALITIES.map((q) => (
            <Chip key={q.value} selected={quality === q.value} onClick={() => setQuality(q.value)} disabled={!!busy} title={q.hint}>
              {q.label}
            </Chip>
          ))}
        </div>
        <p className="text-[13px] text-muted">{QUALITIES.find((q) => q.value === quality)!.hint}.</p>
      </fieldset>

      <div className="flex flex-col gap-3 rounded-2xl bg-soft p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px]">
          {tiers.length === 0 ? (
            "You have no AI image credits left this month."
          ) : (
            <>
              <span className="font-semibold">{tiers.length} pictures</span> ({pro} Pro, {tiers.length - pro} Lite) use <span className="font-semibold">{cost} credits</span>. You have {left} left.
              {tiers.length < count ? " Fewer than asked: that is what your credits allow." : ""}
            </>
          )}
        </p>
        <Button onClick={start} disabled={!!busy || tiers.length === 0} trailing={busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Wand2 aria-hidden className="size-4" />}>
          {busy === "planning" ? "Planning ideas…" : busy === "painting" ? `Painting ${done} of ${pictures.length}…` : "Make my ads"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[14px] font-medium text-danger">
          {error}
        </p>
      )}

      {pictures.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pictures.map((p) => (
            <PictureCard key={p.id} picture={p} onChange={(next) => setPictures((all) => all.map((x) => (x.id === next.id ? next : x)))} onToast={toast} />
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

function PictureCard({ picture: p, onChange, onToast }: { picture: PictureView; onChange: (p: PictureView) => void; onToast: ReturnType<typeof useToast>["toast"] }) {
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const label = patternById(p.pattern)?.label ?? p.pattern;

  async function rate(r: 1 | -1) {
    const next = p.rating === r ? null : r;
    onChange({ ...p, rating: next });
    await ratePictureAction(p.id, next);
  }
  async function change() {
    setSaving(true);
    const res = await editPictureAction(p.id, instruction);
    setSaving(false);
    if (!res.ok) return onToast(res.error, "error");
    onChange(res.picture);
    setEditing(false);
    setInstruction("");
    onToast("Changed. The new picture is saved in your designs.", "success");
  }
  async function copy() {
    if (!p.caption) return;
    try {
      await navigator.clipboard.writeText(p.caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onToast("Copy did not work. Select the caption and copy it.", "error");
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-3">
      <div className={cn("relative overflow-hidden rounded-2xl bg-soft", p.status === "done" ? "" : "aspect-[4/5]")}>
        {p.status === "done" && p.url ? (
          // A signed Supabase URL: plain img.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.url} alt={p.headline} className="h-auto w-full" />
        ) : p.status === "failed" ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[14px] text-muted">{p.error ?? "This picture could not be made. Its credits were given back."}</div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[14px] text-muted">
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
            {p.status === "painting" ? "Painting and checking…" : "Waiting for its turn…"}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="violet">{label}</Badge>
        <Badge tone={p.tier === "pro" ? "blue" : "neutral"}>{p.tier === "pro" ? "Pro" : "Lite"} · {p.credits} credit{p.credits === 1 ? "" : "s"}</Badge>
        {p.fixed && <Badge tone="success">Checked and fixed</Badge>}
        {p.problems.length > 0 && <Badge tone="danger">Check the words</Badge>}
      </div>
      <p className="text-[15px] font-semibold leading-snug">{p.title}</p>
      {p.caption && <p className="line-clamp-4 whitespace-pre-line text-[13px] text-muted">{p.caption}</p>}
      {p.status === "done" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => rate(1)} aria-pressed={p.rating === 1} aria-label="Like">
            <ThumbsUp aria-hidden className={cn("size-4", p.rating === 1 && "text-success")} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => rate(-1)} aria-pressed={p.rating === -1} aria-label="Dislike">
            <ThumbsDown aria-hidden className={cn("size-4", p.rating === -1 && "text-danger")} />
          </Button>
          {p.caption && (
            <Button size="sm" variant="outline" onClick={copy} leading={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
              {copied ? "Copied" : "Copy caption"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)} leading={<Wand2 aria-hidden className="size-4" />}>
            Change this
          </Button>
        </div>
      )}
      {editing && (
        <div className="flex flex-col gap-2">
          <Input value={instruction} maxLength={400} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. make the headline bigger, add more people" aria-label="What to change" />
          <Button size="sm" onClick={change} disabled={saving || instruction.trim().length < 3}>
            {saving ? "Changing…" : `Change it (${p.credits} credit${p.credits === 1 ? "" : "s"})`}
          </Button>
        </div>
      )}
    </li>
  );
}
