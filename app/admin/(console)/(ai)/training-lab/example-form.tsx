"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { NETWORKS, type Network } from "@/lib/social/types";
import { extrasText } from "@/lib/training-lab/language";
import { NETWORK_NAMES, WEEKDAY_NAMES, hoursText, parseScheduleNotes } from "@/lib/training-lab/schedule";
import { DEFAULT_ENGINES, ENGINE_LABELS, ENGINES, KIND_LABELS, KINDS, LANGUAGES, MAX_FILE_BYTES, exampleInputSchema, fileProblem, type TrainingEngine, type TrainingKind } from "@/lib/training-lab/types";
import { confirmExampleFileAction, createExampleAction, startExampleUploadAction, updateExampleAction } from "./actions";

// The private bucket's name (lib/training-lab/storage.ts TRAINING_BUCKET; that file is server-only).
const BUCKET = "training-lab";

/** What the edit form starts from: one TrainingExample row, as the page passes it. */
export type EditableExample = {
  id: string;
  kind: string;
  title: string;
  sourceUrl: string | null;
  howMade: string;
  whatIsGood: string;
  neverThis: string | null;
  tags: string[];
  sector: string | null;
  language: string | null;
  technique: string[];
  rating: number | null;
  consentGiven: boolean;
  consentName: string | null;
  consentNote: string | null;
  /** An actor: how many businesses have it as their reel presenter now (consent.ts presenterUses), for the confirm. */
  presenterUses?: number;
  engines: string[];
  transcript: string | null;
  path: string | null;
  /** A posting habit's notes (its schedule). */
  notes?: unknown;
};

const ACCEPT: Record<TrainingKind, string> = {
  reel: "video/*",
  video: "video/*",
  image: "image/*",
  voice: "audio/*,video/*",
  actor: "image/*,video/*",
  schedule: "image/*",
};

const EXT_TYPES: Record<string, string> = { m4a: "audio/x-m4a", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mov: "video/quicktime", mp4: "video/mp4", heic: "image/heic" };
/** Some phones give no type for .m4a or .heic files: guess it from the name. */
const typeOf = (file: File) => file.type || EXT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";

const list = (v: FormDataEntryValue | null) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const isKind = (v: string): v is TrainingKind => (KINDS as readonly string[]).includes(v);

/**
 * "Add an example" (no `example`) or the edit form of one. The row is saved first; a file then goes straight from the
 * browser to the private bucket with the signed address the server gave, and the server checks it before using it.
 */
/** What the owner is told before and after withdrawing an actor's consent. */
export function withdrawText(uses: number): { confirm: string; done: string } {
  const businesses = `${uses} business${uses === 1 ? "" : "es"}`;
  return uses > 0
    ? { confirm: `This also removes them as the presenter of ${businesses}. Reels already made are not changed.`, done: `Consent withdrawn: removed from ${businesses}' presenters. Reels already made are not changed.` }
    : { confirm: "They stay in the Lab but are never used again. Reels already made are not changed.", done: "Consent withdrawn: this actor stays in the Lab but is never used." };
}

