"use client";

import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Button, Field, GlassCard, Textarea } from "@/components/ui";
import type { QuickApplyState } from "@/app/c/[slug]/actions";
import type { CampaignQuestion } from "@/lib/creators/company-forms";

const initial: QuickApplyState = { status: "idle" };

/**
 * One-tap applying on /c/<slug> for a signed-in creator (`apply`: quickApplyAction bound to the slug): their profile
 * fills the application, so only the company's own questions are asked.
 */
export function QuickApplyForm({ apply, questions, companyName, profileName, slug }: { apply: (prev: QuickApplyState, form: FormData) => Promise<QuickApplyState>; questions: CampaignQuestion[]; companyName: string; profileName: string; slug: string }) {
  const [state, action, pending] = useActionState(apply, initial);
  const errors = state.errors ?? {};
  const values = state.values ?? {};

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

  return (
    <GlassCard strong padding="lg" className="p-5 sm:p-8">
      <form key={JSON.stringify(values)} action={action} noValidate className="flex flex-col gap-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Apply</h2>
          <p className="text-[13px] text-muted">
            As {profileName}, with your profile: your accounts, followers, best posts and WhatsApp number. <Link href={`/creator/profile?next=/c/${slug}`} className="underline">Check your profile</Link>
          </p>
        </div>
        {questions.map((q) => (
          <Field key={q.id} label={q.label} required={q.required} error={errors[`q_${q.id}`]}>
            <Textarea name={`q_${q.id}`} rows={3} defaultValue={values[`q_${q.id}`]} />
          </Field>
        ))}
        {state.error && (
          <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {state.error} {state.incomplete && <Link href={`/creator/profile?next=/c/${slug}`} className="underline">Complete your profile</Link>}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:self-start">
          {pending ? "Sending…" : "Apply with my profile"}
        </Button>
        <p className="text-xs text-muted">{companyName} sees your profile and your answers. BuPulse keeps them for the campaign only.</p>
      </form>
    </GlassCard>
  );
}
