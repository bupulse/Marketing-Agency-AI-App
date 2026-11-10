import { BookOpen, Plus, SlidersHorizontal, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { ExpandCard, FilterChips, PageHeader } from "@/components/admin/kit";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { analysisStatus, exampleProblem, type AnalysisStatus } from "@/lib/training-lab/analyse";
import { filterChoices, LIST_MAX, listExamples, NOTE_FIELDS, NOTE_LABELS, parseFilter, previewLinks, readNotes, type ExampleFilter } from "@/lib/training-lab/examples";
import { ENGINE_LABELS, ENGINES, KIND_LABELS, type TrainingKind } from "@/lib/training-lab/types";
import { deleteExampleAction, draftNotesAction, rateExampleAction, saveNotesAction, setEngineAction } from "./actions";
import { finishedReels, type FinishedReel } from "@/lib/training-lab/from-result";
import { presenterUses } from "@/lib/training-lab/consent";
import { healthRows, labHealth } from "@/lib/training-lab/health";
import { describeExtras } from "@/lib/training-lab/language";
import { exampleUsage, usageLine, type ExampleUse } from "@/lib/training-lab/usage";
import { describeSchedule } from "@/lib/training-lab/schedule";
import { galleryItem, KIND_CHIPS } from "@/lib/training-lab/gallery";
import { EditExample } from "./example-form";
import { LabHubCards } from "./hub-cards";
import { Gallery } from "./gallery";
import { PortraitFromVideo } from "./portrait-from-video";

export const metadata = { title: "Training Lab" };
export const dynamic = "force-dynamic";

const BASE = "/admin/training-lab";
type Example = Awaited<ReturnType<typeof listExamples>>[number];

const kindLabel = (k: string) => KIND_LABELS[k as TrainingKind] ?? k;
const mb = (bytes: number | null) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "");
const query = (f: ExampleFilter) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as [string, string][]).toString();
  return qs ? `${BASE}?${qs}` : BASE;
};

