"use client";

import Link from "next/link";
import { useActionState } from "react";
import { GoogleIcon } from "@/components/auth/google-icon";
import { PasswordInput } from "@/components/auth/password-input";
import { ResendButton } from "@/components/auth/resend-button";
import { Button, Field, Input } from "@/components/ui";
import { signInWithGoogle, signInWithPassword, type LoginState } from "./actions";

export default function LoginForm({ next, defaultEmail }: { next: string; defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signInWithPassword, {});

  return (
    <div className="flex flex-col gap-5">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="white" size="lg" className="w-full" leading={<GoogleIcon />}>
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        {state.error && (
          <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
        {state.unconfirmedEmail && (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-2xl bg-danger-bg px-4 py-3 text-sm text-danger">
            <p className="font-medium">Please confirm your email first. We sent a link to {state.unconfirmedEmail}.</p>
            <ResendButton email={state.unconfirmedEmail} />
          </div>
        )}
        <Field label="Email" required error={state.fieldErrors?.email}>
          <Input name="email" type="email" autoComplete="email" placeholder="you@yourbusiness.com" defaultValue={defaultEmail} />
        </Field>
        <Field label="Password" required error={state.fieldErrors?.password}>
          <PasswordInput name="password" autoComplete="current-password" />
        </Field>
        <Link href="/forgot-password" className="-mt-2 inline-flex min-h-11 items-center self-start text-sm font-semibold text-pulse-blue underline">
          Forgot password?
        </Link>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-sm text-muted">
        New to BuPulse?{" "}
        <Link href="/signup" className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
