"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";
import { percentDone, type QuizRound, type QuizStep } from "@/lib/quiz/flow";
import type { QuizApi } from "./use-quiz";

/** Typing in a field: Enter and the number keys belong to the field, not the quiz. */
export function typingInField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/**
 * True while a window opened over the quiz has the keys (the gallery picker, "Import from a link", a menu): Enter or a
 * number typed there belongs to that window, not to the question under it.
 */
export function keysElsewhere(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.("dialog, [role=dialog], [role=menu]") || !!document.querySelector("dialog[open]");
}

/**
 * Enter goes to the next question, also from a one-line text field (the year, a price, a name). Not from a text area
 * or a select, and not when the field used the Enter itself (Chips' "Add your own" adds the chip and stops it).
 */
export function enterMeansNext(e: KeyboardEvent): boolean {
  if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || e.isComposing) return false;
  if (keysElsewhere(e)) return false;
  if (!typingInField(e)) return true;
  const el = e.target as HTMLElement;
  return el.tagName === "INPUT" && ["text", "number", "tel", "email", "url", "search", "date"].includes((el as HTMLInputElement).type);
}

/**
 * Where the round pills should scroll so the current pill sits in the middle (or as near as the row allows): the row's
 * width, its full scroll width, and the pill's left edge and width measured from the row's start.
 */
export function pillScrollLeft(row: { width: number; scrollWidth: number }, pill: { left: number; width: number }): number {
  const max = Math.max(0, row.scrollWidth - row.width);
  const centred = pill.left + pill.width / 2 - row.width / 2;
  return Math.round(Math.min(max, Math.max(0, centred)));
}

type Primary = { label?: string; onClick: () => void; disabled?: boolean; busy?: boolean };

/**
 * The quiz around one question: the round pills, the points, the progress bar, the question card and the buttons at the
 * bottom (Back, Skip, the main button). Enter presses the main button when no field has the focus.
 */
