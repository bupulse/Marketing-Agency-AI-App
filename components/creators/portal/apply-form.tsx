"use client";

import { CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Button, Field, GlassCard, Input } from "@/components/ui";
import type { ApplyState } from "@/app/c/[slug]/actions";
import { BRAND_BUTTON, FieldInput, type StartUpload, type Values } from "@/components/creators/apply/field-input";
import { SocialsPicker } from "@/components/creators/apply/socials-picker";
import type { ApplicationForm } from "@/lib/creators/form-fields";

const initial: ApplyState = { status: "idle" };

const one = (v: Values[string]) => (Array.isArray(v) ? v[0] : v);

/** The links to their best posts, as the form shows them (required, optional or not asked). */
export function SamplesInput({ show, values, errors }: { show: ApplicationForm["samples"]; values: Values; errors: Partial<Record<string, string>> }) {
  if (show === "HIDDEN") return null;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[15px] font-semibold">
        Your best posts
        {show === "REQUIRED" && (
          <span aria-hidden className="ml-0.5 text-[color:var(--brand)]">
            *
          </span>
        )}
      </legend>
      <p className="-mt-1 text-[13px] text-muted">{show === "REQUIRED" ? "One to three links to posts you are proud of." : "Up to three links to posts you are proud of (optional)."}</p>
      {[1, 2, 3].map((i) => (
        <Field key={i} label={`Link ${i}`} required={show === "REQUIRED" && i === 1} error={errors[`sample_${i}`]}>
          <Input name={`sample_${i}`} type="url" inputMode="url" autoCapitalize="none" placeholder="https://www.instagram.com/p/…" defaultValue={one(values[`sample_${i}`])} />
        </Field>
      ))}
    </fieldset>
  );
}

/** The red line under a form that came back with errors, so a phone user knows to scroll up. */
export function FormProblems({ state }: { state: { error?: string; errors?: Partial<Record<string, string>> } }) {
  const text = state.error ?? (Object.keys(state.errors ?? {}).length ? "Some answers need a look: see the notes in red above." : null);
  if (!text) return null;
  return (
    <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
      {text}
    </p>
  );
}

/**
 * The application form of /c/<slug>, built from the company's form (lib/creators/form-fields.ts): first and last name,
 * email, WhatsApp number and best posts as the company set them, the social accounts, then the company's own fields.
 * `apply`: applyAction bound to the slug. `preview`: the company looking at a campaign that is not live (nothing is sent).
 */
export function ApplyForm({ apply, startUpload, form, platforms, currency, companyName, preview }: { apply: (prev: ApplyState, form: FormData) => Promise<ApplyState>; startUpload: StartUpload; form: ApplicationForm; platforms: string[]; currency: string; companyName: string; preview?: boolean }) {
  const [state, action, pending] = useActionState(apply, initial);
  const errors = state.errors ?? {};
  const values: Values = state.values ?? {};

  if (state.status === "sent") {
    return (
      <GlassCard strong padding="lg" role="status" className="flex flex-col items-start gap-3">
        <CircleCheck aria-hidden className="size-9 text-success" />
        <h2 className="text-2xl font-bold tracking-tight">Thank you, your application is in</h2>
        <p className="text-muted">
          {companyName} reads every application. If they pick you, you get an email with a link to make your creator login, then you see the tasks and start posting.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard strong padding="lg" className="p-5 sm:p-8">
      {/* Keyed by what came back, so the fields keep what was typed after an error (React resets a form after its action). */}
      <form key={JSON.stringify(values)} action={action} noValidate className="flex flex-col gap-6">
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Apply</h2>
          {form.intro && <p className="mt-1 whitespace-pre-wrap text-[15px] text-muted">{form.intro}</p>}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="First name" required error={errors.firstName}>
            <Input name="firstName" autoComplete="given-name" placeholder="Ana" defaultValue={one(values.firstName)} />
          </Field>
          <Field label="Last name" required error={errors.lastName}>
            <Input name="lastName" autoComplete="family-name" placeholder="Uwase" defaultValue={one(values.lastName)} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Email" required hint="It becomes your login if you are picked." error={errors.email}>
            <Input name="email" type="email" autoComplete="email" placeholder="ana@example.com" defaultValue={one(values.email)} />
          </Field>
          {form.phone !== "HIDDEN" && (
            <Field label="WhatsApp number" required={form.phone === "REQUIRED"} hint="The company may message you here." error={errors.phone}>
              <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+250 791 954 277" defaultValue={one(values.phone)} />
            </Field>
          )}
        </div>

        <SocialsPicker values={values} errors={errors} campaignNetworks={platforms} />
        <SamplesInput show={form.samples} values={values} errors={errors} />

        {form.fields.map((f) => (
          <FieldInput key={f.id} field={f} values={values} error={errors[`q_${f.id}`]} currency={currency} startUpload={startUpload} preview={preview} />
        ))}

        <FormProblems state={state} />
        {preview ? (
          <p role="status" className="rounded-field bg-soft px-4 py-3 text-sm font-medium">
            This is a preview: the campaign is not taking applications yet, so the form cannot be sent.
          </p>
        ) : (
          <Button type="submit" disabled={pending} className={`w-full sm:w-auto sm:self-start ${BRAND_BUTTON}`}>
            {pending ? "Sending…" : "Send my application"}
          </Button>
        )}
        <p className="text-xs text-muted">{companyName} sees what you write and send here. BuPulse keeps it for the campaign only.</p>
      </form>
    </GlassCard>
  );
}
