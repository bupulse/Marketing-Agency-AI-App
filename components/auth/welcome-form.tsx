"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";
import { fieldErrors, welcomeSchema, type FieldErrors } from "@/lib/auth/schemas";
import { saveOrganisation, type WelcomeState } from "@/app/welcome/actions";
import { OrganisationFields, TermsField, type OrganisationValues } from "./organisation-fields";

/** /welcome: organisation details for people who signed up with Google (no password needed). */
export function WelcomeForm({ email, defaults, trialDays = 7 }: { email: string; defaults: OrganisationValues; trialDays?: number }) {
  const [values, setValues] = useState({ ...defaults, terms: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, formAction, pending] = useActionState<WelcomeState, FormData>(saveOrganisation, {});
  const [handled, setHandled] = useState<WelcomeState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Show server-side validation errors under their fields.
  if (state.fieldErrors && handled !== state) {
    setHandled(state);
    setErrors(state.fieldErrors);
  }

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const result = welcomeSchema.safeParse(values);
    if (result.success) return;
    e.preventDefault();
    const found = fieldErrors(result.error);
    setErrors(found);
    const first = Object.keys(found)[0];
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus());
  }

  function submitAction() {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, String(v));
    formAction(fd);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">About your organisation</h1>
        <p className="text-[15px] text-muted">
          One last step before your {trialDays}-day trial. This helps us write in your brand voice from day one.
        </p>
      </div>

      <form ref={formRef} noValidate onSubmit={onSubmit} action={submitAction} className="flex flex-col gap-4">
        {state.error && (
          <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
        <OrganisationFields values={values} errors={errors} onChange={set} />
        <TermsField checked={values.terms} error={errors.terms} onChange={(v) => set("terms", v)} />
        <Button type="submit" disabled={pending} className="w-full" trailing={<ArrowRight aria-hidden className="size-4" />}>
          {pending ? "Saving…" : "Go to my dashboard"}
        </Button>
      </form>

      <form action="/auth/signout" method="post" className="text-sm text-muted">
        Signed in as <span className="font-medium text-text">{email}</span>.{" "}
        <button type="submit" className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline">
          Not you? Sign out
        </button>
      </form>
    </div>
  );
}
