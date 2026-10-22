import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Progress } from "@/components/knowledge/progress";
import { Button, GlassCard } from "@/components/ui";
import type { QuizEntry } from "@/lib/knowledge/quiz-entry";

/** The Business info quiz's big card: what it is, the score so far, and Start / Continue / Play again. */
export function QuizCard({ entry, title, text, note }: { entry: QuizEntry; title: string; text: string; note?: ReactNode }) {
  return (
    <GlassCard as="section" aria-label={title} strong className="relative flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-7">
      <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-3xl shadow-glow">
        🎯
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h2>
        <p className="text-[14px] text-muted">{text}</p>
        <div className="flex items-center gap-3">
          <Progress percent={entry.overall} label="Business info complete" className="flex-1" />
          <span className="shrink-0 text-[14px] font-semibold tabular-nums">{entry.overall}%</span>
        </div>
        {note && <span className="text-[13px] text-muted">{note}</span>}
      </div>
      {entry.playable && (
        <Button href={entry.href} size="lg" className="shrink-0" trailing={<ArrowRight aria-hidden className="size-4" />}>
          {entry.label}
        </Button>
      )}
    </GlassCard>
  );
}
