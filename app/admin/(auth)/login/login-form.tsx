"use client";

import { useActionState } from "react";
import { PasswordInput } from "@/components/auth/password-input";
import { Button, Field, Input } from "@/components/ui";
import { adminSignIn, type AdminLoginState } from "./actions";

export function AdminLoginForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState<AdminLoginState, FormData>(adminSignIn, {});
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <Field label="Email" error={state.fieldErrors?.email}>
        <Input name="email" type="email" autoComplete="username" defaultValue={defaultEmail} required autoFocus />
      </Field>
      <Field label="Password" error={state.fieldErrors?.password}>
        <PasswordInput name="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Continue"}
      </Button>
    </form>
  );
}
