import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import type { WordsOverview } from "@/lib/training-lab/language";
import { labWords } from "@/lib/training-lab/language-reader";
import { LabTabs } from "../lab-tabs";

export const metadata = { title: "Training Lab words" };
export const dynamic = "force-dynamic";

const here = (id: string) => `/admin/training-lab#ex-${id}`;

function From({ id, title, on }: { id: string; title: string; on: boolean }) {
  return (
    <span className="text-[13px] text-muted">
      from <Link href={here(id)} className="underline">{title}</Link>
      {!on && <> · <Badge tone="neutral">switched off for the language check</Badge></>}
    </span>
  );
}

export default async function TrainingLabWordsPage() {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only, like the library; anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  let overview: WordsOverview | null = null;
  try {
    overview = await labWords();
  } catch {
    overview = null;
  }

  return (
    <>
      <PageHeader title="Training Lab" description="Everything the Lab teaches about Kinyarwanda, from your recordings. To change anything, open the recording it came from." />
      <LabTabs current="words" />
      {!overview ? (
        <p role="alert" className={notice.bad}>The words could not be read right now. Refresh the page to try again.</p>
      ) : overview.wrong.length + overview.words.length + overview.phrases.length === 0 ? (
        <Empty>{overview.recordings ? "No words yet. Open one of your recordings, fill in \"Spellings to avoid\" and \"Words that are right\", and write what is said." : "No words yet. Add your first recording in the Library: choose the kind \"Kinyarwanda recording\", upload the audio, write exactly what is said, and list any spellings to avoid."}</Empty>
      ) : (
        <>
          <p className="rounded-2xl bg-soft px-4 py-3 text-sm text-muted">
            Reels fix these spellings before filming, and every language check flags them. {overview.wrong.length} to avoid · {overview.words.length} right words · {overview.phrases.length} phrases · from {overview.recordings} {overview.recordings === 1 ? "recording" : "recordings"}.
          </p>
          <Panel title={`Spellings to avoid (${overview.wrong.length})`} description="Written wrong, then the right spelling. With no right spelling, the check only flags it.">
            {overview.wrong.length === 0 ? (
              <p className="text-sm text-muted">None yet.</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {overview.wrong.map((w) => (
                  <li key={w.word.toLowerCase()} className="flex min-w-0 flex-col gap-0.5 break-words">
                    <span className="text-[15px]"><span className="line-through">{w.word}</span>{w.fix ? <> &rarr; <strong>{w.fix}</strong></> : <span className="text-muted"> (no right spelling given)</span>}</span>
                    <From id={w.id} title={w.title} on={w.on} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={`Words that are right (${overview.words.length})`} description="Never flagged by the language check.">
            {overview.words.length === 0 ? (
              <p className="text-sm text-muted">None yet.</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {overview.words.map((w) => (
                  <li key={w.word.toLowerCase()} className="flex min-w-0 flex-col gap-0.5 break-words">
                    <strong className="text-[15px]">{w.word}</strong>
                    <From id={w.id} title={w.title} on={w.on} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={`Phrases from your recordings (${overview.phrases.length})`} description="What is said in your recordings, in your spelling. The writers use these as natural phrases.">
            {overview.phrases.length === 0 ? (
              <p className="text-sm text-muted">None yet.</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {overview.phrases.map((p) => (
                  <li key={p.phrase} className="flex min-w-0 flex-col gap-0.5 break-words">
                    <span className="text-[15px]">{p.phrase}</span>
                    <From id={p.id} title={p.title} on={p.on} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
