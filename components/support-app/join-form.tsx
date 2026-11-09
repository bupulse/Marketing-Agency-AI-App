"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { TurnstileField } from "@/components/auth/turnstile-field";
import { askToJoin, type JoinState } from "@/app/support/(auth)/actions";
import { alertClass } from "./auth-shell";
import { useSupportHref } from "./base";

/** Name, work email and the job wanted; the admin approves, then the invite email arrives. */
export function JoinForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(askToJoin, {});
  const [token, setToken] = useState("");
  const href = useSupportHref();
  if (state.sent) {
    return (
      <div className="flex flex-col gap-4 text-[15px]">
        <p>Thank you. Your request was sent to the BuPulse admin.</p>
        <p>Once it is approved you get an email with a link to choose your password and add an authenticator app. Until then there is nothing else to do.</p>
        <Link href={href("/sign-in")} className="self-center text-[13px] text-ok underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3.5">
      {state.error && <p role="alert" className={alertClass}>{state.error}</p>}
      <Field label="Full name">
        <Input name="name" autoComplete="name" required minLength={2} maxLength={80} autoFocus />
      </Field>
      <Field label="Work email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <fieldset className="flex flex-col gap-2 text-[15px]">
        <legend className="mb-1 text-sm font-semibold">What will you do?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="role" value="AGENT" defaultChecked /> Answer chats (chat agent)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="role" value="TECH" /> Answer chats and watch the servers (technical support)
        </label>
      </fieldset>
      {turnstileSiteKey && (
        <>
          <input type="hidden" name="turnstileToken" value={token} />
          <TurnstileField siteKey={turnstileSiteKey} onToken={setToken} resetKey={state.error} />
        </>
      )}
      <Button type="submit" disabled={pending || (!!turnstileSiteKey && !token)} className="w-full">
        {pending ? "Sending…" : "Send my request"}
      </Button>
      <Link href={href("/sign-in")} className="self-center text-[13px] text-ok underline-offset-2 hover:underline">
        I already have an account
      </Link>
    </form>
  );
}
