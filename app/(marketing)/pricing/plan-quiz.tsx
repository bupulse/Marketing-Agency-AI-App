"use client";

import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { formatPrice } from "@/components/billing/helpers";
import { Button, GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PLAN_PICK_COOKIE, PLAN_PICK_MAX_AGE, QUIZ_QUESTIONS, parseAnswers, recommendPlan, type QuizAnswers } from "@/lib/plan-quiz";
import type { RegionalPlan } from "@/lib/region-prices";

const CUSTOM_PLAN_SIGNUP = `/signup?next=${encodeURIComponent("/custom-plan?from=quiz")}`;

/** Keeps the pick for /start-trial, which preselects it (lib/plan-quiz.ts). Only a plan key. */
function rememberPick(planKey: string) {
  try {
    document.cookie = `${PLAN_PICK_COOKIE}=${encodeURIComponent(planKey)}; path=/; max-age=${PLAN_PICK_MAX_AGE}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  } catch {
    /* cookies blocked: the plan step simply starts on the most popular plan */
  }
}

/**
 * "Pick your plan in 30 seconds": three questions, then one recommendation from the visitor's region plans (the same
 * plans and prices as the cards above), with Start your free trial and Sign up and pay.
 */
export function PlanQuiz({ plans }: { plans: RegionalPlan[] }) {
  const [answers, setAnswers] = useState<Partial<QuizAnswers>>({});
  const complete = parseAnswers(answers);
  const result = complete ? recommendPlan(complete, plans) : null;
  const step = QUIZ_QUESTIONS.findIndex((q) => !answers[q.key]);

  return (
    <GlassCard as="section" padding="lg" className="flex flex-col gap-6" aria-labelledby="plan-quiz-title">
      <div className="flex flex-col gap-1">
        <h2 id="plan-quiz-title" className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles aria-hidden className="size-6 text-pulse-violet" />
          Pick your plan in 30 seconds
        </h2>
        <p className="text-muted">Three questions. We suggest a plan; you can change it at any time.</p>
      </div>

      {QUIZ_QUESTIONS.map((q, i) => (
        <fieldset key={q.key} className={cn("flex flex-col gap-3", step !== -1 && i > step && "hidden")}>
          <legend className="mb-1 font-semibold">
            {i + 1}. {q.title}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o) => {
              const on = answers[q.key] === o.value;
              return (
                <label
                  key={o.value}
                  className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-[15px] transition-colors", on ? "border-pulse-violet/60 bg-glass-strong" : "border-line hover:bg-soft")}
                >
                  <input type="radio" name={`quiz-${q.key}`} value={o.value} checked={on} onChange={() => setAnswers((a) => ({ ...a, [q.key]: o.value }))} className="size-4 accent-[color:var(--color-pulse-violet)]" />
                  {o.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {result && (
        <div role="status" className="flex flex-col gap-4 rounded-card border border-pulse-violet/40 bg-soft p-5">
          {result.kind === "plan" && (
            <>
              <p className="text-sm font-medium text-muted">Our suggestion</p>
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong className="text-2xl tracking-tight">{result.plan.name}</strong>
                <span className="text-lg font-semibold">{formatPrice(result.plan.monthlyPriceCents, result.plan.currency)} / month</span>
              </p>
            </>
          )}
          {result.kind === "managed" && <strong className="text-2xl tracking-tight">Done for you: Managed by BuPulse</strong>}
          {result.kind === "custom" && <strong className="text-2xl tracking-tight">A custom plan</strong>}
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px] text-muted">
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {result.kind === "plan" && (
              <>
                <Button href="/signup" onClick={() => rememberPick(result.plan.key)} trailing={<ArrowRight aria-hidden className="size-4" />}>
                  Start your free trial
                </Button>
                <Button href="/signup" variant="outline" onClick={() => rememberPick(result.plan.key)}>
                  Sign up and pay now
                </Button>
              </>
            )}
            {result.kind === "managed" && (
              <>
                <Button href="/signup" trailing={<ArrowRight aria-hidden className="size-4" />}>
                  Start your free trial
                </Button>
                <Button href="/done-for-you" variant="outline">
                  See done-for-you
                </Button>
              </>
            )}
            {result.kind === "custom" && (
              <Button href={CUSTOM_PLAN_SIGNUP} trailing={<ArrowRight aria-hidden className="size-4" />}>
                Request a custom plan
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setAnswers({})} leading={<RotateCcw aria-hidden className="size-4" />}>
              Start again
            </Button>
          </div>
          {result.kind === "plan" && <p className="text-[13px] text-muted">Paying now? After signing up, start your trial on {result.plan.name}, then pay from the Billing page whenever you are ready.</p>}
        </div>
      )}
    </GlassCard>
  );
}
