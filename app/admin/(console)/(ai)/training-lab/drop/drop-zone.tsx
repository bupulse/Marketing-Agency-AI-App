"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { NETWORKS, type Network } from "@/lib/social/types";
import { NETWORK_NAMES, WEEKDAY_NAMES } from "@/lib/training-lab/schedule";
import { DEFAULT_ENGINES, ENGINE_LABELS, ENGINES, KIND_LABELS, LANGUAGES, MAX_FILE_BYTES, exampleInputSchema, fileProblem, type TrainingEngine, type TrainingKind } from "@/lib/training-lab/types";
import type { DraftFields } from "@/lib/training-lab/analyse";
import type { LabNotes } from "@/lib/training-lab/examples";
import { discardDraftAction, readDraftAction, saveDraftAction, startDraftAction } from "./actions";
import { familyOf, kindFromMime, kindsFor, peopleSeen, typeOf } from "./kinds";

// Drop, read, check (docs/TRAINING_LAB.md, board task 26): one drop box at the top of the Library. The file goes
// straight from the browser into a private draft folder, the AI reads it (when its budget allows) and fills the form,
// and the owner checks one card and saves. The kind comes from the file; chips change it without retyping.

const BUCKET = "training-lab"; // lib/training-lab/storage.ts TRAINING_BUCKET (that file is server-only)
const READ_STEPS = ["Uploaded", "Watching it closely", "Writing the notes", "Filling in the form"];
const EMPTY: DraftFields = { title: "", howMade: "", whatIsGood: "", techniques: [], sector: "", language: "", transcript: "" };
const READING: Partial<Record<TrainingKind, string>> = { reel: "Reading your reel…", video: "Reading your video…", image: "Reading your picture…", voice: "Listening to your recording…", actor: "Looking at your actor…" };

type Stage = { name: "idle" } | { name: "uploading"; pct: number } | { name: "reading"; step: number } | { name: "check" } | { name: "saving" } | { name: "saved"; message: string };

/** The file into its draft folder with a progress bar (a signed upload address); the Storage client when that fails. */
function upload(slot: { path: string; token: string; signedUrl: string }, file: File, onPct: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", slot.signedUrl);
    xhr.setRequestHeader("x-upsert", "true");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (key) xhr.setRequestHeader("apikey", key);
    xhr.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    const fallback = () =>
      createClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type, upsert: true })
        .then(({ error }) => (error ? reject(error) : resolve()), reject);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : fallback());
    xhr.onerror = fallback;
    xhr.send(body);
  });
}

