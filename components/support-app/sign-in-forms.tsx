"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Button, Field, Input } from "@/components/ui";
import {
  confirmAgentEnrollCode,
  confirmAgentEnrollment,
  forgotAgentPassword,
  openEmailLink,
  passwordFlowCode,
  sendAgentEnrollCode,
  setAgentPassword,
  signInAgent,
  startAgentEnrollment,
  type EnrollState,
  type ForgotState,
  type PasswordFlowState,
  type SignInState,
} from "@/app/support/(auth)/actions";
import { alertClass } from "./auth-shell";
import { useSupportHref } from "./base";
import { SupportCodeForm } from "./code-form";

/** Step 1 of 2: work email and password. */
export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAgent, {});
  const href = useSupportHref();
  return (
    <form action={action} className="flex flex-col gap-3.5">
      <Field label="Work email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password" error={state.error}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Continue"}
      </Button>
      <Link href={href("/forgot")} className="self-center text-[13px] text-ok underline-offset-2 hover:underline">
        Forgot password?
      </Link>
    </form>
  );
}

/** Adding the authenticator: an emailed code first unless this session just opened an emailed link, then the QR code. */
export function SetupAuthenticator({ emailConfirmed, email }: { emailConfirmed: boolean; email: string }) {
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [needEmail, setNeedEmail] = useState(!emailConfirmed);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (needEmail) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px]">
          First, confirm it is you. We email a code to <strong>{email}</strong>: a password alone cannot add an authenticator.
        </p>
        {error && <p role="alert" className={alertClass}>{error}</p>}
        <Button
          variant={sent ? "outline" : "primary"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await sendAgentEnrollCode();
              setError(r.error ?? null);
              if (!r.error) setSent(true);
            })
          }
        >
          {pending ? "Sending…" : sent ? "Send a new code" : "Email me a code"}
        </Button>
        {sent && <SupportCodeForm action={confirmAgentEnrollCode} label="Confirm email" digits={8} fieldLabel="Code from the email" />}
      </div>
    );
  }

  if (!enroll?.factorId) {
    return (
      <div className="flex flex-col gap-4">
        {enroll?.error && <p role="alert" className={alertClass}>{enroll.error}</p>}
        <Button
          disabled={pending}
          className="w-full"
          onClick={() =>
            start(async () => {
              const r = await startAgentEnrollment();
              if (r.needEmail) setNeedEmail(true);
              else setEnroll(r);
            })
          }
        >
          {pending ? "Preparing…" : "Show my QR code"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[15px]">
        <li>In your authenticator app choose Add account, then scan this code.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex justify-center">
        {/* Data URI from Supabase; a plain img keeps it simple. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enroll.qr} alt="QR code to add BuPulse Support to your authenticator app" width={192} height={192} className="rounded-2xl bg-white p-2" />
      </div>
      <details className="text-sm text-muted">
        <summary className="min-h-11 cursor-pointer py-2.5 font-medium text-text">Can’t scan? Enter the key by hand</summary>
        <code className="mt-1 block break-all rounded-xl bg-soft px-3 py-2 font-mono text-text select-all">{enroll.secret}</code>
      </details>
      <SupportCodeForm action={confirmAgentEnrollment} label="Turn on the 6-digit code" factorId={enroll.factorId} />
    </div>
  );
}

/**
 * The invite and "Forgot password" link: Continue opens it, then the authenticator code if one is set, then the new
 * password. `initial` is "password" when this session already opened the link (a reload).
 */
export function PasswordFlow({ tokenHash, type, initial, cta }: { tokenHash: string; type: string; initial: PasswordFlowState["step"]; cta: string }) {
  const [opened, openAction, opening] = useActionState<PasswordFlowState, FormData>(openEmailLink, { step: initial });
  const [coded, codeAction, checking] = useActionState<PasswordFlowState, FormData>(passwordFlowCode, {});
  const [saved, saveAction, saving] = useActionState<PasswordFlowState, FormData>(setAgentPassword, {});
  const href = useSupportHref();
  // The furthest step reached wins; a step's own error keeps it on that step.
  const step = saved.step ?? coded.step ?? opened.step ?? "start";
  const error = saved.error ?? coded.error ?? opened.error;

  if (step === "start") {
    return (
      <form action={openAction} className="flex flex-col gap-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        {error && <p role="alert" className={alertClass}>{error}</p>}
        <Button type="submit" disabled={opening || !tokenHash} className="w-full">
          {opening ? "Opening…" : cta}
        </Button>
        {error && (
          <Link href={href("/forgot")} className="self-center text-[13px] text-ok underline-offset-2 hover:underline">
            Forgot password?
          </Link>
        )}
      </form>
    );
  }
  if (step === "code") {
    return (
      <form action={codeAction} className="flex flex-col gap-4">
        <p className="text-[15px] text-muted">First, the 6-digit code from your authenticator app.</p>
        <Field label="6-digit code" error={error}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="123456" autoFocus className="text-center text-2xl tracking-[0.4em] tabular-nums" />
        </Field>
        <Button type="submit" disabled={checking} className="w-full">
          {checking ? "Checking…" : "Continue"}
        </Button>
      </form>
    );
  }
  return (
    <form action={saveAction} className="flex flex-col gap-3.5">
      <Field label="New password" hint="At least 10 characters, with a letter and a number." error={error}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} autoFocus />
      </Field>
      <Field label="The same password again">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={10} maxLength={72} />
      </Field>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotAgentPassword, {});
  const href = useSupportHref();
  if (state.sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px]">If that address belongs to a support agent, we emailed it a link to choose a new password. Nothing after two minutes? Check spam.</p>
        <Link href={href("/sign-in")} className="self-center text-[13px] text-ok underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3.5">
      <Field label="Work email" error={state.error}>
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Email me a link"}
      </Button>
      <Link href={href("/sign-in")} className="self-center text-[13px] text-ok underline-offset-2 hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
