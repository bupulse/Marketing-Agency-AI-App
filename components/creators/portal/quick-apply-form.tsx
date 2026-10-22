"use client";

import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Button, Field, GlassCard, Input } from "@/components/ui";
import type { QuickApplyState } from "@/app/c/[slug]/actions";
import { BRAND_BUTTON, FieldInput, type StartUpload, type Values } from "@/components/creators/apply/field-input";
import type { ApplicationForm, FormField } from "@/lib/creators/form-fields";
import { FormProblems, SamplesInput } from "./apply-form";

const initial: QuickApplyState = { status: "idle" };

const one = (v: Values[string]) => (Array.isArray(v) ? v[0] : v);

export type QuickPrefill = { firstName: string; lastName: string; phone: string | null; accounts: string[]; samples: number };

/**
 * One-tap applying on /c/<slug> for a signed-in creator (`apply`: quickApplyAction bound to the slug): their profile
 * fills the application (lib/creators/quick-apply-form.ts). When the company's form has required questions the
 * profile cannot answer, a short form asks just those, with the basics from the profile shown and editable; otherwise
 * it is one tap (the basics and the optional questions folded under "Change or add").
 */
export function QuickApplyForm(props: {
  apply: (prev: QuickApplyState, form: FormData) => Promise<QuickApplyState>;
  startUpload: StartUpload;
  form: ApplicationForm;
  asks: { fields: FormField[]; optional: FormField[]; samples: boolean };
  prefill: QuickPrefill;
  currency: string;
  companyName: string;
  slug: string;
}) {
  const { apply, startUpload, form, asks, prefill, currency, companyName, slug } = props;
  const [state, action, pending] = useActionState(apply, initial);
  const errors = state.errors ?? {};
  const values: Values = state.values ?? { firstName: prefill.firstName, lastName: prefill.lastName, phone: prefill.phone ?? "" };
  // After an error the basics stay open, so what needs fixing is in view.
  const short = asks.fields.length > 0 || asks.samples || Object.keys(errors).some((k) => k === "firstName" || k === "lastName" || k === "phone");

  if (state.status === "sent") {
    return (
      <GlassCard strong padding="lg" role="status" className="flex flex-col items-start gap-3">
        <CircleCheck aria-hidden className="size-9 text-success" />
        <h2 className="text-2xl font-bold tracking-tight">You applied</h2>
        <p className="text-muted">{companyName} reads every application. If they pick you, you join at once and get an email; the campaign shows on your Campaigns page.</p>
        <Button href="/creator" size="sm">Your campaigns</Button>
      </GlassCard>
    );
  }

  const basics = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required error={errors.firstName}>
          <Input name="firstName" autoComplete="given-name" defaultValue={one(values.firstName)} />
        </Field>
        <Field label="Last name" required error={errors.lastName}>
          <Input name="lastName" autoComplete="family-name" defaultValue={one(values.lastName)} />
        </Field>
      </div>
      {form.phone !== "HIDDEN" && (
        <Field label="WhatsApp number" required={form.phone === "REQUIRED"} error={errors.phone}>
          <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+250 791 954 277" defaultValue={one(values.phone)} />
        </Field>
      )}
      <p className="text-[13px] text-muted">
        Changes here are for this application only. {prefill.accounts.length > 0 && <>Your accounts: {prefill.accounts.join(" · ")}. </>}
        <Link href={`/creator/profile?next=/c/${slug}`} className="underline">Edit your profile</Link>
      </p>
    </div>
  );
  const optional = asks.optional.map((f) => <FieldInput key={f.id} field={f} values={values} error={errors[`q_${f.id}`]} currency={currency} startUpload={startUpload} />);

  return (
    <GlassCard strong padding="lg" className="p-5 sm:p-8">
      <form key={JSON.stringify(state.values ?? {})} action={action} noValidate className="flex flex-col gap-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Apply</h2>
          <p className="text-[13px] text-muted">
            {short ? "Your profile fills the rest: answer these and send." : `As ${prefill.firstName} ${prefill.lastName}, with your profile: your accounts, followers, best posts and WhatsApp number.`}
          </p>
        </div>
        {short ? (
          <>
            {basics}
            {asks.samples && <SamplesInput show="REQUIRED" values={values} errors={errors} />}
            {asks.fields.map((f) => (
              <FieldInput key={f.id} field={f} values={values} error={errors[`q_${f.id}`]} currency={currency} startUpload={startUpload} />
            ))}
            {optional.length > 0 && (
              <details className="group rounded-2xl border border-line p-4" open={asks.optional.some((f) => errors[`q_${f.id}`])}>
                <summary className="min-h-11 cursor-pointer text-[15px] font-semibold">More questions (optional)</summary>
                <div className="mt-3 flex flex-col gap-5">{optional}</div>
              </details>
            )}
          </>
        ) : (
          <details className="rounded-2xl border border-line p-4" open={Object.keys(errors).length > 0}>
            <summary className="min-h-11 cursor-pointer text-[15px] font-semibold">Change or add{optional.length ? " (optional questions)" : ""}</summary>
            <div className="mt-3 flex flex-col gap-5">
              {basics}
              {optional}
            </div>
          </details>
        )}
        <FormProblems state={state} />
        {state.incomplete && (
          <p className="text-sm">
            <Link href={`/creator/profile?next=/c/${slug}`} className="font-medium underline">Complete your profile</Link>
          </p>
        )}
        <Button type="submit" disabled={pending} className={`w-full sm:w-auto sm:self-start ${BRAND_BUTTON}`}>
          {pending ? "Sending…" : short ? "Send my application" : "Apply with my profile"}
        </Button>
        <p className="text-xs text-muted">{companyName} sees your profile and your answers. BuPulse keeps them for the campaign only.</p>
      </form>
    </GlassCard>
  );
}
