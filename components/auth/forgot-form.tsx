"use client";

import Link from "next/link";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { requestPasswordReset, type ForgotState } from "@/app/forgot-password/actions";
import { useFieldErrors } from "./use-field-errors";

export default function ForgotForm() {
  const [state, formAction, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {});
  // The form's one error is about the email.
  const fields = useFieldErrors(state, { email: state.error });

  if (state.sent) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-2xl bg-success-bg px-5 py-6 text-center">
        <MailCheck aria-hidden className="size-9 text-success" />
        <h2 className="text-lg font-semibold text-text">Check your email</h2>
        <p className="text-sm text-muted">
          If an account exists for that address, we have sent a link to reset your password. It may take a minute to arrive.
        </p>
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-semibold text-pulse-blue underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate onInput={fields.edit} className="flex flex-col gap-4">
      <Field label="Email" required error={fields.error("email")}>
        <Input name="email" type="email" autoComplete="email" placeholder="you@yourbusiness.com" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-pulse-blue underline">
        Back to sign in
      </Link>
    </form>
  );
}
