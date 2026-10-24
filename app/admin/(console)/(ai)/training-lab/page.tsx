import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { analysisStatus, exampleProblem, type AnalysisStatus } from "@/lib/training-lab/analyse";
import { filterChoices, LIST_MAX, listExamples, NOTE_FIELDS, NOTE_LABELS, parseFilter, previewLinks, readNotes, type ExampleFilter } from "@/lib/training-lab/examples";
import { ENGINE_LABELS, ENGINES, KIND_LABELS, KINDS, type TrainingKind } from "@/lib/training-lab/types";
import { deleteExampleAction, draftNotesAction, moreLikeThisAction, neverThisAction, rateExampleAction, saveNotesAction, setEngineAction } from "./actions";
import { finishedReels, type FinishedReel } from "@/lib/training-lab/from-result";
import { presenterUses } from "@/lib/training-lab/consent";
import { HEALTH_SHOWN, healthRows, labHealth, type HealthIssue } from "@/lib/training-lab/health";
import { describeExtras } from "@/lib/training-lab/language";
import { exampleUsage, usageLine, type ExampleUse } from "@/lib/training-lab/usage";
import { describeSchedule } from "@/lib/training-lab/schedule";
import { EditExample, ExampleForm } from "./example-form";
import { LabTabs } from "./lab-tabs";
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
  const filtered = Object.keys(filter).length > 0;
  const back = query(filter);

  return (
    <>
      <PageHeader
        title="Training Lab"
        description="Teach the engines by example. Add a reel, video, image or post, a Kinyarwanda recording, an actor who agreed to be used, or a posting habit, and say in your own words how it was made and what is good about it. The engines you switch on read it when they plan. Only you see this page."
      />
      <LabTabs current="library" />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      {health && <LabHealth issues={health} />}

      <Panel title="Add an example" description="A file or a link, then the plain-words form. Files stay private: only this page shows them, with links that expire after an hour.">
        <ExampleForm />
      </Panel>

      <Panel title={`Examples (${examples.length}${examples.length === LIST_MAX ? "+" : ""})`} description="Newest first.">
        <form method="get" action={BASE} className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <FilterSelect name="kind" label="Kind" value={filter.kind} options={KINDS.map((k) => [k, KIND_LABELS[k]])} />
          <FilterSelect name="sector" label="Sector" value={filter.sector} options={choices.sectors.map((s) => [s, s])} />
          <FilterSelect name="language" label="Language" value={filter.language} options={choices.languages.map((l) => [l, l])} />
          <FilterSelect name="engine" label="Engine" value={filter.engine} options={ENGINES.map((e) => [e, ENGINE_LABELS[e]])} />
          <div className="flex gap-2">
            <Button type="submit" size="sm">Filter</Button>
            {filtered && <Button href={BASE} size="sm" variant="outline">Clear</Button>}
          </div>
        </form>
        {examples.length === 0 ? (
          <Empty>{filtered ? "No example matches these filters." : "No examples yet. Add the first one above."}</Empty>
        ) : (
          <ul className="flex min-w-0 flex-col gap-4">
            {examples.map((e) => (
              <ExampleCard key={e.id} example={e} link={e.path ? links.get(e.path) : undefined} back={back} analysis={analysis} use={usage.get(e.id)} presenterUses={presenterCounts.get(e.id) ?? 0} />
            ))}
          </ul>
        )}
      </Panel>

      <FinishedReels reels={reels} />
    </>
  );
}

/** What makes examples useless or risky, at most 8 with how many more, each linked to its example. */
function LabHealth({ issues }: { issues: HealthIssue[] }) {
  if (!issues.length) return <p role="status" className={notice.ok}>Lab health: all examples are ready to use.</p>;
  const shown = issues.slice(0, HEALTH_SHOWN);
  return (
    <section aria-label="Lab health" className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line px-4 py-3">
      <p className="text-[14px] font-medium">Lab health: {issues.length} thing{issues.length === 1 ? "" : "s"} to fix</p>
      <ul className="flex min-w-0 flex-col gap-1 text-[14px]">
        {shown.map((i, k) => (
          <li key={`${i.id}-${k}`} className="min-w-0 break-words">
            <a href={`${BASE}#ex-${i.id}`} className="font-medium text-pulse-blue underline">{i.title}</a>: {i.problem}
          </li>
        ))}
      </ul>
      {issues.length > shown.length && <p className="text-[13px] text-muted">and {issues.length - shown.length} more</p>}
    </section>
  );
}

/** The newest finished reels: the owner's verdict on each becomes a Lab example (the client's reel is not changed). */
function FinishedReels({ reels }: { reels: FinishedReel[] }) {
  return (
    <section id="finished-reels" className="scroll-mt-24">
      <Panel title="Finished reels" description="The 20 newest reels the engine made, for every business. Your verdict becomes a Lab example with the video, so the reel engine makes more like it or never repeats it. The client's reel stays as it is.">
        {reels.length === 0 ? (
          <Empty>No finished reels yet.</Empty>
        ) : (
          <ul className="flex min-w-0 flex-col divide-y divide-line">
            {reels.map((r) => (
              <li key={r.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="break-words font-medium">{r.title}</p>
                  <p className="text-[13px] text-muted">{r.business} · {r.language} · {dateTime(r.createdAt)}</p>
                  <Link href={`/admin/training-lab/editor?reel=${encodeURIComponent(r.id)}`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-pulse-blue underline">Open in the editor</Link>
                </div>
                {r.inLab ? (
                  <Badge tone="neutral">In the Lab</Badge>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <form action={moreLikeThisAction}>
                      <input type="hidden" name="reelId" value={r.id} />
                      <Button type="submit" size="sm" variant="outline">More like this</Button>
                    </form>
                    <ConfirmButton action={neverThisAction} fields={{ reelId: r.id }} label="Never this" title={`Never this: “${r.title}”?`} description="It becomes a 1-star example with your reason, and the engines never copy it." confirmLabel="Never this" pendingLabel="Saving…">
                      <Field label="What must never happen again" hint="One line, for example: the presenter walks through the product." required>
                        <Input name="reason" maxLength={300} required />
                      </Field>
                    </ConfirmButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      {label}
      <Select name={name} defaultValue={value ?? ""}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </Select>
    </label>
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

function ExampleCard({ example: e, link, back, analysis, use, presenterUses: uses }: { example: Example; link?: string; back: string; analysis: AnalysisStatus; use?: ExampleUse; presenterUses: number }) {
  const here = `${back}#ex-${e.id}`;
  const noFile = !e.path && !e.sourceUrl && e.kind !== "schedule";
  return (
    <li id={`ex-${e.id}`} className="flex min-w-0 scroll-mt-24 flex-col gap-3 rounded-2xl border border-line p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words font-semibold">{e.title}</h3>
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
    </li>
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
