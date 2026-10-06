"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button, GlassCard, useToast } from "@/components/ui";
import { StepFields, type StepContext } from "./step-fields";
import { saveStep, STEP_TITLES, validateStep, type BrandValues, type Errors, type StepId } from "./steps";

/** One editable card on /dashboard/brand. Saves on its own. */
export function BrandSection({ step, initial, context }: { step: StepId; initial: BrandValues; context: StepContext }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const { title, description } = STEP_TITLES[step];

  function onChange(patch: Partial<BrandValues>) {
    setValues((v) => ({ ...v, ...patch }));
    setErrors({});
    setSaved(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateStep(step, values);
    setErrors(found);
    if (Object.keys(found).length) return;
    startTransition(async () => {
      const result = await saveStep(step, values);
      if (result.ok) {
        setSaved(true);
        toast(`${title} saved.`, "success");
      } else {
        setErrors(result.fieldErrors ?? {});
        toast(result.error ?? "Please check the highlighted fields.", "error");
      }
    });
  }

  return (
    <GlassCard as="section" aria-labelledby={`brand-${step}`} className="p-5 sm:p-6">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id={`brand-${step}`} className="text-lg font-semibold tracking-[-0.02em]">
            {title}
          </h2>
          <p className="text-[14px] text-muted">{description}</p>
        </div>
        <StepFields step={step} values={values} errors={errors} onChange={onChange} onBusyChange={setBusy} context={context} maxFaqs={10} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || busy}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted">
            {saved && (
              <>
                <Check aria-hidden className="size-4 text-success" /> Saved
              </>
            )}
          </span>
        </div>
      </form>
    </GlassCard>
  );
}
