"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useActionState } from "react";
import { requestCustomPlanAction, type RequestState } from "@/app/custom-plan/actions";
import { Badge, Button, Field, GlassCard, Input, Select, Textarea } from "@/components/ui";
import { BUDGET_RANGES, REQUESTABLE_FEATURES, type RequestSource } from "@/lib/offers/shared";

/** The custom plan request: the business, its goals, the features it is interested in, an optional budget range. */
export function CustomPlanForm({ source, initial, back }: { source: RequestSource; initial: { description: string; phone: string; features: string[] }; back: { href: string; label: string } }) {
  const [state, formAction, pending] = useActionState<RequestState, FormData>(requestCustomPlanAction, {});

  if (state.done) {
    return (
      <GlassCard role="status" className="flex flex-col items-start gap-3 p-6">
        <CheckCircle2 aria-hidden className="size-8 text-success" />
        <h2 className="text-lg font-semibold">Thanks, we have your request</h2>
        <p className="text-[15px] text-muted">We will look at what you need and come back to you, usually within a working day, with an offer in Billing (and by email).</p>
        <Button href={back.href}>{back.label}</Button>
      </GlassCard>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="source" value={source} />
      <Field label="What does your business do?" hint="What you sell, who your customers are, where you are.">
        <Textarea name="description" rows={4} defaultValue={initial.description} minLength={10} maxLength={2000} required />
      </Field>
      <Field label="What do you want to achieve?" hint="For example: more orders on WhatsApp, a post every day, answering website visitors.">
        <Textarea name="goals" rows={4} minLength={10} maxLength={2000} required />
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">What are you interested in?</legend>
        <p className="mb-2 text-[13px] text-muted">Tick what you would like. We add anything a feature needs.</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {REQUESTABLE_FEATURES.map((f) => (
            <label key={f.key} className="flex min-h-11 items-start gap-2 text-[15px]">
              <input type="checkbox" name="features" value={f.key} defaultChecked={initial.features.includes(f.key)} className="mt-1 size-5" />
              <span>
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="font-medium">{f.label}</strong>
                  {f.soon && <Badge tone="violet">Coming soon</Badge>}
                </span>
                <span className="block text-[13px] text-muted">{f.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Budget per month (optional)">
          <Select name="budget" defaultValue="">
            <option value="">Prefer not to say</option>
            {BUDGET_RANGES.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phone or WhatsApp (optional)">
          <Input name="phone" type="tel" defaultValue={initial.phone} maxLength={40} autoComplete="tel" />
        </Field>
      </div>
      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send my request"}
        </Button>
        <Link href={back.href} className="text-sm text-muted underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
