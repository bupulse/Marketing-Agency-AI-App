"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { sendAdminCode, verifyAdminCode, type AdminLoginState } from "./actions";

/** Email → emailed code. The page after it asks for the authenticator code. */
export function AdminLoginForm() {
  const [sent, sendAction, sending] = useActionState<AdminLoginState, FormData>(sendAdminCode, {});
  const [checked, verifyAction, verifying] = useActionState<AdminLoginState, FormData>(verifyAdminCode, {});
  const email = checked.sentTo ?? sent.sentTo;

  if (!email) {
    return (
      <form action={sendAction} className="flex flex-col gap-4">
        <Field label="Admin email" error={sent.error}>
          <Input name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Button type="submit" disabled={sending} className="w-full">
          {sending ? "Sending…" : "Continue"}
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] text-muted">
        If <strong className="text-text">{email}</strong> is an admin address, we emailed it a sign-in code. Enter it below. Nothing after two minutes? Check spam, then send a new code.
      </p>
      <form action={verifyAction} className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <Field label="Code from the email" error={checked.error}>
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            maxLength={10}
            autoFocus
            className="text-center text-2xl tracking-[0.3em] tabular-nums"
          />
        </Field>
        <Button type="submit" disabled={verifying} className="w-full">
          {verifying ? "Checking…" : "Continue"}
        </Button>
      </form>
      <form action={sendAction}>
        <input type="hidden" name="email" value={email} />
        <button type="submit" disabled={sending} className="w-full cursor-pointer text-center text-sm text-muted underline">
          {sending ? "Sending…" : "Send a new code"}
        </button>
      </form>
    </div>
  );
}
