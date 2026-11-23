"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
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
        <p className="text-[15px]">First, confirm it is you: we email a sign-in code to your address.</p>
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
