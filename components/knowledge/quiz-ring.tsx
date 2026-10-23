import { cn } from "@/lib/cn";

/**
 * The Business info score as a small ring with the emoji in the middle (the quiz banner on every page and the big quiz
 * card). A conic gradient, so it needs no SVG ids and works in server and client components alike.
 */
export function QuizRing({ percent, emoji = "🎯", className }: { percent: number; emoji?: string; className?: string }) {
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <span
      role="img"
      aria-label={`Business info ${pct}% complete`}
      className={cn("relative inline-flex size-14 shrink-0 items-center justify-center rounded-full p-[5px]", className)}
      style={{ background: `conic-gradient(#2f6bff, #7b5cff ${pct}%, var(--color-line) ${pct}% 100%)` }}
    >
      <span aria-hidden className="flex size-full items-center justify-center rounded-full bg-surface text-[22px] leading-none">
        {emoji}
      </span>
    </span>
  );
}
