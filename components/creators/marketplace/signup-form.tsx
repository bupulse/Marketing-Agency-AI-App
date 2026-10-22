"use client";

import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { PasswordChecks } from "@/components/auth/password-checks";
import { PasswordInput } from "@/components/auth/password-input";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { ResendButton } from "@/components/auth/resend-button";
import { TurnstileField } from "@/components/auth/turnstile-field";
import { creatorSignUpAction, type CreatorSignUpState } from "@/app/creators/signup/actions";
import { confirmEmailCode } from "@/app/signup/actions";
import { CREATOR_START } from "@/lib/creators/profile-form";

const initial: CreatorSignUpState = { status: "idle" };

/** The creator sign-up form of /creators/signup: name, email, password and WhatsApp, then "confirm your email". */
export function CreatorSignUpForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [state, action, pending] = useActionState(creatorSignUpAction, initial);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const errors = state.errors ?? {};
  const values = state.values ?? {};

  if (state.status === "sent") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-bg">
          <MailCheck aria-hidden className="size-7 text-success" />
        </span>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Confirm your email</h1>
        <p role="status" className="text-[15px] text-muted">
          We sent a code and a link to <strong className="break-all text-text">{state.email}</strong> from <strong className="text-text">register@bupulse.com</strong>. Type the code here, or open the link. Then fill in your profile and apply to campaigns in one tap.
        </p>
        {state.email && <EmailCodeForm action={confirmEmailCode} email={state.email} next={CREATOR_START} />}
        <p className="text-[13px] text-muted">Can&apos;t find it? In Gmail, look in the Updates or Promotions tab, then in Spam.</p>
        {state.email && <ResendButton email={state.email} startCooldown next={CREATOR_START} />}
      </div>
    );
  }

  return (
    <form
      key={JSON.stringify(values)}
      action={(fd) => {
        if (turnstileSiteKey) fd.set("turnstileToken", token);
        return action(fd);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Make your creator account</h1>
        <p className="text-[15px] text-muted">Free. One account for every campaign, from every company.</p>
      </div>
      <Field label="Your name" required error={errors.name}>
        <Input name="name" autoComplete="name" defaultValue={values.name} />
      </Field>
      <Field label="Email" required hint="Your login. Companies email you here." error={errors.email}>
        <Input name="email" type="email" autoComplete="email" defaultValue={values.email} />
      </Field>
      <Field label="WhatsApp number" required hint="Companies you apply to may message you here." error={errors.phone}>
        <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+250 791 954 277" defaultValue={values.phone} />
      </Field>
      <Field label="Password" required error={errors.password}>
        <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <PasswordChecks value={password} />
      {turnstileSiteKey && <TurnstileField siteKey={turnstileSiteKey} onToken={setToken} resetKey={state.status === "error" ? state : undefined} />}
      {state.error && (
        <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating your account…" : "Create my creator account"}
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account? <Link href="/login?next=/creator" className="font-semibold text-pulse-blue underline">Sign in</Link>
      </p>
      <p className="text-xs text-muted">
        By continuing you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>. Running a company?{" "}
        <Link href="/signup" className="underline">Sign up as a company</Link>.
      </p>
    </form>
  );
}
