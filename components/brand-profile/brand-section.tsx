"use client";

import { useState, useTransition } from "react";
import { Check, MessageCircle, Mic, Palette, ShoppingBag, type LucideIcon } from "lucide-react";
import { BPanel } from "@/components/app/kit/b-cards";
import { Button, useToast } from "@/components/ui";
import { StepFields, type StepContext } from "./step-fields";
import { saveStep, STEP_TITLES, validateStep, type BrandValues, type Errors, type StepId } from "./steps";

const ICON: Record<StepId, LucideIcon> = { offer: ShoppingBag, voice: Mic, look: Palette, knowledge: MessageCircle };

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
    <BPanel id={`brand-${step}`} icon={ICON[step]} title={title} hint={description}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <StepFields step={step} values={values} errors={errors} onChange={onChange} onBusyChange={setBusy} context={context} />
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
    </BPanel>
  );
}
