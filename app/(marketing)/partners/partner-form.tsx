"use client";

import { CircleCheck, Send } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, GlassCard, Input, Select, Textarea } from "@/components/ui";
import { PARTNER_KINDS, PARTNER_KIND_LABEL, type PartnerFormState } from "@/lib/partners/shared";
import { applyPartnerAction } from "./actions";

const initial: PartnerFormState = { status: "idle" };

/** The partner application (stored for the admin; nothing is emailed). */
export function PartnerForm() {
  const [state, action, pending] = useActionState(applyPartnerAction, initial);
  const errors = state.errors ?? {};
  const values = state.values ?? {};

  if (state.status === "success") {
    return (
      <GlassCard strong padding="lg" role="status" className="flex flex-col items-start gap-3">
        <CircleCheck aria-hidden className="size-9 text-success" />
        <h3 className="text-2xl font-bold tracking-tight">Thank you, we got your application</h3>
        <p className="text-muted">We read every application and call or message you on the number you gave, usually within a few working days. Once you are accepted you get your own link and a page with your clients and your commission.</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard strong padding="lg">
      {/* Keyed by what came back: React resets a form after its action, and a select (or checkbox) reset that way falls
          back to the first default it had, so the kind chosen would be lost after an error. A new key remounts the
          fields with the values the server returned. */}
      <form key={JSON.stringify(values)} action={action} noValidate className="flex flex-col gap-5">
        {/* Honeypot: hidden from people and assistive tech, bots fill it in. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <Field label="What kind of partner are you?" error={errors.kind} required>
          <Select name="kind" defaultValue={values.kind ?? ""}>
            <option value="">Choose one</option>
            {PARTNER_KINDS.map((k) => (
              <option key={k} value={k}>
                {PARTNER_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Your name" error={errors.name} required>
            <Input name="name" autoComplete="name" defaultValue={values.name} />
          </Field>
          <Field label="Business or organisation" hint="Optional" error={errors.organisation}>
            <Input name="organisation" autoComplete="organization" defaultValue={values.organisation} />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Email" error={errors.email} required>
            <Input name="email" type="email" autoComplete="email" defaultValue={values.email} />
          </Field>
          <Field label="Mobile Money number" hint="We pay your commission here." error={errors.phone} required>
            <Input name="phone" type="tel" autoComplete="tel" placeholder="+250 788 123 456" defaultValue={values.phone} />
          </Field>
        </div>

        <Field label="Town or district" hint="Optional" error={errors.city}>
          <Input name="city" defaultValue={values.city} />
        </Field>

        <Field label="How will you find clients for BuPulse?" hint="Optional. For example: our co-working members, the shops on my street, our agency's clients." error={errors.message}>
          <Textarea name="message" rows={4} defaultValue={values.message} />
        </Field>

        <label className="flex items-start gap-3 text-[15px]">
          <input type="checkbox" name="agree" value="yes" defaultChecked={values.agree === "yes"} className="mt-1 size-4" aria-invalid={errors.agree ? true : undefined} />
          <span>
            I accept the partner terms above: commission only on payments that arrive, no spam, and no paying to my own account by clients.
          </span>
        </label>
        {errors.agree && <p className="-mt-3 text-sm font-medium text-danger">{errors.agree}</p>}

        {errors.form && (
          <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {errors.form}
          </p>
        )}

        <Button type="submit" size="lg" disabled={pending} trailing={<Send aria-hidden className="size-4" />}>
          {pending ? "Sending..." : "Apply to become a partner"}
        </Button>
        <p className="text-[13px] text-muted">
          We only use your details to review your application and to pay your commission. See our <Link className="underline" href="/privacy">privacy policy</Link>.
        </p>
      </form>
    </GlassCard>
  );
}