export default async function TrainingLabPage({ searchParams }: PageProps<"/admin/training-lab">) {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only (lib/training-lab/examples.ts); anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  const sp = await searchParams;
  const filter = parseFilter(sp);
  const [examples, choices, analysis] = await Promise.all([listExamples(filter), filterChoices(), analysisStatus().catch((): AnalysisStatus => ({ allowed: false, reason: "AI notes cannot be checked right now. You can write the notes yourself below.", spentUsd: 0, capUsd: 0 }))]);
  const actors = examples.filter((e) => e.kind === "actor");
  const [links, reels, usage, presenterCounts, forHealth] = await Promise.all([
    previewLinks(examples.map((e) => e.path)),
    finishedReels().catch((): FinishedReel[] => []),
    exampleUsage(examples.map((e) => e.id)),
    // How many businesses have each actor as their presenter, for the confirm before consent goes (consent.ts).
    Promise.all(actors.map(async (a) => [a.id, await presenterUses(a)] as const)).then((pairs) => new Map(pairs)),
    healthRows(),
  ]);
  // A file is missing when Storage would not sign its link; when it signed none at all, Storage is down, so say nothing.
  const withFiles = examples.filter((e) => e.path);
  const missing = new Set(links.size ? withFiles.filter((e) => !links.get(e.path!)).map((e) => e.id) : []);
  const health = forHealth ? labHealth(forHealth, missing) : null;
  // Why an example has a warning dot on its card: what the health list says about it.
  const warnings = new Map<string, string>();
  for (const issue of health ?? []) warnings.set(issue.id, warnings.has(issue.id) ? `${warnings.get(issue.id)} ${issue.problem}` : issue.problem);
  const filtered = Object.keys(filter).length > 0;
  const back = query(filter);

  return (
    <>
      <PageHeader
        icon={Sparkles}
        tone="violet"
        title="Training Lab"
        description="Teach the engines by example: add a reel, video, photo, Kinyarwanda recording, actor or posting habit, and say in your own words what is good about it. Only you see this page."
        actions={<Button href={`${BASE}/add`} leading={<Plus aria-hidden className="size-4" />}>Add an example</Button>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <LabHubCards reelsWaiting={reels.filter((r) => !r.inLab).length} health={health} />

      <Panel icon={BookOpen} tone="violet" title={`Library (${examples.length}${examples.length === LIST_MAX ? "+" : ""})`} description="Newest first. Tap an example to see everything about it and change it.">
        <FilterChips label="Filter by kind" param="kind" base={BASE} params={sp} current={filter.kind ?? ""} options={KIND_CHIPS.map((chip) => ({ value: chip.kind ?? "", label: chip.label }))} />
        <ExpandCard icon={SlidersHorizontal} tone="violet" title="More filters" summary={[filter.sector, filter.language, filter.engine ? ENGINE_LABELS[filter.engine] : null].filter(Boolean).join(" · ") || "Sector, language and engine"} defaultOpen={!!(filter.sector || filter.language || filter.engine)} className="shadow-none">
          <div className="flex min-w-0 flex-col gap-3">
            <MoreFilter label="Sector" param="sector" sp={sp} current={filter.sector} options={choices.sectors.map((v) => [v, v])} />
            <MoreFilter label="Language" param="language" sp={sp} current={filter.language} options={choices.languages.map((v) => [v, v])} />
            <MoreFilter label="Engine" param="engine" sp={sp} current={filter.engine} options={ENGINES.map((e) => [e, ENGINE_LABELS[e]])} />
            {filtered && <Button href={BASE} size="sm" variant="outline" className="self-start">Clear all filters</Button>}
          </div>
        </ExpandCard>
        <Gallery
          items={examples.map((e) => galleryItem(e, { link: e.path ? links.get(e.path) : undefined, times: usage.get(e.id)?.times, warning: warnings.get(e.id) ?? null }))}
          details={Object.fromEntries(examples.map((e) => [e.id, <ExampleDetail key={e.id} example={e} link={e.path ? links.get(e.path) : undefined} back={back} analysis={analysis} use={usage.get(e.id)} presenterUses={presenterCounts.get(e.id) ?? 0} />]))}
          empty={filtered ? "No example matches these filters." : "Your Lab is empty. Tap Add an example to drop your best reel."}
        />
      </Panel>
    </>
  );
}

/** One more filter as chips (sector, language or engine), with "All" to clear it; the other filters stay. */
function MoreFilter({ label, param: key, sp, current, options }: { label: string; param: string; sp: Record<string, string | string[] | undefined>; current?: string; options: [string, string][] }) {
  if (options.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">{label}</p>
      <FilterChips label={`Filter by ${label.toLowerCase()}`} param={key} base={BASE} params={sp} current={current ?? ""} options={[{ value: "", label: "All" }, ...options.map(([value, text]) => ({ value, label: text }))]} />
    </div>
  );
}

function Preview({ example, link }: { example: Example; link?: string }) {
  const mime = example.mime ?? "";
  if (example.path && !link) return <p className="text-[13px] text-muted">The file cannot be shown right now. Refresh the page to try again.</p>;
  if (link && mime.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL
    return <img src={link} alt={example.title} className="max-h-80 w-auto max-w-full rounded-xl object-contain" />;
  }
  if (link && mime.startsWith("video/")) return <video src={link} controls preload="metadata" playsInline className="max-h-96 w-auto max-w-full rounded-xl bg-black" />;
  if (link && mime.startsWith("audio/")) return <audio src={link} controls preload="none" className="w-full max-w-md" />;
  return null;
}

function Text({ label, children }: { label: string; children: string | null }) {
  if (!children) return null;
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="whitespace-pre-line break-words text-[15px]">{children}</p>
    </div>
  );
}

