"use client";

import { CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Button, Field, GlassCard, Input, Textarea } from "@/components/ui";
import type { ApplyState } from "@/app/c/[slug]/actions";
import { NETWORK_LABEL, isCreatorNetwork } from "@/lib/creators/describe";
import type { CampaignQuestion } from "@/lib/creators/company-forms";

const initial: ApplyState = { status: "idle" };

/** The application form of /c/<slug> (`apply`: applyAction bound to the slug). `preview`: the company looking at a campaign that is not live (nothing is sent). */
export function ApplyForm({ apply, platforms, questions, companyName, preview }: { apply: (prev: ApplyState, form: FormData) => Promise<ApplyState>; platforms: string[]; questions: CampaignQuestion[]; companyName: string; preview?: boolean }) {
  const [state, action, pending] = useActionState(apply, initial);
  const errors = state.errors ?? {};
  const values = state.values ?? {};

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

  const networks = platforms.filter(isCreatorNetwork);
  return (
    <GlassCard strong padding="lg" className="p-5 sm:p-8">
      {/* Keyed by what came back, so the fields keep what was typed after an error (React resets a form after its action). */}
      <form key={JSON.stringify(values)} action={action} noValidate className="flex flex-col gap-5">
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Apply</h2>

        <Field label="Your name" required error={errors.name}>
          <Input name="name" autoComplete="name" defaultValue={values.name} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="WhatsApp number" required hint="The company may message you here." error={errors.phone}>
            <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+250 791 954 277" defaultValue={values.phone} />
          </Field>
          <Field label="Email" required hint="It becomes your login if you are picked." error={errors.email}>
            <Input name="email" type="email" autoComplete="email" defaultValue={values.email} />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-[15px] font-semibold">Your accounts</legend>
          <p className="-mt-2 text-[13px] text-muted">At least one. The name you use there, and how many followers you have.</p>
          {networks.map((n) => (
            <div key={n} className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <Field label={`${NETWORK_LABEL[n]} name`} error={errors[`handle_${n}`]}>
                <Input name={`handle_${n}`} placeholder="@yourname" autoCapitalize="none" autoCorrect="off" defaultValue={values[`handle_${n}`]} />
              </Field>
              <Field label="Followers" error={errors[`followers_${n}`]}>
                <Input name={`followers_${n}`} inputMode="numeric" placeholder="12k" defaultValue={values[`followers_${n}`]} />
              </Field>
            </div>
          ))}
          {errors.handles && (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {errors.handles}
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[15px] font-semibold">Your best posts</legend>
          <p className="-mt-1 text-[13px] text-muted">One to three links to posts you are proud of.</p>
          {[1, 2, 3].map((i) => (
            <Field key={i} label={`Link ${i}`} required={i === 1} error={errors[`sample_${i}`]}>
              <Input name={`sample_${i}`} type="url" inputMode="url" placeholder="https://" defaultValue={values[`sample_${i}`]} />
            </Field>
          ))}
        </fieldset>

        {questions.map((q) => (
          <Field key={q.id} label={q.label} required={q.required} error={errors[`q_${q.id}`]}>
            <Textarea name={`q_${q.id}`} rows={3} defaultValue={values[`q_${q.id}`]} />
          </Field>
        ))}

        {state.error && (
          <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
        {preview ? (
          <p role="status" className="rounded-field bg-soft px-4 py-3 text-sm font-medium">
            This is a preview: the campaign is not taking applications yet, so the form cannot be sent.
          </p>
        ) : (
          <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:self-start">
            {pending ? "Sending…" : "Send my application"}
          </Button>
        )}
        <p className="text-xs text-muted">
          {companyName} sees what you write here. BuPulse keeps it for the campaign only.
        </p>
      </form>
    </GlassCard>
  );
}
