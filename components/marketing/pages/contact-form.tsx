"use client";

import { CircleCheck, Send } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, GlassCard, Input, Select, Textarea } from "@/components/ui";
import type { ContactFormState } from "@/lib/contact";
import { submitContactForm } from "./contact-action";

type ContactFormProps = {
  kind: "contact" | "done_for_you";
  industries: string[];
  submitLabel: string;
  messageLabel?: string;
  messageHint?: string;
  successTitle: string;
  successText: string;
};

const initial: ContactFormState = { status: "idle" };

export function ContactForm({ kind, industries, submitLabel, messageLabel = "Message", messageHint, successTitle, successText }: ContactFormProps) {
  const [state, action, pending] = useActionState(submitContactForm, initial);
  const errors = state.errors ?? {};
  const values = state.values ?? {};

  if (state.status === "success") {
    return (
      <GlassCard strong padding="lg" role="status" className="flex flex-col items-start gap-3">
        <CircleCheck aria-hidden className="size-9 text-success" />
        <h3 className="text-2xl font-bold tracking-tight">{successTitle}</h3>
        <p className="text-muted">{successText}</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard strong padding="lg">
      {/* Keyed by what came back: React resets a form after its action, and a select reset that way falls back to the
          first default it had, so the industry chosen would be lost after an error (as in the partner form). */}
      <form key={JSON.stringify(values)} action={action} noValidate className="flex flex-col gap-5">
        <input type="hidden" name="kind" value={kind} />
        {/* Honeypot: hidden from people and assistive tech, bots fill it in. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Your name" error={errors.name} required>
            <Input name="name" autoComplete="name" defaultValue={values.name} />
          </Field>
          <Field label="Email" error={errors.email} required>
            <Input name="email" type="email" autoComplete="email" defaultValue={values.email} />
          </Field>
        </div>

        {kind === "done_for_you" && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Phone" hint="Optional, only if you prefer a call." error={errors.phone}>
                <Input name="phone" type="tel" autoComplete="tel" defaultValue={values.phone} />
              </Field>
              <Field label="Business name" error={errors.businessName}>
                <Input name="businessName" autoComplete="organization" defaultValue={values.businessName} />
              </Field>
            </div>
            <Field label="Type of business" error={errors.industry}>
              <Select name="industry" defaultValue={values.industry ?? ""}>
                <option value="">Choose one</option>
                {industries.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value="Other">Something else</option>
              </Select>
            </Field>
          </>
        )}

        <Field label={messageLabel} hint={messageHint} error={errors.message} required>
          <Textarea name="message" rows={5} defaultValue={values.message} />
        </Field>

        {errors.form && (
          <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {errors.form}
          </p>
        )}

        <Button type="submit" size="lg" disabled={pending} trailing={<Send aria-hidden className="size-4" />}>
          {pending ? "Sending..." : submitLabel}
        </Button>
        <p className="text-[13px] text-muted">
          We only use your details to reply to you. See our <Link className="underline" href="/privacy">privacy policy</Link>.
        </p>
      </form>
    </GlassCard>
  );
}