function ExampleDetail({ example: e, link, back, analysis, use, presenterUses: uses }: { example: Example; link?: string; back: string; analysis: AnalysisStatus; use?: ExampleUse; presenterUses: number }) {
  const here = `${back}#ex-${e.id}`;
  const noFile = !e.path && !e.sourceUrl && e.kind !== "schedule";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] text-muted">{kindLabel(e.kind)} · added {dateTime(e.createdAt)}{e.bytes ? ` · ${mb(e.bytes)}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {e.sector && <Badge tone="neutral">{e.sector}</Badge>}
          {e.language && <Badge tone="violet">{e.language}</Badge>}
        </div>
      </div>

      <p className="text-[13px] text-muted">{usageLine(use)}</p>
      <Preview example={e} link={link} />
      {e.kind === "actor" && e.consentGiven && e.mime?.startsWith("video/") && link && <PortraitFromVideo id={e.id} url={link} title={e.title} />}
      {e.sourceUrl && (
        <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener" className="break-all text-[14px] font-medium text-pulse-blue underline">{e.sourceUrl}</a>
      )}
      {noFile && <p role="status" className={notice.bad}>The file is missing (the upload did not finish). Open Edit and add it again.</p>}

      {e.kind === "schedule" && <Text label="When to post">{describeSchedule(e.notes)}</Text>}
      <Text label={e.kind === "schedule" ? "Where this comes from" : "How it was made"}>{e.howMade}</Text>
      <Text label={e.kind === "schedule" ? "Why these times" : "What is good"}>{e.whatIsGood}</Text>
      <Text label="Never this">{e.neverThis}</Text>
      {e.kind === "voice" && <Text label="What is said">{e.transcript}</Text>}
      {e.kind === "voice" && <Text label="Spellings to avoid">{describeExtras(e.notes).wrong}</Text>}
      {e.kind === "voice" && <Text label="Words that are right">{describeExtras(e.notes).words}</Text>}
      {(e.technique.length > 0 || e.tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {e.technique.map((t) => (<Badge key={`t-${t}`} tone="blue">{t}</Badge>))}
          {e.tags.map((t) => (<Badge key={`g-${t}`} tone="neutral">#{t}</Badge>))}
        </div>
      )}
      {e.consentGiven ? (
        <p className="text-[13px] text-muted">Consent: {e.consentName}{e.consentAt ? `, recorded ${dateTime(e.consentAt)}` : ""}{e.consentNote ? `. ${e.consentNote}` : ""}</p>
      ) : (
        e.kind === "actor" && <p className={notice.bad}>No consent recorded: the presenters will not use this actor.</p>
      )}

      {e.kind !== "schedule" && <Notes example={e} here={here} analysis={analysis} />}

      <form action={rateExampleAction} className="flex flex-wrap items-center gap-1">
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="back" value={here} />
        <span className="mr-1 text-[13px] font-medium text-muted">Rating</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="submit" name="rating" value={String(n)} aria-label={`Rate ${n} of 5`} aria-pressed={e.rating === n} className={`flex size-11 items-center justify-center rounded-full text-xl ${e.rating && n <= e.rating ? "text-amber-500" : "text-muted"} hover:bg-soft`}>
            {e.rating && n <= e.rating ? "★" : "☆"}
          </button>
        ))}
        {e.rating && (
          <button type="submit" name="rating" value="" className="min-h-11 rounded-full px-3 text-[13px] text-muted underline hover:bg-soft">Clear</button>
        )}
      </form>

      <form action={setEngineAction} className="flex min-w-0 flex-col gap-1.5">
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="back" value={here} />
        <p className="text-[13px] font-medium text-muted">Engines that learn from it (tap to switch)</p>
        <div className="flex flex-wrap gap-2">
          {ENGINES.map((engine) => {
            const on = e.engines.includes(engine);
            return (
              <button
                key={engine}
                type="submit"
                name="toggle"
                value={`${engine}:${on ? "off" : "on"}`}
                aria-pressed={on}
                className={`min-h-11 rounded-full border px-3.5 text-[13px] font-medium ${on ? "border-transparent bg-success-bg text-success" : "border-line text-muted hover:bg-soft"}`}
              >
                {on ? "On: " : "Off: "}{ENGINE_LABELS[engine]}
              </button>
            );
          })}
        </div>
      </form>

      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <EditExample
          example={{
            id: e.id,
            kind: e.kind,
            title: e.title,
            sourceUrl: e.sourceUrl,
            howMade: e.howMade,
            whatIsGood: e.whatIsGood,
            neverThis: e.neverThis,
            tags: e.tags,
            sector: e.sector,
            language: e.language,
            technique: e.technique,
            rating: e.rating,
            consentGiven: e.consentGiven,
            consentName: e.consentName,
            consentNote: e.consentNote,
            presenterUses: uses,
            engines: e.engines,
            transcript: e.transcript,
            path: e.path,
            notes: e.notes,
          }}
        />
        <ConfirmButton action={deleteExampleAction} fields={{ id: e.id }} label="Delete" title={`Delete “${e.title}”?`} description={`The example and its file are deleted, and the engines stop learning from it.${e.kind === "actor" && uses > 0 ? ` This also removes them as the presenter of ${uses} business${uses === 1 ? "" : "es"}. Reels already made are not changed.` : ""} This cannot be undone.`} confirmLabel="Delete example" pendingLabel="Deleting…" />
      </div>
    </div>
  );
}