export function DropZone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  // The example being checked.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [kind, setKind] = useState<TrainingKind>("reel");
  const [fields, setFields] = useState<DraftFields>(EMPTY);
  const [notes, setNotes] = useState<LabNotes | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [never, setNever] = useState("");
  const [engines, setEngines] = useState<TrainingEngine[]>(DEFAULT_ENGINES.reel);
  const [consent, setConsent] = useState({ given: false, name: "", note: "" });
  const [technique, setTechnique] = useState("");
  const [schedule, setSchedule] = useState<{ network: Network | ""; hours: string; days: number[]; perWeek: string }>({ network: "", hours: "", days: [], perWeek: "" });

  // The "Reading…" steps move on while the AI works (one call; the steps are what it does, shown in turn).
  useEffect(() => {
    if (stage.name !== "reading") return;
    const t = setTimeout(() => setStage((s) => (s.name === "reading" ? { name: "reading", step: Math.min(READ_STEPS.length - 1, s.step + 1) } : s)), 3500);
    return () => clearTimeout(t);
  }, [stage]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  function reset() {
    setStage({ name: "idle" });
    setError(null);
    setLink("");
    setFile(null);
    setPreview(null);
    setDraft(null);
    setSource(null);
    setFields(EMPTY);
    setNotes(null);
    setAiNote(null);
    setRating(null);
    setNever("");
    setConsent({ given: false, name: "", note: "" });
    setTechnique("");
    setSchedule({ network: "", hours: "", days: [], perWeek: "" });
    if (input.current) input.current.value = "";
  }

  function chooseKind(next: TrainingKind) {
    setKind(next);
    setEngines(DEFAULT_ENGINES[next]);
  }

  async function take(picked: File) {
    setError(null);
    const mime = typeOf(picked);
    const first = kindFromMime(mime);
    if (!first) return setError(`${picked.name} is not a video, a photo or a sound file.`);
    const named = mime === picked.type ? picked : new File([picked], picked.name, { type: mime });
    const problem = fileProblem({ name: named.name, type: mime, size: named.size }, first);
    if (problem) return setError(problem);
    setFile(named);
    setPreview(URL.createObjectURL(named));
    chooseKind(first);
    setStage({ name: "uploading", pct: 0 });
    const slot = await startDraftAction({ name: named.name, type: mime, size: named.size }, first);
    if (!slot.ok) {
      setStage({ name: "idle" });
      return setError(slot.error);
    }
    try {
      await upload(slot, named, (pct) => setStage({ name: "uploading", pct }));
    } catch {
      setStage({ name: "idle" });
      return setError("The upload did not go through. Check the connection and drop it again.");
    }
    setDraft(slot.path);
    setStage({ name: "reading", step: 1 });
    const read = await readDraftAction(slot.path, first);
    if (read.ok) {
      setFields(read.fields);
      setNotes(read.notes);
    } else setAiNote(read.error);
    setStage({ name: "check" });
  }

  function takeLink() {
    const url = link.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return setError("Paste a full link starting with https://");
    setError(null);
    setSource(url);
    chooseKind("reel");
    setAiNote("The AI can't watch a link (TikTok, Instagram and others keep the video to themselves). Fill in what you know: it takes a minute.");
    setStage({ name: "check" });
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setHover(false);
    const picked = e.dataTransfer.files?.[0];
    if (picked) void take(picked);
  }

  async function discard() {
    if (draft) await discardDraftAction(draft);
    reset();
  }

  async function save() {
    setError(null);
    const value = {
      kind,
      title: fields.title,
      sourceUrl: source ?? "",
      howMade: fields.howMade,
      whatIsGood: fields.whatIsGood,
      neverThis: never,
      sector: fields.sector,
      language: fields.language,
      technique: fields.techniques,
      tags: [],
      transcript: kind === "voice" ? fields.transcript : "",
      rating,
      consentGiven: consent.given,
      consentName: consent.given ? consent.name : "",
      consentNote: consent.given ? consent.note : "",
      engines,
      notes,
      schedule: kind === "schedule" ? { network: schedule.network, country: "", hours: schedule.hours, weekdays: schedule.days, postsPerWeek: schedule.perWeek, formats: [] } : null,
      voice: null,
    };
    const parsed = exampleInputSchema.safeParse({ ...value, hasFile: !!draft });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the example and try again.");
    setStage({ name: "saving" });
    const saved = await saveDraftAction(draft, value);
    if (!saved.ok) {
      setStage({ name: "check" });
      return setError(saved.error);
    }
    setStage({ name: "saved", message: saved.message });
    router.refresh();
  }

  if (stage.name === "idle" || stage.name === "uploading") {
    const busy = stage.name === "uploading";
    return (
      <section aria-label="Add an example" className="flex min-w-0 flex-col gap-3">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={onDrop}
          className={`flex min-h-48 min-w-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors ${hover ? "border-pulse-violet bg-soft" : "border-line hover:bg-soft"} ${busy ? "pointer-events-none" : ""}`}
        >
          <input ref={input} type="file" accept="video/*,image/*,audio/*" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && void take(e.target.files[0])} />
          <span className="text-lg font-semibold">{busy ? "Uploading…" : "Drop a reel, video, photo or voice note here"}</span>
          <span className="text-[14px] text-muted">{busy ? file?.name : `or tap to choose one (up to ${MAX_FILE_BYTES / 1024 / 1024} MB). The AI reads it and fills in the form for you.`}</span>
          {busy && (
            <span className="mt-2 w-full max-w-sm" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stage.pct} aria-label="Upload progress">
              <span className="block h-2 overflow-hidden rounded-full bg-soft">
                <span className="block h-full rounded-full bg-brand-gradient transition-[width]" style={{ width: `${stage.pct}%` }} />
              </span>
              <span className="mt-1 block text-[13px] text-muted">{stage.pct}%</span>
            </span>
          )}
        </label>
        {!busy && (
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input value={link} onChange={(e) => setLink(e.target.value)} type="url" inputMode="url" placeholder="or paste a link (TikTok, Instagram, YouTube…)" aria-label="Link to an example" className="min-w-0 flex-1" />
            <Button type="button" variant="outline" onClick={takeLink} disabled={!link.trim()}>Use this link</Button>
          </div>
        )}
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      </section>
    );
  }

  if (stage.name === "reading") {
    return (
      <section aria-label="Reading the example" className="flex min-w-0 flex-col items-center gap-4 rounded-3xl border border-line px-6 py-10 text-center">
        <p className="text-lg font-semibold" role="status">{READING[kind] ?? "Reading it…"}</p>
        <ol className="flex flex-col gap-1.5 text-left text-[15px]">
          {READ_STEPS.map((s, i) => (
            <li key={s} className={i < stage.step ? "text-success" : i === stage.step ? "font-medium" : "text-muted"}>
              {i < stage.step ? "✓" : i === stage.step ? "…" : "·"} {s}
            </li>
          ))}
        </ol>
        <p className="text-[13px] text-muted">This takes up to a minute.</p>
      </section>
    );
  }

  if (stage.name === "saved") {
    return (
      <section aria-label="Saved" className="flex min-w-0 flex-col items-center gap-3 rounded-3xl border border-line px-6 py-8 text-center">
        <p role="status" className="text-lg font-semibold text-success">{stage.message}</p>
        <Button type="button" onClick={reset}>Add another</Button>
      </section>
    );
  }

  // Check: one card, the preview beside the AI's suggestions.
  const mime = file ? file.type : null;
  const showConsent = kind === "actor" || peopleSeen(notes);
  const set = (k: keyof DraftFields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));
  const saving = stage.name === "saving";
  return (
    <section aria-label="Check the example" className="grid min-w-0 gap-5 rounded-3xl border border-line p-4 sm:p-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <Preview file={file} url={preview} link={source} />
        {notes && <AiSaw notes={notes} />}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {aiNote ? <p className="rounded-xl bg-soft px-3 py-2 text-[14px] text-muted">{aiNote}</p> : <p className="rounded-xl bg-success-bg px-3 py-2 text-[14px] text-success">The AI filled this in. Check it and change anything it got wrong.</p>}
        <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="What it is">
          {kindsFor(mime).map((k) => (
            <Chip key={k} selected={kind === k} onClick={() => chooseKind(k)}>{KIND_LABELS[k]}</Chip>
          ))}
        </div>
        <Field label="Title" required>
          <Input value={fields.title} onChange={(e) => set("title")(e.target.value)} maxLength={120} placeholder="Kigali car seller, quick cuts" />
        </Field>
        <Field label="How it was made" hint="In plain words: who filmed it, with what, the shots and the edit." required>
          <Textarea value={fields.howMade} onChange={(e) => set("howMade")(e.target.value)} rows={3} maxLength={5000} />
        </Field>
        <Field label="What is good about it" hint="What the engines should learn from it." required>
          <Textarea value={fields.whatIsGood} onChange={(e) => set("whatIsGood")(e.target.value)} rows={2} maxLength={5000} />
        </Field>
        {kind === "voice" && (
          <Field label="What is said" hint="Word for word, spelled the way it should be written." required>
            <Textarea value={fields.transcript} onChange={(e) => set("transcript")(e.target.value)} rows={3} maxLength={10000} />
          </Field>
        )}
        {kind === "schedule" && <ScheduleFields value={schedule} onChange={setSchedule} />}
        <Techniques list={fields.techniques} draft={technique} setDraft={setTechnique} onChange={(techniques) => setFields((f) => ({ ...f, techniques }))} />
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Kind of business" hint="For example: restaurant, salon, agriculture.">
            <Input value={fields.sector} onChange={(e) => set("sector")(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Language">
            <Select value={fields.language} onChange={(e) => set("language")(e.target.value)}>
              <option value="">Not sure</option>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Stars value={rating} onChange={setRating} />
        <Field label="Never copy this" hint="Optional: what the engines must never do from it.">
          <Textarea value={never} onChange={(e) => setNever(e.target.value)} rows={2} maxLength={5000} />
        </Field>
        <Group label="Which engines learn from it">
          {ENGINES.map((e) => (
            <Chip key={e} selected={engines.includes(e)} onClick={() => setEngines((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]))}>{ENGINE_LABELS[e]}</Chip>
          ))}
        </Group>
        {showConsent && (
          <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
            <legend className="px-1 text-sm font-medium">{kind === "actor" ? "The actor's consent" : "People are seen in it"}</legend>
            <label className="flex min-h-11 items-start gap-2 text-[14px]">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={consent.given} onChange={(e) => setConsent((c) => ({ ...c, given: e.target.checked }))} />
              <span>{kind === "actor" ? "This person agreed to be used as a presenter or actor." : "They agreed to it being used."}</span>
            </label>
            {consent.given && (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <Field label="Their name" required>
                  <Input value={consent.name} onChange={(e) => setConsent((c) => ({ ...c, name: e.target.value }))} maxLength={120} />
                </Field>
                <Field label="How they agreed" hint="For example: in writing on WhatsApp, 20 October.">
                  <Input value={consent.note} onChange={(e) => setConsent((c) => ({ ...c, note: e.target.value }))} maxLength={5000} />
                </Field>
              </div>
            )}
          </fieldset>
        )}
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save to the Lab"}</Button>
          <Button type="button" variant="outline" onClick={discard} disabled={saving}>Discard</Button>
        </div>
      </div>
    </section>
  );
}

