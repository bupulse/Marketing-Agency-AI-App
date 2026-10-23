import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Progress } from "@/components/knowledge/progress";
import { QuizRing } from "@/components/knowledge/quiz-ring";
import { Button, GlassCard } from "@/components/ui";
import type { QuizEntry } from "@/lib/knowledge/quiz-entry";

/** The Business info quiz's big card: what it is, the score so far, and Start / Continue / Play again. */
export function QuizCard({ entry, title, text, note }: { entry: QuizEntry; title: string; text: string; note?: ReactNode }) {
  return (
    <GlassCard as="section" aria-label={title} strong className="relative flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-7">
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-brand-gradient opacity-[0.12] blur-2xl" />
      <QuizRing percent={entry.overall} className="size-16 sm:size-20 [&>span]:text-[28px] sm:[&>span]:text-[32px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h2>
        <p className="text-[14px] text-muted">{text}</p>
        <div className="flex items-center gap-3">
          <Progress percent={entry.overall} label="Business info complete" className="flex-1" />
          <span className="shrink-0 text-[14px] font-semibold tabular-nums">{entry.overall}%</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {entry.nextRound && entry.overall < 100 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-[12px] font-semibold">
              Next: <span aria-hidden>{entry.nextRound.emoji}</span> {entry.nextRound.title}
            </span>
          )}
          {note && <span className="text-[13px] text-muted">{note}</span>}
        </div>
      </div>
      {entry.playable && (
        <Button href={entry.href} size="lg" className="shrink-0" trailing={<ArrowRight aria-hidden className="size-4" />}>
          {entry.label}
        </Button>
      )}
    </GlassCard>
  );
}
