"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { createDraftAction, saveStepAction, suggestCampaignAction } from "@/app/dashboard/creators/actions";
import { Button, GlassCard, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { campaignNetworks } from "@/lib/creators/networks";
import { STEP_COUNT, stepNumber, WIZARD_STEPS, type WizardStepId } from "@/lib/creators/wizard";
import { checkStep, progressLabel, stepInput, type StepInput, type WizardAnswers } from "@/lib/creators/wizard-steps";
import { stepFromSuggestion, SUGGEST_STEPS, type CampaignSuggestion } from "@/lib/creators/wizard-suggest";
import type { PickOption } from "./controls";
import { SuggestButton } from "./controls";
import { FilesStep, type FolderView } from "./files-step";
import { FormStep } from "./form-builder";
import { LookStep, type BrandLook } from "./look-step";
import { ReviewStep } from "./review-step";
import { ContentStep, PayStep, RulesStep } from "./steps-content";
import { CreatorsStep, GoalStep, IdeaStep, WhenStep, WhereStep } from "./steps-setup";

/** What every step may need besides the answers: the company's lists, the plan, the brand, the files. */
export type WizardOptions = {
  /** Null on step 1 of a new campaign (Next makes the draft). */
  campaignId: string | null;
  slug: string | null;
  status: string;
  /** Set up already (Settings, or a draft past Review): every step can be opened. */
  editing: boolean;
  /** The furthest step reached (1-12). */
  reached: number;
  today: string;
  creatorsPerCampaign: number;
  networks: ReturnType<typeof campaignNetworks>;
  products: PickOption[];
  knowledgeCampaigns: PickOption[];
  ideaExamples: string[];
  /** The business's industry: quick mode makes the idea examples again from the products picked. */
  industry?: string | null;
  /** "@leafjuice": the business's Instagram handle as a mention. */
  handle: string | null;
  brand: BrandLook;
  folders: FolderView[] | null;
  counts: { images: number; videos: number; documents: number };
  cover: { url: string; kind: string; posterUrl: string | null } | null;
  problems: string[];
};

export type StepProps = {
  a: WizardAnswers;
  set: (patch: Partial<WizardAnswers>) => void;
  o: WizardOptions;
  /** The last suggestion of this visit ("Suggest again"), for chips such as the AI's do's and form fields. */
  suggestion: CampaignSuggestion | null;
  suggest: (only?: (keyof WizardAnswers)[]) => Promise<void>;
  suggesting: boolean;
};

const BODIES: Record<WizardStepId, (p: StepProps) => ReactNode> = {
  idea: IdeaStep,
  goal: GoalStep,
  creators: CreatorsStep,
  where: WhereStep,
  when: WhenStep,
  content: ContentStep,
  rules: RulesStep,
  pay: PayStep,
  form: FormStep,
  files: FilesStep,
  look: LookStep,
  review: ReviewStep,
};

const setupUrl = (id: string, n: number) => `/dashboard/creators/${id}/setup?step=${n}`;

/**
 * One step of the campaign wizard: the progress bar, the steps (open the ones reached; all when editing), the step's
 * question and inputs, "Suggest again", and Back / Next, which save the step first.
 */
export function CampaignWizard({
  step,
  initial,
  options,
  quickHref,
  returnHref,
}: {
  step: WizardStepId;
  initial: WizardAnswers;
  options: WizardOptions;
  /** Quick mode for this campaign (docs/QUIZ_MODE.md): "Prefer quick setup?". */
  quickHref?: string;
  /** Opened from quick mode's "Change": "Save and back to quick setup" returns there. */
  returnHref?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [a, setA] = useState(initial);
  const [busy, setBusy] = useState<null | "save" | "create">(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<CampaignSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const saved = useRef(JSON.stringify(stepInput(step, initial)));
  const n = stepNumber(step);
  const meta = WIZARD_STEPS[n - 1];
  const o = options;
  const set = (patch: Partial<WizardAnswers>) => {
    setError(null);
    setA((cur) => ({ ...cur, ...patch }));
  };

  async function suggest(only?: (keyof WizardAnswers)[]) {
    setSuggesting(true);
    const r = await suggestCampaignAction(o.campaignId, step, { ...a, platforms: a.platforms });
    setSuggesting(false);
    if (!r.ok) return toast(r.error, "error");
    setSuggestion(r.suggestion);
    const patch = stepFromSuggestion(step, r.suggestion, a, { creatorsPerCampaign: o.creatorsPerCampaign, today: o.today });
    set(only ? Object.fromEntries(Object.entries(patch).filter(([k]) => only.includes(k as keyof WizardAnswers))) : patch);
    toast(r.suggestion.source === "ai" ? "New ideas are in. Change anything you like." : "Here is a starting point. The AI is not available right now.", "success");
  }

  /** Saves the step (always on Next: it moves the draft on), then opens `target`. */
  async function go(target: number | "close" | "return", { force = false } = {}) {
    const input = stepInput(step, a);
    const checked = checkStep(step, input);
    const dirty = JSON.stringify(input) !== saved.current;
    if (!o.campaignId) {
      if (!checked.ok) return setError(checked.error);
      setBusy("create");
      const r = await createDraftAction(input as StepInput<"idea">);
      if (!r.ok) {
        setBusy(null);
        return setError(r.error);
      }
      toast(r.ai ? "Your campaign is drafted. Check each step and change what you like." : "Your draft is ready with our starting ideas. Check each step.", "success");
      router.push(setupUrl(r.id, 2));
      return;
    }
    if (force || dirty) {
      if (!checked.ok) return setError(checked.error);
      setBusy("save");
      const r = await saveStepAction(o.campaignId, step, input);
      if (!r.ok) {
        setBusy(null);
        return setError(r.error);
      }
      saved.current = JSON.stringify(input);
    }
    router.push(target === "return" && returnHref ? returnHref : target === "close" || target === "return" ? `/dashboard/creators/${o.campaignId}/settings` : setupUrl(o.campaignId, target));
  }

  const Body = BODIES[step];
  const can = (k: number) => o.campaignId !== null && k !== n && (o.editing || k <= o.reached);
  const pct = Math.round((n / STEP_COUNT) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 px-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] font-semibold text-muted" aria-live="polite">
            {progressLabel(step)}
          </p>
          <div className="flex flex-wrap items-center gap-x-4">
            {quickHref && !returnHref && (
              <Link href={quickHref} className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-text underline underline-offset-2">
                <Sparkles aria-hidden className="size-4 text-pulse-violet" /> Prefer quick setup?
              </Link>
            )}
            {o.campaignId && !returnHref && (
              <Link href={o.editing ? `/dashboard/creators/${o.campaignId}/settings` : "/dashboard/creators"} className="inline-flex min-h-11 items-center text-[14px] font-medium text-muted no-underline hover:text-text">
                {o.editing ? "Back to settings" : "Saved. Finish later"}
              </Link>
            )}
            {returnHref && (
              <Link href={returnHref} className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-muted no-underline hover:text-text">
                <ArrowLeft aria-hidden className="size-4" /> Back to quick setup
              </Link>
            )}
          </div>
        </div>
        <div role="progressbar" aria-label="Campaign set-up" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-500 ease-out-soft motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Steps" className="-mx-1 overflow-x-auto px-1 lg:sticky lg:top-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <ol className="flex w-max gap-1.5 lg:w-auto lg:flex-col">
            {WIZARD_STEPS.map((s, i) => {
              const k = i + 1;
              const here = k === n;
              const done = k < n || (o.editing && !here) || k < o.reached;
              const body = (
                <>
                  <span aria-hidden className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold", here ? "bg-white/25 text-white" : done ? "bg-success-bg text-success" : "bg-soft text-muted")}>
                    {done && !here ? <Check className="size-3.5" /> : k}
                  </span>
                  <span>{s.title}</span>
                </>
              );
              const cls = cn("inline-flex min-h-11 items-center gap-2 rounded-full px-3 pr-4 text-[14px] font-semibold whitespace-nowrap no-underline lg:w-full", here ? "bg-brand-gradient text-white shadow-glow" : "text-muted");
              return (
                <li key={s.id}>
                  {can(k) ? (
                    <button type="button" disabled={busy !== null} onClick={() => go(k)} className={cn(cls, "cursor-pointer hover:bg-soft hover:text-text")}>
                      {body}
                    </button>
                  ) : (
                    <span aria-current={here ? "step" : undefined} aria-disabled={!here || undefined} className={cn(cls, !here && "opacity-60")}>
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <GlassCard as="section" aria-labelledby="wizard-question" className="relative flex min-w-0 flex-col gap-6 p-5 sm:p-7">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 id="wizard-question" className="text-[24px] font-semibold leading-tight tracking-[-0.03em] sm:text-[28px]">
                {meta.question}
              </h1>
              {step === "idea" && <p className="text-[15px] text-muted">One line is enough. The AI fills the next steps from it and your Business info; you check and change anything.</p>}
            </div>
            {o.campaignId && SUGGEST_STEPS.includes(step) && step !== "idea" && <SuggestButton onClick={() => void suggest()} busy={suggesting} />}
          </header>

          <Body a={a} set={set} o={o} suggestion={suggestion} suggest={suggest} suggesting={suggesting} />

          {error && (
            <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[15px] font-medium text-danger">
              {error}
            </p>
          )}

          {step !== "review" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              {n > 1 && o.campaignId ? (
                <Button variant="outline" disabled={busy !== null} leading={<ArrowLeft aria-hidden className="size-4" />} onClick={() => go(n - 1)}>
                  Back
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-wrap gap-2">
                {returnHref && o.campaignId && (
                  <Button disabled={busy !== null} leading={<Check aria-hidden className="size-4" />} onClick={() => go("return", { force: true })}>
                    {busy === "save" ? "Saving…" : "Save and back to quick setup"}
                  </Button>
                )}
                {o.editing && o.campaignId && !returnHref && (
                  <Button variant="outline" disabled={busy !== null} onClick={() => go("close", { force: true })}>
                    Save and close
                  </Button>
                )}
                <Button variant={returnHref ? "outline" : "primary"} disabled={busy !== null} trailing={busy ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <ArrowRight aria-hidden className="size-4" />} onClick={() => go(n + 1, { force: true })}>
                  {busy === "save" ? "Saving…" : busy === "create" ? "Writing your campaign…" : "Next"}
                </Button>
              </div>
            </div>
          )}

          {busy === "create" && (
            <div role="status" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-glass bg-surface/90 p-6 text-center backdrop-blur-sm">
              <Sparkles aria-hidden className="size-8 animate-pulse text-pulse-violet motion-reduce:animate-none" />
              <p className="text-[18px] font-semibold">Writing your campaign…</p>
              <p className="max-w-sm text-[15px] text-muted">The AI is filling the next steps from your idea and your Business info. It takes a few seconds.</p>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
