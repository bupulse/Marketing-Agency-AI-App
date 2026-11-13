import { ArrowRight, BookOpen, Lock, Sparkles } from "lucide-react";
import { KitStyles, PageHeader, StatusPill, TodoList } from "@/components/admin/kit";
import { CARD } from "@/components/admin/kit/tones";
import { BGrid, BGroupTitle, BProgressCard } from "@/components/app/kit/b-cards";
import { Progress } from "@/components/knowledge/progress";
import { QuizRing } from "@/components/knowledge/quiz-ring";
import { SECTION_ICONS } from "@/components/knowledge/section-icons";
import { Button } from "@/components/ui";
import type { QuizEntry } from "@/lib/knowledge/quiz-entry";
import type { SectionKey, ToDo } from "@/lib/knowledge/sections";

/** One section card's state, worked out by the page (role, plan, progress). */
export type HubSection = {
  key: SectionKey;
  title: string;
  description: string;
  href: string;
  soon: boolean;
  /** "add" (owner may add it to the plan), "missing" (not in the plan), "view" (admins edit), or null. */
  lock: "add" | "missing" | "view" | null;
  percent: number | null;
  summary?: string;
};

/** The three groups the sections are shown in, so the page reads as three short lists instead of one wall of cards. */
const GROUPS: { id: string; title: string; hint: string; keys: SectionKey[] }[] = [
  { id: "basics", title: "The basics", hint: "Who you are, where to find you and how you look.", keys: ["profile", "locations", "brand", "channels"] },
  { id: "sell", title: "What you sell", hint: "Your products, offers and what customers say.", keys: ["products", "campaigns", "reviews"] },
  { id: "customers", title: "Your customers", hint: "Who buys, who else they look at, and the answers they need.", keys: ["audience", "competitors", "faqs", "interview"] },
];

/**
 * /dashboard/knowledge: the quiz first (the short, mostly-tap way to fill everything in), the next things to add, then
 * the sections in three small groups with how complete each one is. Presentational: the page passes plain data in.
 */
export function KnowledgeHub({ entry, sections, todos }: { entry: QuizEntry; sections: HubSection[]; todos: ToDo[] }) {
  const quizDone = entry.done && entry.overall < 100;
  const byKey = new Map(sections.map((s) => [s.key, s]));
  return (
    <>
      <KitStyles />
      <PageHeader icon={BookOpen} title="Business info" description="What BuPulse knows about your business. The more you add, the more your posts and chat replies sound like you." />

      <section aria-labelledby="quiz-title" className={`${CARD} relative overflow-hidden p-4 sm:p-6`}>
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-brand-gradient opacity-[0.14] blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex items-center gap-4">
            <QuizRing percent={entry.overall} className="size-16 sm:size-20 [&>span]:text-[28px] sm:[&>span]:text-[32px]" />
            <div className="flex min-w-0 flex-col gap-1 sm:hidden">
              <span className="text-[30px] font-bold leading-none tabular-nums tracking-[-0.03em]">{entry.overall}%</span>
              <span className="text-[13px] text-muted">complete</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h2 id="quiz-title" className="text-[19px] font-bold tracking-[-0.02em] sm:text-[21px]">
              {quizDone ? "Quiz done" : entry.overall === 0 ? "Start with a 5-minute quiz" : "Keep going with the quiz"}
            </h2>
            <p className="text-[14px] leading-snug text-muted">
              {quizDone ? "Every round is filled in. Only customer reviews are missing: add them as customers agree to share them." : "One question at a time, mostly taps. BuPulse guesses first, you confirm."}
            </p>
            <div className="hidden items-center gap-3 sm:flex">
              <Progress percent={entry.overall} label="Business info complete" className="flex-1" />
              <span className="shrink-0 text-[14px] font-semibold tabular-nums">{entry.overall}%</span>
            </div>
            {entry.nextRound && !entry.done && (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-[12px] font-semibold">
                Next: <span aria-hidden>{entry.nextRound.emoji}</span> {entry.nextRound.title}
              </span>
            )}
          </div>
          {entry.playable && (
            <Button href={entry.href} size="lg" className="w-full shrink-0 sm:w-auto" trailing={<ArrowRight aria-hidden className="size-4" />}>
              {entry.label}
            </Button>
          )}
        </div>
      </section>

      {todos.length > 0 && !entry.done && (
        <section aria-labelledby="next-title" className="flex flex-col gap-3">
          <BGroupTitle id="next-title" title="Add these next" hint="The two quickest ways to raise your score." />
          <TodoList
            columns={2}
            items={todos.slice(0, 2).map((t) => ({ key: t.key, href: t.href, icon: SECTION_ICONS[t.key] ?? Sparkles, tone: "info", text: byKey.get(t.key)?.title ?? t.label, sub: t.label }))}
          />
        </section>
      )}

      {GROUPS.map((g) => {
        const list = g.keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
        if (list.length === 0) return null;
        return (
          <section key={g.id} aria-labelledby={`group-${g.id}`} className="flex flex-col gap-3">
            <BGroupTitle id={`group-${g.id}`} title={g.title} hint={g.hint} />
            <BGrid cols={list.length === 4 ? 2 : 3} className={list.length === 4 ? "xl:grid-cols-4" : undefined}>
              {list.map((s) => (
                <BProgressCard
                  key={s.key}
                  href={s.soon ? undefined : s.href}
                  icon={SECTION_ICONS[s.key]}
                  title={s.title}
                  hint={s.description}
                  percent={s.soon || s.lock ? null : s.percent}
                  foot={s.soon ? "Arriving in the next update" : s.summary}
                  label={`${s.title}${s.summary ? `: ${s.summary}` : ""}${typeof s.percent === "number" && !s.soon ? `, ${s.percent}% complete` : ""}`}
                  badge={<SectionBadge s={s} />}
                />
              ))}
            </BGrid>
          </section>
        );
      })}

      <p className="px-1 text-[13px] text-muted">Required fields are marked with *. Your business info is {entry.overall}% complete.</p>
    </>
  );
}

function SectionBadge({ s }: { s: HubSection }) {
  if (s.soon) return <StatusPill tone="muted">Coming soon</StatusPill>;
  if (s.lock === "add") return <StatusPill tone="new">Add to your plan</StatusPill>;
  if (s.lock === "missing") return <StatusPill tone="muted">Not in your plan</StatusPill>;
  if (s.lock === "view")
    return (
      <StatusPill tone="muted" icon={Lock}>
        Admins edit
      </StatusPill>
    );
  if (typeof s.percent !== "number") return null;
  return s.percent >= 100 ? (
    <StatusPill tone="good" dot>
      Done
    </StatusPill>
  ) : (
    <StatusPill tone="info">{s.percent}%</StatusPill>
  );
}