export function QuizFrame({
  rounds,
  steps,
  quiz,
  primary,
  canSkip = true,
  fullForm,
  children,
}: {
  rounds: readonly QuizRound[];
  steps: readonly QuizStep[];
  quiz: QuizApi;
  primary: Primary | null;
  canSkip?: boolean;
  /** "Prefer the full form?" link, to the page with every field at once. */
  fullForm?: { href: string; label?: string };
  children: ReactNode;
}) {
  useEffect(() => {
    if (!primary || primary.disabled || primary.busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (enterMeansNext(e)) {
        e.preventDefault();
        primary.onClick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary]);

  // The round pills follow the quiz: the current round slides into view when the quiz moves on (a phone shows only a
  // few pills), and a new question that starts above the screen scrolls into view.
  const pillsRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stepKey = `${quiz.index}:${quiz.roundDone ?? ""}:${quiz.finished}`;
  const firstStep = useRef(true);
  useEffect(() => {
    const row = pillsRef.current;
    const pill = row?.querySelector<HTMLElement>('[aria-current="step"]');
    if (row && pill) {
      const left = pill.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      row.scrollTo({ left: pillScrollLeft({ width: row.clientWidth, scrollWidth: row.scrollWidth }, { left, width: pill.offsetWidth }), behavior: reduce ? "auto" : "smooth" });
    }
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const card = cardRef.current;
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [quiz.round, stepKey]);

  const pct = percentDone(steps, quiz.index);
  const doneRounds = new Set(quiz.progress.doneRounds);
  return (
    <div ref={cardRef} className="mx-auto flex w-full max-w-2xl scroll-mt-4 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <nav ref={pillsRef} aria-label="Rounds" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-1 [mask-image:linear-gradient(to_right,transparent,black_20px,black_calc(100%-20px),transparent)] [scrollbar-width:none]">
          {rounds.map((r) => {
            const here = r.id === quiz.round && !quiz.finished;
            const done = doneRounds.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => quiz.goToRound(r.id)}
                aria-current={here ? "step" : undefined}
                className={cn(
                  "inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors",
                  here ? "bg-brand-gradient text-white shadow-glow" : done ? "bg-success-bg text-success" : "bg-soft text-muted hover:text-text",
                )}
              >
                <span aria-hidden>{r.emoji}</span>
                <span className={cn(!here && "hidden sm:inline")}>{r.title}</span>
                {done && !here && <Check aria-label="done" className="size-3.5" />}
              </button>
            );
          })}
        </nav>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-soft px-3 py-1.5 text-[13px] font-bold tabular-nums" aria-label={`${quiz.points} points`}>
          <Zap aria-hidden className="size-3.5 text-pulse-violet" />
          {quiz.points}
        </span>
      </div>

      <div role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 w-full overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-brand-gradient transition-[width] duration-500 ease-out-soft" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>

      <GlassCard strong padding="none" className="relative flex min-h-[440px] flex-col overflow-hidden p-5 sm:p-8">
        <div key={`${quiz.index}:${quiz.roundDone ?? ""}`} className="flex flex-1 animate-pop flex-col gap-5">
          {children}
        </div>
      </GlassCard>

      {primary && (
        <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-[28px] bg-bg/80 p-1.5 backdrop-blur-md">
          <Button variant="ghost" onClick={quiz.back} disabled={quiz.index === 0 || primary.busy} aria-label="Back" className="px-4">
            <ArrowLeft aria-hidden className="size-4" />
          </Button>
          {canSkip && (
            <Button variant="outline" onClick={quiz.skip} disabled={primary.busy}>
              Skip
            </Button>
          )}
          <Button className="flex-1" onClick={primary.onClick} disabled={primary.disabled || primary.busy} trailing={primary.busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <ArrowRight aria-hidden className="size-4" />}>
            {primary.busy ? "Saving…" : (primary.label ?? "Next")}
          </Button>
        </div>
      )}

      {fullForm && (
        <p className="text-center text-[13px] text-muted">
          Prefer to see every field at once?{" "}
          <Link href={fullForm.href} className="font-medium text-text underline underline-offset-2">
            {fullForm.label ?? "Open the full form"}
          </Link>
        </p>
      )}
    </div>
  );
}

/** The question: a small kicker ("Round 2 · 3 of 5"), the question in big type and a one-line hint. */
export function QuestionHead({ emoji, kicker, title, hint }: { emoji?: string; kicker?: string; title: ReactNode; hint?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      {kicker && <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{kicker}</p>}
      <h2 className="text-[24px] font-semibold leading-tight tracking-[-0.025em] sm:text-[28px]">
        {emoji && (
          <span aria-hidden className="mr-2">
            {emoji}
          </span>
        )}
        {title}
      </h2>
      {hint && <p className="text-[15px] text-muted">{hint}</p>}
    </header>
  );
}

/** "Our guess" tag on what BuPulse picked for the owner. */
export function GuessTag({ className, label = "Our guess" }: { className?: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-new-bg px-2 py-0.5 text-[11px] font-semibold text-new", className)}>
      <Sparkles aria-hidden className="size-3" />
      {label}
    </span>
  );
}

const CONFETTI = ["#2F6BFF", "#7B5CFF", "#22C55E", "#F59E0B", "#EC4899", "#06B6D4"];

/** Falling confetti (CSS only; none with reduced motion). */
export function Confetti({ pieces = 28 }: { pieces?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
      {Array.from({ length: pieces }, (_, i) => (
        <span
          key={i}
          className="absolute top-[-12px] block h-3 w-2 rounded-[2px]"
          style={{
            left: `${(i * 37) % 100}%`,
            background: CONFETTI[i % CONFETTI.length],
            animation: `bp-confetti ${1.6 + ((i * 7) % 10) / 10}s ${((i * 13) % 10) / 20}s ease-in both`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/** Between two rounds: what the owner just finished, the points, and what comes next. */
export function RoundDone({ round, next, points, saved, onContinue }: { round: QuizRound; next: QuizRound | null; points: number; saved?: string; onContinue: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (enterMeansNext(e)) {
        e.preventDefault();
        onContinue();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onContinue]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <Confetti />
      <span aria-hidden className="text-6xl">
        {round.emoji}
      </span>
      <h2 className="text-[26px] font-semibold tracking-[-0.025em]">{round.title}: done!</h2>
      {saved && <p className="max-w-md text-[15px] text-muted">{saved}</p>}
      <p className="inline-flex items-center gap-1.5 rounded-full bg-soft px-4 py-2 text-[15px] font-bold tabular-nums">
        <Zap aria-hidden className="size-4 text-pulse-violet" />
        {points} points
      </p>
      <Button size="lg" onClick={onContinue} trailing={<ArrowRight aria-hidden className="size-4" />} autoFocus>
        {next ? `Next: ${next.emoji} ${next.title}` : "See your score"}
      </Button>
    </div>
  );
}

/** A playful wait while the AI reads the business ("Reading your products…"), with lines that change every 2 seconds. */
export function Thinking({ lines }: { lines: string[] }) {
  const i = useCycle(lines.length);
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
      <span className="relative inline-flex size-20 items-center justify-center rounded-full bg-brand-gradient text-white shadow-glow">
        <Sparkles aria-hidden className="size-9 animate-pulse" />
      </span>
      <p key={i} className="animate-pop text-[17px] font-medium">
        {lines[i]}
      </p>
    </div>
  );
}

/** 0, 1, 2, … n-1, 0, … one step every 2 seconds. */
function useCycle(n: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), 2000);
    return () => clearInterval(t);
  }, [n]);
  return i;
}
