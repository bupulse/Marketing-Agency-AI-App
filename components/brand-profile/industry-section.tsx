"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { IndustryFields } from "@/components/auth/industry-fields";
import { fieldErrors, industrySchema, type FieldErrors } from "@/lib/auth/schemas";
import type { IndustryFieldValues, IndustryOption } from "@/lib/industries/shared";
import { saveIndustry, type IndustryState } from "@/app/dashboard/brand/actions";

/** /dashboard/brand: the sector and the description, editable by the owner (the country is not: see Settings). */
export function IndustrySection({ industries, initial }: { industries: IndustryOption[]; initial: IndustryFieldValues }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, formAction, pending] = useActionState<IndustryState, FormData>(saveIndustry, {});
  const [handled, setHandled] = useState<IndustryState | null>(null);

  if (state.fieldErrors && handled !== state) {
    setHandled(state);
    setErrors(state.fieldErrors);
  }

  function onChange(key: keyof IndustryFieldValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function submitAction() {
    const result = industrySchema.safeParse(values);
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    formAction(fd);
  }

  return (
    <GlassCard as="section" aria-labelledby="brand-industry" className="p-5 sm:p-6">
      <form noValidate action={submitAction} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="brand-industry" className="text-lg font-semibold tracking-[-0.02em]">
            Your industry
          </h2>
          <p className="text-[14px] text-muted">The sector and a short description of your business. BuPulse uses them for every post, plan and chat reply.</p>
        </div>
        {state.error && (
          <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
        <IndustryFields industries={industries} values={values} errors={errors} onChange={onChange} compact />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted">
            {state.saved && (
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
