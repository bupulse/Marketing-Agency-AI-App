"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { joinNewAction, joinSignedInAction, type JoinState } from "@/app/creator/join/[token]/actions";

/** A new creator login from the invite: the email is the application's, the name and password are theirs. */
export function JoinNewForm({ token, email, name }: { token: string; email: string; name: string }) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(joinNewAction, {});
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <Field label="Email">
        <Input value={email} readOnly disabled autoComplete="off" />
      </Field>
      <Field label="Your name" required error={state.fieldErrors?.name}>
        <Input name="name" autoComplete="name" defaultValue={name} />
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
        {pending ? "Joining…" : "Join the campaign"}
      </Button>
    </form>
  );
}

/** Signed in with the application's email: one button adds the campaign to their creator profile. */
export function JoinSignedInForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(joinSignedInAction, {});
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Adding…" : "Add the campaign to my login"}
      </Button>
    </form>
  );
}
