"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { acceptInviteAction, type AcceptState } from "@/app/invite/[token]/actions";

export function InviteForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState<AcceptState, FormData>(acceptInviteAction, {});
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <Field label="Email">
        <Input value={email} readOnly disabled autoComplete="off" />
      </Field>
      <Field label="Your name" required error={state.fieldErrors?.name}>
        <Input name="name" autoComplete="name" />
      </Field>
      <Field label="Choose a password" required hint="At least 8 characters with a letter and a number." error={state.fieldErrors?.password}>
        <Input name="password" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm password" required error={state.fieldErrors?.confirmPassword}>
        <Input name="confirmPassword" type="password" autoComplete="new-password" />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Joining…" : "Join the team"}
      </Button>
    </form>
  );
}
