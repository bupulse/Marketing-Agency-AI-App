"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Headphones, Wrench } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { TurnstileField } from "@/components/auth/turnstile-field";
import { askToJoin, type JoinState } from "@/app/support/(auth)/actions";
import { alertClass } from "./auth-shell";
import { useSupportHref } from "./base";

const ROLES = [
  { value: "AGENT", label: "Answer chats", hint: "Chat agent: talk with visitors and clients", icon: Headphones },
  { value: "TECH", label: "Chats and servers", hint: "Technical support: chats, plus watching the servers", icon: Wrench },
] as const;

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
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {ROLES.map((r) => (
            <label
              key={r.value}
              className="group relative flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-line bg-surface p-3.5 transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-pulse-blue/40 has-[:checked]:border-pulse-blue has-[:checked]:bg-pulse-blue/[0.07] has-[:checked]:shadow-[0_8px_24px_-12px_rgba(47,107,255,0.55)] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-pulse-blue/30 motion-reduce:transform-none motion-reduce:transition-none dark:has-[:checked]:bg-pulse-blue/15"
            >
              <input type="radio" name="role" value={r.value} defaultChecked={r.value === "AGENT"} className="peer sr-only" />
              <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-text transition-colors peer-checked:bg-brand-gradient peer-checked:text-white">
                <r.icon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] font-semibold">{r.label}</span>
                <span className="text-[13px] text-muted">{r.hint}</span>
              </span>
              <span aria-hidden className="absolute -right-1.5 -top-1.5 hidden size-5 items-center justify-center rounded-full bg-pulse-blue text-white shadow peer-checked:inline-flex">
                <Check className="size-3" strokeWidth={3.5} />
              </span>
            </label>
          ))}
        </div>
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