export function ExampleForm({ example, onDone }: { example?: EditableExample; onDone?: (message?: string) => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [kind, setKind] = useState<TrainingKind>(example && isKind(example.kind) ? example.kind : "reel");
  const [engines, setEngines] = useState<TrainingEngine[]>(example ? (example.engines.filter((e) => (ENGINES as readonly string[]).includes(e)) as TrainingEngine[]) : DEFAULT_ENGINES.reel);
  const [consent, setConsent] = useState(example?.consentGiven ?? false);
  const [file, setFile] = useState<File | null>(null);
  const editing = !!example;
  // Unticking an actor's consent asks first (it also removes them as presenters); the second Save goes ahead.
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const withdrawing = editing && example?.kind === "actor" && example.consentGiven && !consent;
  const withdraw = withdrawText(example?.presenterUses ?? 0);
  // A posting habit (kind "schedule"): its fields, and what we read from the hours as the owner types them.
  const saved = example?.kind === "schedule" ? parseScheduleNotes(example.notes) : null;
  const [network, setNetwork] = useState<string>(saved?.network ?? "");
  const [hours, setHours] = useState(saved?.hours ? saved.hours.join(", ") : "");
  const [days, setDays] = useState<number[]>(saved?.weekdays ?? []);
  const spellings = example?.kind === "voice" ? extrasText(example.notes) : { wrong: "", words: "" };
  const readHours = hours.trim() ? parseScheduleNotes({ hours })?.hours : undefined;

  function changeKind(next: string) {
    if (!isKind(next)) return;
    setKind(next);
    setEngines(DEFAULT_ENGINES[next]);
  }

  async function upload(id: string, slot: { path: string; token: string }, f: File): Promise<string | null> {
    setStage("Uploading the file…");
    const { error: failed } = await createClient().storage.from(BUCKET).uploadToSignedUrl(slot.path, slot.token, f, { contentType: typeOf(f) });
    if (failed) return "The example is saved, but the upload did not go through. Open Edit and add the file again.";
    setStage("Checking the file…");
    const confirmed = await confirmExampleFileAction(id, slot.path);
    return confirmed.ok ? null : `The example is saved, but ${confirmed.error.charAt(0).toLowerCase()}${confirmed.error.slice(1)}`;
  }

  // onSubmit rather than a form action: React resets a form after its action runs, which would empty every box
  // when a check fails.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    setError(null);
    setDone(null);
    setFieldErrors({});
    const rating = String(form.get("rating") ?? "");
    const input = {
      kind,
      title: String(form.get("title") ?? ""),
      sourceUrl: String(form.get("sourceUrl") ?? ""),
      howMade: String(form.get("howMade") ?? ""),
      whatIsGood: String(form.get("whatIsGood") ?? ""),
      neverThis: String(form.get("neverThis") ?? ""),
      sector: String(form.get("sector") ?? ""),
      language: String(form.get("language") ?? ""),
      technique: list(form.get("technique")),
      tags: list(form.get("tags")),
      transcript: String(form.get("transcript") ?? ""),
      rating: rating ? Number(rating) : null,
      consentGiven: consent,
      consentName: String(form.get("consentName") ?? ""),
      consentNote: String(form.get("consentNote") ?? ""),
      engines,
      voice: kind === "voice" ? { wrong: String(form.get("wrong") ?? ""), words: String(form.get("words") ?? "") } : null,
      schedule: kind === "schedule" ? { network, country: String(form.get("country") ?? ""), hours, weekdays: days, postsPerWeek: String(form.get("postsPerWeek") ?? ""), formats: list(form.get("formats")) } : null,
    };
    const fileInfo = file ? { name: file.name, type: typeOf(file), size: file.size } : null;
    // The same checks the server makes, so a mistake shows next to its field before anything is sent.
    const parsed = exampleInputSchema.safeParse({ ...input, existing: editing, hasFile: !!fileInfo || !!example?.path });
    if (!parsed.success) {
      const byField: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        byField[key] ??= issue.message;
      }
      setFieldErrors(byField);
      return setError(parsed.error.issues[0]?.message ?? "Check the example and try again.");
    }
    if (fileInfo) {
      const problem = fileProblem(fileInfo, kind);
      if (problem) return setError(problem);
    }
    if (withdrawing && !confirmWithdraw) return setConfirmWithdraw(true);
    start(async () => {
      setStage("Saving…");
      let id: string;
      let slot: { path: string; token: string } | null = null;
      if (example) {
        const saved = await updateExampleAction(example.id, { ...input, hasFile: !!fileInfo });
        if (!saved.ok) {
          setStage(null);
          return setError(saved.error);
        }
        id = example.id;
        if (file) {
          const target = await startExampleUploadAction(id, fileInfo);
          if (!target.ok) {
            setStage(null);
            router.refresh();
            return setError(`Your changes are saved, but ${target.error.charAt(0).toLowerCase()}${target.error.slice(1)}`);
          }
          slot = target;
        }
      } else {
        const saved = await createExampleAction(input, fileInfo);
        if (!saved.ok) {
          setStage(null);
          return setError(saved.error);
        }
        id = saved.id;
        slot = saved.upload;
        if (saved.warning) {
          setStage(null);
          router.refresh();
          return setError(`The example is saved, but ${saved.warning.charAt(0).toLowerCase()}${saved.warning.slice(1)} Open Edit and add the file again.`);
        }
      }
      const uploadError = slot && file ? await upload(id, slot, file) : null;
      setStage(null);
      router.refresh();
      if (uploadError) return setError(uploadError);
      if (editing) return onDone?.(withdrawing ? withdraw.done : undefined);
      formRef.current?.reset();
      setFile(null);
      setConsent(false);
      setKind("reel");
      setNetwork("");
      setHours("");
      setDays([]);
      setEngines(DEFAULT_ENGINES.reel);
      setDone("Example added. It is at the top of the list below.");
    });
  }

  const needsConsent = kind === "actor";
  const idPrefix = example ? `ex-${example.id}-` : "new-";

  return (
    <form ref={formRef} onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Kind</p>
            <p className="text-[15px]">{KIND_LABELS[kind]} <span className="text-[13px] text-muted">(it goes with the file, so it stays)</span></p>
          </div>
        ) : (
          <Field label="Kind" required error={fieldErrors.kind}>
            <Select name="kind" value={kind} onChange={(e) => changeKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Title" required error={fieldErrors.title}>
          <Input name="title" maxLength={120} defaultValue={example?.title} placeholder="Kigali car seller, 3 cuts a second" />
        </Field>
        <Field
          label={editing && example?.path ? "Replace the file" : "File"}
          hint={`${kind === "voice" ? "A recording" : kind === "image" || kind === "schedule" ? "A photo or screenshot" : kind === "actor" ? "A photo or a video" : "A video"}, at most ${MAX_FILE_BYTES / 1024 / 1024} MB (50 MB on the free Storage plan). Or give a link below.`}
        >
          <Input type="file" accept={ACCEPT[kind]} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Link" hint="A TikTok, Instagram, YouTube or other link, when there is no file." error={fieldErrors.sourceUrl}>
          <Input name="sourceUrl" type="url" inputMode="url" maxLength={2000} defaultValue={example?.sourceUrl ?? ""} placeholder="https://" />
        </Field>
      </div>

      {kind === "schedule" && (
        <fieldset className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line p-4">
          <legend className="px-1 text-sm font-medium">When to post</legend>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Network">
              <Select name="network" value={network} onChange={(e) => setNetwork(e.target.value)}>
                <option value="">All networks</option>
                {NETWORKS.map((n: Network) => (
                  <option key={n} value={n}>{NETWORK_NAMES[n]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Country" hint="Where the customers are.">
              <Input name="country" maxLength={60} defaultValue={saved?.country ?? (editing ? "" : "Rwanda")} />
            </Field>
            <Field label="Best hours" hint="Local time, for example: 7, 12:30, 19h. The planner only uses the times the business allowed.">
              <Input name="hours" inputMode="text" maxLength={200} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="7, 12:30, 19h" />
              {hours.trim() && (
                <p role="status" className={`mt-1 text-[13px] ${readHours ? "text-muted" : "font-medium text-danger"}`}>
                  {readHours ? `We read: ${hoursText(readHours)}` : "We could not read that. Write the hours like 7, 12:30, 19h."}
                </p>
              )}
            </Field>
            <Field label="Posts per week" hint="Optional. Only shown on the Team page; the business's own settings decide how often it posts.">
              <Input name="postsPerWeek" type="number" inputMode="numeric" min={1} max={21} defaultValue={saved?.postsPerWeek ?? ""} />
            </Field>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-sm font-medium">Best days</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {WEEKDAY_NAMES.map((name, i) => (
                <label key={name} className="flex min-h-11 items-center gap-2 text-[14px]">
                  <input type="checkbox" className="size-5" checked={days.includes(i)} onChange={(ev) => setDays((cur) => (ev.target.checked ? [...cur, i].sort() : cur.filter((d) => d !== i)))} />
                  {name}
                </label>
              ))}
            </div>
          </div>
          <Field label="Formats" hint="Optional, separate with commas: reel, photo, carousel.">
            <Input name="formats" maxLength={200} defaultValue={saved?.formats?.join(", ") ?? ""} />
          </Field>
          {fieldErrors.schedule && <p role="alert" className="text-[13px] font-medium text-danger">{fieldErrors.schedule}</p>}
        </fieldset>
      )}

      <Field label={kind === "schedule" ? "Where this comes from" : "How it was made"} hint={kind === "schedule" ? "For example: what the owner saw on Facebook Insights, or a client's habit." : "In your own words: who filmed it, with what, the shots, the edit, the music."} required error={fieldErrors.howMade}>
        <Textarea name="howMade" rows={4} maxLength={5000} defaultValue={example?.howMade} />
      </Field>
      <Field label={kind === "schedule" ? "Why these times" : "What is good about it"} hint={kind === "schedule" ? "What the engines should know: who is online then, what worked." : "What the engines should learn from it: the hook, the pace, the words, the look."} required error={fieldErrors.whatIsGood}>
        <Textarea name="whatIsGood" rows={3} maxLength={5000} defaultValue={example?.whatIsGood} />
      </Field>
      <Field label="Never this" hint="What the engines must never copy from it (optional)." error={fieldErrors.neverThis}>
        <Textarea name="neverThis" rows={2} maxLength={5000} defaultValue={example?.neverThis ?? ""} />
      </Field>
      {kind === "voice" && (
        <Field label="What is said" hint="The words in the recording, spelled the way they should be written." required error={fieldErrors.transcript}>
          <Textarea name="transcript" rows={4} maxLength={10000} defaultValue={example?.transcript ?? ""} />
        </Field>
      )}
      {kind === "voice" && (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Spellings to avoid" hint={'One per line: "wrong -> right", or just the wrong one. The check will flag them.'} error={fieldErrors.voice}>
            <Textarea name="wrong" rows={3} maxLength={10000} defaultValue={spellings.wrong} placeholder={"igiciro -> igiciro:\nmurakoze cyane"} />
          </Field>
          <Field label="Words that are right" hint="Separate with commas: brand names, or Kinyarwanda words the check wrongly flags.">
            <Textarea name="words" rows={3} maxLength={10000} defaultValue={spellings.words} />
          </Field>
        </div>
      )}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Sector" hint="For example: cars, farming, beauty, restaurants." error={fieldErrors.sector}>
          <Input name="sector" maxLength={40} defaultValue={example?.sector ?? ""} />
        </Field>
        <Field label="Language" error={fieldErrors.language}>
          <Input name="language" maxLength={40} list={`${idPrefix}languages`} defaultValue={example?.language ?? ""} />
        </Field>
        <Field label="Techniques" hint="Separate with commas: beat sync, hook in 1 second, 3D sticker." error={fieldErrors.technique}>
          <Input name="technique" defaultValue={example?.technique.join(", ")} />
        </Field>
        <Field label="Tags" hint="Separate with commas." error={fieldErrors.tags}>
          <Input name="tags" defaultValue={example?.tags.join(", ")} />
        </Field>
        <Field label="Rating" error={fieldErrors.rating}>
          <Select name="rating" defaultValue={example?.rating ? String(example.rating) : ""}>
            <option value="">Not rated</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{"★".repeat(n)} ({n} of 5)</option>
            ))}
          </Select>
        </Field>
      </div>
      <datalist id={`${idPrefix}languages`}>
        {LANGUAGES.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 text-sm font-medium">People in it{needsConsent && <span aria-hidden className="ml-0.5 text-pulse-violet">*</span>}</legend>
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={consent} onChange={(e) => { setConsent(e.target.checked); setConfirmWithdraw(false); }} />
          <span>{needsConsent ? "This person agreed to be used as a presenter or actor." : "There are people in it, and they agreed to it being used."}</span>
        </label>
        {fieldErrors.consentGiven && <p role="alert" className="text-[13px] font-medium text-danger">{fieldErrors.consentGiven}</p>}
        {withdrawing && (
          <p role={confirmWithdraw ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-[13px] ${confirmWithdraw ? "bg-danger-bg font-medium text-danger" : "bg-soft text-muted"}`}>
            Withdrawing consent. {withdraw.confirm}
            {confirmWithdraw && " Press the button again to confirm."}
          </p>
        )}
        {consent && (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Their name" required error={fieldErrors.consentName}>
              <Input name="consentName" maxLength={120} defaultValue={example?.consentName ?? ""} />
            </Field>
            <Field label="How they agreed" hint="Where and when, for example: in writing on WhatsApp, 20 October." error={fieldErrors.consentNote}>
              <Input name="consentNote" maxLength={5000} defaultValue={example?.consentNote ?? ""} />
            </Field>
          </div>
        )}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Which engines learn from it</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ENGINES.map((e) => (
            <label key={e} className="flex min-h-11 items-center gap-2 text-[14px]">
              <input type="checkbox" className="size-5" checked={engines.includes(e)} onChange={(ev) => setEngines((cur) => (ev.target.checked ? [...cur, e] : cur.filter((x) => x !== e)))} />
              {ENGINE_LABELS[e]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending}>{pending ? (stage ?? "Working…") : withdrawing && confirmWithdraw ? "Withdraw consent and save" : editing ? "Save changes" : "Add the example"}</Button>
        {editing && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => onDone?.()}>Cancel</Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      {pending && stage && <p role="status" className="text-sm text-muted">{stage}</p>}
      {done && <p role="status" className="text-sm font-medium text-success">{done}</p>}
    </form>
  );
}

/** The Edit button of one example, opening its form in place. */
export function EditExample({ example }: { example: EditableExample }) {
  const [open, setOpen] = useState(false);
  // What the last save said (an actor's consent withdrawn), shown beside the Edit button once the form closes.
  const [note, setNote] = useState<string | null>(null);
  if (!open) {
    return (
      <>
        <Button type="button" size="sm" variant="outline" onClick={() => { setNote(null); setOpen(true); }}>Edit</Button>
        {note && <p role="status" className="w-full basis-full text-sm font-medium text-success">{note}</p>}
      </>
    );
  }
  return (
    <div className="w-full basis-full rounded-2xl border border-line p-4">
      <ExampleForm example={example} onDone={(message) => { setOpen(false); setNote(message ?? null); }} />
    </div>
  );
}
