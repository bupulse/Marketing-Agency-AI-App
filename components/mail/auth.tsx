"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { BLockup } from "./brand";
import type { CodeState, EnrollState } from "@/app/mail/(auth)/actions";

type CodeAction = (prev: CodeState, formData: FormData) => Promise<CodeState>;

export function MailAuthShell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[url(/mail/backgrounds/kigali-hills.svg)] bg-cover bg-bottom px-4 py-10">
      <section className="bmail-pop flex w-full max-w-[420px] flex-col gap-4 rounded-[28px] border border-white/80 bg-white/80 p-7 text-graphite shadow-[0_40px_90px_-40px_rgba(15,23,42,0.55)] backdrop-blur-2xl">
        <BLockup size={34} className="text-graphite" />
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
        {intro && <div className="text-[15px] leading-relaxed text-slate">{intro}</div>}
        {children}
      </section>
    </main>
  );
}

export function CodeForm({ action, label, hidden }: { action: CodeAction; label: string; hidden?: Record<string, string> }) {
  const [state, formAction, pending] = useActionState<CodeState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="flex flex-col gap-2 text-sm font-semibold">
        6-digit code
        <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} autoFocus required className="h-14 rounded-2xl border border-black/15 bg-white px-4 text-center text-[24px] font-semibold tracking-[0.3em] outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/30" />
      </label>
      {state.error && <p role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-sm font-medium text-[#b42318]">{state.error}</p>}
      <button disabled={pending} className="h-12 cursor-pointer rounded-full bg-[#1f5ae6] text-[15px] font-semibold text-white transition hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Checking…" : label}</button>
    </form>
  );
}

