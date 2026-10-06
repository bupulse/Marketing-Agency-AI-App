"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { StepFields, type StepContext } from "@/components/brand-profile/step-fields";
import { saveStep, STEP_TITLES, validateStep, type BrandValues, type Errors, type StepId } from "@/components/brand-profile/steps";
import { finishOnboarding } from "@/app/onboarding/actions";

const STEPS: StepId[] = ["offer", "voice", "look", "knowledge"];

function Progress({ step }: { step: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium text-muted">
        <span aria-hidden>Step {step} of 4</span>
        <span className="sr-only">
          Step {step} of 4: {STEP_TITLES[STEPS[step - 1]].title}
        </span>
      </p>
      <ol aria-label="Onboarding progress" className="flex gap-2">
        {STEPS.map((id, i) => (
          <li key={id} aria-current={i + 1 === step ? "step" : undefined} className="flex flex-1 flex-col gap-1">
            <span className={cn("h-1.5 rounded-full transition-colors", i + 1 <= step ? "bg-brand-gradient" : "bg-line")} />
            <span className={cn("text-xs", i + 1 === step ? "font-semibold text-text" : "text-muted")}>
              {i + 1}. {STEP_TITLES[id].short}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** /onboarding: four short steps. Each Continue saves to the database, so a refresh resumes where you were. */
export function OnboardingWizard({
  initial,
  initialStep,
  context,
}: {
  initial: BrandValues;
  initialStep: number;
  context: StepContext;
}) {
  const [step, setStep] = useState(initialStep);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  const id = STEPS[step - 1];
  const { title, description } = STEP_TITLES[id];
  const last = step === STEPS.length;
  const lookEmpty = id === "look" && !values.logoPath && values.brandColors.length === 0;

  // Move focus to the new step's heading so screen readers announce the change.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function onChange(patch: Partial<BrandValues>) {
    setValues((v) => ({ ...v, ...patch }));
    setErrors({});
    setError("");
  }

  function goTo(next: number) {
    setErrors({});
    setError("");
    setStep(next);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = validateStep(id, values);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      const form = e.currentTarget;
      requestAnimationFrame(() => form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus());
      return;
    }
    startTransition(async () => {
      const result = await saveStep(id, values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error ?? "");
        return;
      }
      if (!last) return goTo(step + 1);
      // Redirects to the dashboard on success.
      const done = await finishOnboarding();
      if (!done.ok) setError(done.error ?? "We could not finish. Please try again.");
    });
  }

  return (
    <>
      <Progress step={step} />
      <div className="flex flex-col gap-1.5">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-[-0.03em] outline-none">
          {title}
        </h1>
        <p className="text-[15px] text-muted">{description}</p>
        {id === "offer" && (
          <p className="text-[13px] text-muted">
            For <span className="font-medium text-text">{context.businessName}</span>
            {context.industry ? <> ({context.industry})</> : null}
          </p>
        )}
      </div>

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {error && (
          <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <StepFields step={id} values={values} errors={errors} onChange={onChange} onBusyChange={setBusy} context={context} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {step > 1 ? (
            <Button variant="ghost" leading={<ArrowLeft aria-hidden className="size-4" />} disabled={pending} onClick={() => goTo(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {lookEmpty && (
              <Button variant="outline" disabled={pending || busy} onClick={() => goTo(step + 1)}>
                I&apos;ll add these later
              </Button>
            )}
            <Button type="submit" disabled={pending || busy} trailing={last ? undefined : <ArrowRight aria-hidden className="size-4" />}>
              {pending ? "Saving…" : last ? "Finish" : "Continue"}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