/** The example's notes: drafted by the AI when the switch and the budget allow, always correctable or written by hand. */
function Notes({ example: e, here, analysis }: { example: Example; here: string; analysis: AnalysisStatus }) {
  const notes = readNotes(e.notes) ?? {};
  const filled = NOTE_FIELDS.filter((f) => notes[f]).length;
  const problem = exampleProblem(e);
  const voice = e.kind === "voice";
  // A recording's notes come from its transcript (no AI call), so the switch does not matter for it.
  const canDraft = !problem && (voice || analysis.allowed);
  const why = problem ?? analysis.reason;
  const label = voice ? "Draft notes from what is said" : "Draft notes with AI";
  return (
    <section data-slot="ai-notes" aria-label="AI notes" className="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed border-line px-3 py-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-medium">AI notes</p>
          <p className="text-[13px] text-muted">The shots, cuts, beat, captions, hook, setting and music, in plain words. The engines read them with the example.</p>
        </div>
        {canDraft &&
          (filled > 0 ? (
            <ConfirmButton action={draftNotesAction} fields={{ id: e.id, back: here }} label={voice ? label : "Draft again with AI"} title="Draft the notes again?" description="The new draft replaces the notes below, including your corrections." confirmLabel="Draft again" pendingLabel="Drafting…" />
          ) : (
            <form action={draftNotesAction}>
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="back" value={here} />
              <Button type="submit" size="sm" variant="outline">{label}</Button>
            </form>
          ))}
      </div>
      {!canDraft && why && <p className="text-[13px] text-muted">{why}</p>}
      {canDraft && !voice && <p className="text-[13px] text-muted">AI notes budget: ${analysis.spentUsd.toFixed(2)} of ${analysis.capUsd.toFixed(2)} used.</p>}
      <details open={filled > 0} className="min-w-0">
        <summary className="min-h-11 cursor-pointer py-2.5 text-[14px] font-medium">{filled > 0 ? `Notes (${filled} of ${NOTE_FIELDS.length} filled): read and correct` : "Write the notes yourself"}</summary>
        <form key={JSON.stringify(notes)} action={saveNotesAction} className="flex min-w-0 flex-col gap-3 pt-2">
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="back" value={here} />
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {NOTE_FIELDS.map((f) => (
              <Field key={f} label={NOTE_LABELS[f]}>
                <Textarea name={`note_${f}`} rows={2} maxLength={600} defaultValue={notes[f] ?? ""} />
              </Field>
            ))}
          </div>
          <div>
            <Button type="submit" size="sm">Save the notes</Button>
          </div>
        </form>
      </details>
    </section>
  );
}
