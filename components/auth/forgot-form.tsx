"use client";

import Link from "next/link";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { requestPasswordReset, verifyResetCode, type ForgotState } from "@/app/forgot-password/actions";
import { EmailCodeForm } from "./email-code-form";
import { useFieldErrors } from "./use-field-errors";

export default function ForgotForm({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {});
  // The form's one error is about the email.
  const fields = useFieldErrors(state, { email: state.error });

  if (state.sent && state.email) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-success-bg px-5 py-6 text-center">
        <MailCheck aria-hidden className="size-9 text-success" />
        <h2 className="text-lg font-semibold text-text">Check your email</h2>
        <p role="status" className="text-sm text-muted">
          If an account exists for <strong className="break-all text-text">{state.email}</strong>, we sent it a code and a link. Type the code here, or
          open the link. It may take a minute to arrive.
        </p>
        <EmailCodeForm action={verifyResetCode} email={state.email} submitLabel="Continue" />
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-semibold text-pulse-blue underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate onInput={fields.edit} className="flex flex-col gap-4">
      {notice && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {notice}
        </p>
      )}
      <Field label="Email" required error={fields.error("email")}>
        <Input name="email" type="email" autoComplete="email" placeholder="you@yourbusiness.com" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send code and link"}
      </Button>
      <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-pulse-blue underline">
        Back to sign in
      </Link>
    </form>
  );
}
