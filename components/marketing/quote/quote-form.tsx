"use client";

import { CircleCheck, Send } from "lucide-react";
import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { Button, Field, GlassCard, Input, PhoneInput, Textarea } from "@/components/ui";
import type { QuoteFormState } from "@/lib/quote/schema";
import { submitQuoteForm } from "./quote-action";

const initial: QuoteFormState = { status: "idle" };

type QuoteFormProps = {
  /** Where the person came from: "instagram" (from /quote?src=), "website" (the pop-up)... */
  source: string;
  /** The page it is sent from, a site path. */
  pageUrl: string;
  /** /quote shows the form on a card; the pop-up is a card already. */
  framed?: boolean;
  /** The pop-up's "Close" after the thank-you. */
  onClose?: () => void;
};

/**
 * "Get a free quote": name, phone, email, company and an optional note. BuPulse calls back, so the phone number is the
 * important part: Rwanda (+250) is picked for them and "0788 123 456" drops its 0, another country is one tap away;
 * the server stores it as +250...
 */
export function QuoteForm({ source, pageUrl, framed = false, onClose }: QuoteFormProps) {
  const [state, action, pending] = useActionState(submitQuoteForm, initial);
  const errors = state.errors ?? {};
  const values = state.values ?? {};
  // A plain function, not a component: a component made here would be a new type every render and remount the form.
  const frame = (node: ReactNode) =>
    framed ? (
      <GlassCard strong padding="lg">
        {node}
      </GlassCard>
    ) : (
      node
    );

  if (state.status === "success") {
    return frame(
      <div role="status" className="flex flex-col items-start gap-3">
        <CircleCheck aria-hidden className="size-9 text-success" />
        <h3 className="text-2xl font-bold tracking-tight">Thank you{state.firstName ? `, ${state.firstName}` : ""}!</h3>
        <p className="text-muted">
          We got your request. Someone from BuPulse will call you shortly on the number you gave us to understand your business and prepare your quote.
        </p>
        {onClose && (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </div>,
    );
  }

  return frame(
    <>
      {/* Keyed by what came back: React resets a form after its action, so the typed values come back as defaults. */}
      <form key={JSON.stringify(values)} action={action} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="pageUrl" value={pageUrl} />
        {/* Honeypot: hidden from people and assistive tech, bots fill it in. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <Field label="Full name" error={errors.name} required>
          <Input name="name" autoComplete="name" defaultValue={values.name} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <PhoneInput name="phone" label="Phone" hint="We call you on this number." error={errors.phone} required defaultValue={values.phone} />
          <Field label="Email" error={errors.email} required>
            <Input name="email" type="email" inputMode="email" autoComplete="email" defaultValue={values.email} />
          </Field>
        </div>
        <Field label="Company or business name" error={errors.businessName} required>
          <Input name="businessName" autoComplete="organization" defaultValue={values.businessName} />
        </Field>
        <Field label="Anything we should know?" hint="Optional: what you sell, what you need help with." error={errors.note}>
          <Textarea name="note" rows={3} defaultValue={values.note} />
        </Field>

        {errors.form && (
          <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {errors.form}
          </p>
        )}

        <Button type="submit" size="lg" disabled={pending} trailing={<Send aria-hidden className="size-4" />}>
          {pending ? "Sending..." : "Get my free quote"}
        </Button>
        <p className="text-[13px] text-muted">
          We only use your details to call you about your quote. See our{" "}
          <Link className="underline" href="/privacy">
            privacy policy
          </Link>
          .
        </p>
      </form>
    </>,
  );
}