function Preview({ file, url, link }: { file: File | null; url: string | null; link: string | null }) {
  if (link) return <p className="break-all rounded-2xl bg-soft p-4 text-[14px]">{link}</p>;
  if (!file || !url) return null;
  const family = familyOf(file.type);
  // eslint-disable-next-line @next/next/no-img-element -- a local preview of the file just dropped
  if (family === "image") return <img src={url} alt="The example" className="max-h-96 w-full rounded-2xl object-contain" />;
  if (family === "video") return <video src={url} controls playsInline className="max-h-[28rem] w-full rounded-2xl bg-black" />;
  if (family === "audio") return <audio src={url} controls className="w-full" />;
  return null;
}

/** What the AI saw (the notes it drafted), read-only and folded: saved with the example, correctable later. */
function AiSaw({ notes }: { notes: LabNotes }) {
  const rows = Object.entries(notes).filter(([, v]) => v && v.toLowerCase() !== "none");
  if (!rows.length) return null;
  return (
    <details className="min-w-0 rounded-2xl border border-line px-4 py-1 text-[14px]">
      <summary className="min-h-11 cursor-pointer py-2.5 font-medium">What the AI saw</summary>
      <dl className="flex flex-col gap-1.5 pb-3">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[13px] text-muted">{k.replace(/_/g, " ")}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex min-w-0 flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Techniques({ list, draft, setDraft, onChange }: { list: string[]; draft: string; setDraft: (v: string) => void; onChange: (list: string[]) => void }) {
  const add = () => {
    const t = draft.trim().toLowerCase();
    if (t && !list.includes(t)) onChange([...list, t].slice(0, 30));
    setDraft("");
  };
  return (
    <Group label="Techniques">
      {list.map((t) => (
        <Chip key={t} selected onClick={() => onChange(list.filter((x) => x !== t))} aria-label={`Remove ${t}`}>{t} ×</Chip>
      ))}
      <div className="flex min-w-0 gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="Add one" aria-label="Add a technique" maxLength={40} className="w-40" />
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={!draft.trim()}>Add</Button>
      </div>
    </Group>
  );
}

function Stars({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Group label="How good is it?">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-label={`${n} of 5`} aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)} className={`flex size-12 items-center justify-center rounded-full text-3xl hover:bg-soft ${value && n <= value ? "text-amber-500" : "text-muted"}`}>
          {value && n <= value ? "★" : "☆"}
        </button>
      ))}
    </Group>
  );
}

function ScheduleFields({ value, onChange }: { value: { network: Network | ""; hours: string; days: number[]; perWeek: string }; onChange: (v: { network: Network | ""; hours: string; days: number[]; perWeek: string }) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Network">
          <Select value={value.network} onChange={(e) => onChange({ ...value, network: e.target.value as Network | "" })}>
            <option value="">Every network</option>
            {NETWORKS.map((n) => (
              <option key={n} value={n}>{NETWORK_NAMES[n]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Best hours" hint="For example: 7, 12:30, 19h.">
          <Input value={value.hours} onChange={(e) => onChange({ ...value, hours: e.target.value })} maxLength={200} />
        </Field>
      </div>
      <Group label="Best days">
        {WEEKDAY_NAMES.map((d, i) => (
          <Chip key={d} selected={value.days.includes(i)} onClick={() => onChange({ ...value, days: value.days.includes(i) ? value.days.filter((x) => x !== i) : [...value.days, i].sort() })}>{d}</Chip>
        ))}
      </Group>
      <Field label="Posts a week" hint="Optional, 1 to 21.">
        <Input value={value.perWeek} onChange={(e) => onChange({ ...value, perWeek: e.target.value })} inputMode="numeric" maxLength={2} />
      </Field>
    </div>
  );
}
