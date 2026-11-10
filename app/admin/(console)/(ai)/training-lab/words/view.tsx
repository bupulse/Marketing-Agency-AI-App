import Link from "next/link";
import { BookCheck, Languages, MessageSquareQuote, SpellCheck2 } from "lucide-react";
import { CARD, EmptyState, FilterChips, PageHeader, StatGrid, StatTile, StatusPill, type SearchParamsLike } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import type { WordsOverview } from "@/lib/training-lab/language";
import { LabTabs } from "../lab-tabs";

const here = (id: string) => `/admin/training-lab#ex-${id}`;
export const WORD_LISTS = ["wrong", "words", "phrases"] as const;
export type WordList = (typeof WORD_LISTS)[number];

function From({ id, title, on }: { id: string; title: string; on: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
      <span>from <Link href={here(id)} className="underline">{title}</Link></span>
      {!on && <StatusPill tone="muted">switched off for the language check</StatusPill>}
    </span>
  );
}

const ROW = "flex min-w-0 flex-col gap-0.5 break-words rounded-2xl bg-soft/70 px-3.5 py-2.5 dark:bg-white/[0.04]";

/**
 * Words: three numbers (spellings to avoid, right words, phrases), chips to pick one list, and that list as rows,
 * each linked to the recording it came from.
 */
export function WordsView({ overview, list, params }: { overview: WordsOverview | null; list: WordList; params: SearchParamsLike }) {
  const empty = !overview || overview.wrong.length + overview.words.length + overview.phrases.length === 0;
  return (
    <>
      <PageHeader icon={Languages} tone="violet" title="Words" description="Everything the Lab teaches about Kinyarwanda, from your recordings. Reels fix these spellings before filming, and every language check flags them. To change anything, open the recording it came from." back={{ href: "/admin/training-lab", label: "Training Lab" }} />
      <LabTabs current="words" />
      {!overview ? (
        <p role="alert" className={notice.bad}>The words could not be read right now. Refresh the page to try again.</p>
      ) : empty ? (
        <EmptyState icon={Languages} title="No words yet." hint={overview.recordings ? "Open one of your recordings, fill in \"Spellings to avoid\" and \"Words that are right\", and write what is said." : "Add your first recording in the Library: choose the kind \"Kinyarwanda recording\", upload the audio, write exactly what is said, and list any spellings to avoid."} />
      ) : (
        <>
          <StatGrid cols={3}>
            <StatTile icon={SpellCheck2} tone="violet" label="Spellings to avoid" value={String(overview.wrong.length)} hint="Written wrong, then the right spelling." href="/admin/training-lab/words" />
            <StatTile icon={BookCheck} tone="violet" label="Right words" value={String(overview.words.length)} hint="Never flagged by the language check." href="/admin/training-lab/words?list=words" />
            <StatTile icon={MessageSquareQuote} tone="violet" label="Phrases" value={String(overview.phrases.length)} hint={`From ${overview.recordings} ${overview.recordings === 1 ? "recording" : "recordings"}.`} href="/admin/training-lab/words?list=phrases" className="max-lg:col-span-2" />
          </StatGrid>
          <FilterChips label="Show" param="list" base="/admin/training-lab/words" params={params} current={list} allValue="wrong" options={[{ value: "wrong", label: "Spellings to avoid", count: overview.wrong.length }, { value: "words", label: "Right words", count: overview.words.length }, { value: "phrases", label: "Phrases", count: overview.phrases.length }]} />
          <section className={cn("flex min-w-0 flex-col gap-3 p-4 sm:p-5", CARD)}>
            <p className="text-[13px] text-muted">
              {list === "wrong" ? "Written wrong, then the right spelling. With no right spelling, the check only flags it." : list === "words" ? "Never flagged by the language check." : "What is said in your recordings, in your spelling. The writers use these as natural phrases."}
            </p>
            {list === "wrong" &&
              (overview.wrong.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
                <ul className="flex min-w-0 flex-col gap-2">
                  {overview.wrong.map((w) => (
                    <li key={w.word.toLowerCase()} className={ROW}>
                      <span className="text-[15px]"><span className="line-through decoration-danger/70">{w.word}</span>{w.fix ? <> &rarr; <strong>{w.fix}</strong></> : <span className="text-muted"> (no right spelling given)</span>}</span>
                      <From id={w.id} title={w.title} on={w.on} />
                    </li>
                  ))}
                </ul>
              ))}
            {list === "words" &&
              (overview.words.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
                <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
                  {overview.words.map((w) => (
                    <li key={w.word.toLowerCase()} className={ROW}>
                      <strong className="text-[15px]">{w.word}</strong>
                      <From id={w.id} title={w.title} on={w.on} />
                    </li>
                  ))}
                </ul>
              ))}
            {list === "phrases" &&
              (overview.phrases.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
                <ul className="flex min-w-0 flex-col gap-2">
                  {overview.phrases.map((p) => (
                    <li key={p.phrase} className={ROW}>
                      <span className="text-[15px]">{p.phrase}</span>
                      <From id={p.id} title={p.title} on={p.on} />
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        </>
      )}
    </>
  );
}