export function SetupFlow({ start, confirm, sendProof, confirmProof }: { start: () => Promise<EnrollState>; confirm: CodeAction; sendProof: () => Promise<CodeState>; confirmProof: CodeAction }) {
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [proofSent, setProofSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  if (enroll?.needEmail) {
    return proofSent ? (
      <div className="flex flex-col gap-3">
        <p className="text-[15px]">We emailed you a code. Enter it to continue.</p>
        <CodeForm action={confirmProof} label="Continue" />
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        <p className="text-[15px]">Your permission to add an authenticator without an emailed code has expired. Ask your mail admin for a new one-time password in the Mail console, or get a sign-in code by email.</p>
        {error && <p role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-sm text-[#b42318]">{error}</p>}
        <button disabled={pending} onClick={() => run(async () => { const r = await sendProof(); if (r.error) setError(r.error); else setProofSent(true); })} className="h-12 cursor-pointer rounded-full bg-[#1f5ae6] font-semibold text-white disabled:opacity-60">Email me a code</button>
      </div>
    );
  }
  if (!enroll?.factorId) {
    return (
      <div className="flex flex-col gap-3">
        {enroll?.error && <p role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-sm text-[#b42318]">{enroll.error}</p>}
        <button disabled={pending} onClick={() => run(async () => setEnroll(await start()))} className="h-12 cursor-pointer rounded-full bg-[#1f5ae6] font-semibold text-white disabled:opacity-60">{pending ? "Starting…" : "Show my QR code"}</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns the QR as an SVG data URL */}
      <img src={enroll.qr} alt="QR code for your authenticator app" className="mx-auto h-48 w-48 rounded-2xl bg-white p-2" />
      <p className="text-center text-[13px] text-slate">Or type this key: <code className="break-all font-mono text-[13px] text-graphite">{enroll.secret}</code></p>
      <CodeForm action={confirm} label="Finish" hidden={{ factorId: enroll.factorId }} />
    </div>
  );
}

export function MailSignInForm({ action }: { action: CodeAction }) {
  const [state, formAction, pending] = useActionState<CodeState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-sm font-semibold">
        Email
        <input name="email" type="email" autoComplete="username" required autoFocus className="h-12 rounded-2xl border border-black/15 bg-white px-4 text-[16px] font-normal outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/30" />
      </label>
      <label className="flex flex-col gap-2 text-sm font-semibold">
        6-digit code
        <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="h-14 rounded-2xl border border-black/15 bg-white px-4 text-center text-[24px] font-semibold tracking-[0.3em] outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/30" />
      </label>
      {state.error && <p role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-sm font-medium text-[#b42318]">{state.error}</p>}
      <button disabled={pending} className="h-12 cursor-pointer rounded-full bg-[#1f5ae6] text-[15px] font-semibold text-white transition hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Signing in…" : "Open B Mail"}</button>
    </form>
  );
}

const input = "h-12 w-full rounded-2xl border border-black/15 bg-white px-4 text-[16px] font-normal outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/30";

function PasswordField({ name, label, autoComplete, autoFocus, value, onChange }: { name: string; label: string; autoComplete: string; autoFocus?: boolean; value?: string; onChange?: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-2 text-sm font-semibold">
      {label}
      <span className="relative">
        <input name={name} type={show ? "text" : "password"} autoComplete={autoComplete} required autoFocus={autoFocus} value={value} onChange={onChange && ((e) => onChange(e.target.value))} className={`${input} pr-12`} />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate hover:bg-black/5">
          {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      </span>
    </label>
  );
}

/** The sign-in page: the authenticator code (everyday) or the password (first sign-in with the one-time password). */
export function MailSignIn({ codeAction, passwordAction, initial = "code" }: { codeAction: CodeAction; passwordAction: CodeAction; initial?: "code" | "password" }) {
  const [mode, setMode] = useState<"code" | "password">(initial);
  const tab = (m: "code" | "password", text: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`h-9 flex-1 cursor-pointer rounded-full text-[13.5px] font-semibold transition ${mode === m ? "bg-white text-graphite shadow-[0_1px_3px_rgba(15,23,42,0.18)]" : "text-slate hover:text-graphite"}`}>{text}</button>
  );
  return (
    <>
      <div role="tablist" aria-label="How to sign in" className="flex gap-1 rounded-full bg-black/[0.06] p-1">
        {tab("code", "Authenticator code")}
        {tab("password", "Password")}
      </div>
      {mode === "code" ? <MailSignInForm action={codeAction} /> : <PasswordSignInForm action={passwordAction} />}
      <p className="text-center text-[13px] leading-relaxed text-slate">
        {mode === "code" ? "First time here? Use the Password tab with the password your admin gave you." : "Forgot your password? Your mail admin can give you a new one-time password in the Mail console."}
      </p>
    </>
  );
}

export function PasswordSignInForm({ action }: { action: CodeAction }) {
  const [state, formAction, pending] = useActionState<CodeState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-sm font-semibold">
        Email
        <input name="email" type="email" autoComplete="username" required autoFocus className={input} />
      </label>
      <PasswordField name="password" label="Password" autoComplete="current-password" />
      {state.error && <p role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-sm font-medium text-[#b42318]">{state.error}</p>}
      <button disabled={pending} className="h-12 cursor-pointer rounded-full bg-[#1f5ae6] text-[15px] font-semibold text-white transition hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Signing in…" : "Continue"}</button>
    </form>
  );
}

const RULES = [
  { label: "At least 10 characters", test: (v: string) => v.length >= 10 },
  { label: "A letter and a number", test: (v: string) => /[A-Za-z]/.test(v) && /\d/.test(v) },
];

/** New password + confirm, with the rules ticking green as they are met. Used by the first sign-in and Settings. */
export function NewPasswordForm({ action, label, onDone }: { action: CodeAction; label: string; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState<CodeState, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (!r.error) onDone?.();
    return r;
  }, {});
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <PasswordField name="password" label="New password" autoComplete="new-password" autoFocus value={pw} onChange={setPw} />
      <ul className="flex flex-col gap-1 text-[13px]">
        {[...RULES, { label: "Both passwords match", test: (v: string) => !!v && v === confirm }].map((r) => {
          const ok = r.test(pw);
          return <li key={r.label} className={`flex items-center gap-2 ${ok ? "text-[#1a7f37]" : "text-slate"}`}><Check className={`size-4 ${ok ? "opacity-100" : "opacity-30"}`} />{r.label}</li>;
        })}
      </ul>
      <PasswordField name="confirm" label="Type it again" autoComplete="new-password" value={confirm} onChange={setConfirm} />
      {state.error && <p role="alert" className="rounded-2xl bg-[#fdecec] px-4 py-3 text-sm font-medium text-[#b42318]">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-2xl bg-[#e8f5ec] px-4 py-3 text-sm font-medium text-[#1a7f37]">{state.ok}</p>}
      <button disabled={pending} className="h-12 cursor-pointer rounded-full bg-[#1f5ae6] text-[15px] font-semibold text-white transition hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Saving…" : label}</button>
    </form>
  );
}
