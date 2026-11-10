"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Check, Copy, Eye, EyeOff, Headphones, KeyRound, ShieldCheck, Smartphone, UserPlus, Wand2, Wrench, X } from "lucide-react";
import {
  createMemberAction,
  requireNewAuthenticatorAction,
  setMemberPasswordAction,
  type AccountActionState,
} from "@/app/support/(app)/team/actions";
import { cn } from "@/lib/cn";
import { suggestPassword } from "@/lib/support/setup-grant";

// The Team page's account forms (admin@bupulse.com only): add a team member with a password (they must add an
// authenticator app at their first sign-in), and on each member, set a new password or ask for a new authenticator.
// No email is sent: the admin hands the details over (copy, or WhatsApp).

const randomInt = (n: number) => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
};

const input =
  "min-h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] outline-none focus:border-pulse-blue focus:ring-4 focus:ring-pulse-blue/15 dark:bg-white/[0.03]";

function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          },
          () => undefined,
        )
      }
      className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 text-sm font-semibold text-graphite shadow-sm hover:bg-white/90"
    >
      {done ? <Check aria-hidden className="size-4 text-ok" /> : <Copy aria-hidden className="size-4" />}
      {done ? "Copied" : label}
    </button>
  );
}

/** A password field with Show and Make one. The value posts as `name`. */
function PasswordField({ name, label }: { name: string; label: string }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
            name={name}
            type={shown ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            maxLength={72}
            required
            className={cn(input, "pr-11 font-mono")}
          />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide the password" : "Show the password"}
            className="absolute right-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-text"
          >
            {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setValue(suggestPassword(randomInt));
            setShown(true);
          }}
          className="inline-flex min-h-12 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold hover:border-pulse-blue/50 hover:bg-pulse-blue/5"
        >
          <Wand2 aria-hidden className="size-4" /> Make one
        </button>
      </div>
      <p className="text-[12.5px] text-muted">At least 10 characters with a letter and a number. Make one creates a strong one you can copy.</p>
    </div>
  );
}

const ROLES: { value: string; label: string; hint: string; icon: ReactNode }[] = [
  { value: "AGENT", label: "Chat agent", hint: "Answers chats", icon: <Headphones className="size-5" /> },
  { value: "TECH", label: "Technical support", hint: "Chats and the servers", icon: <Wrench className="size-5" /> },
  { value: "SUPERVISOR", label: "Supervisor", hint: "All chats, stats, servers", icon: <ShieldCheck className="size-5" /> },
];

function RoleTiles() {
  const [role, setRole] = useState("AGENT");
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-semibold">Role</legend>
      <input type="hidden" name="role" value={role} />
      <div role="radiogroup" aria-label="Role" className="grid gap-2 sm:grid-cols-3">
        {ROLES.map((r) => {
          const on = role === r.value;
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setRole(r.value)}
              className={cn(
                "relative flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 text-left transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30",
                on ? "border-pulse-blue bg-pulse-blue/[0.07] dark:bg-pulse-blue/15" : "border-line bg-surface hover:border-pulse-blue/40",
              )}
            >
              <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", on ? "bg-brand-gradient text-white" : "bg-soft")}>{r.icon}</span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[14px] font-semibold">{r.label}</span>
                <span className="text-[12.5px] text-muted">{r.hint}</span>
              </span>
              {on && (
                <span aria-hidden className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-pulse-blue text-white">
                  <Check className="size-3" strokeWidth={3.5} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** What the admin sends the new person: where to sign in, the address, the password, and the authenticator step. */
export function handOverText(created: { name: string; email: string; password: string }, signInUrl: string): string {
  return [
    `Hi ${created.name.split(/\s+/)[0]}, your BuPulse Support account is ready.`,
    `Sign in: ${signInUrl}`,
    `Email: ${created.email}`,
    `Password: ${created.password}`,
    "At your first sign-in you will add an authenticator app (Google Authenticator or Microsoft Authenticator on your phone). After that it asks for its 6-digit code each time.",
  ].join("\n");
}

function Created({ created, signInUrl, onAgain }: { created: NonNullable<AccountActionState["created"]>; signInUrl: string; onAgain: () => void }) {
  const text = handOverText(created, signInUrl);
  return (
    <div className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(140deg,#2f6bff_0%,#5b4dff_55%,#7b5cff_100%)] p-5 text-white sm:p-6">
      <p className="text-lg font-bold">{created.name} can sign in now</p>
      <p className="text-sm text-white/85">Send them these details. At their first sign-in they must add an authenticator app before anything opens.</p>
      <pre role="status" className="mt-4 whitespace-pre-wrap rounded-2xl bg-white/15 px-4 py-3 font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </pre>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <CopyText text={text} label="Copy the details" />
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/15 px-3.5 text-sm font-semibold hover:bg-white/25"
        >
          Send on WhatsApp
        </a>
        <button type="button" onClick={onAgain} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white/15 px-3.5 text-sm font-semibold hover:bg-white/25">
          <UserPlus aria-hidden className="size-4" /> Add another
        </button>
      </div>
    </div>
  );
}

/** "Add a team member": closed to a button until opened; after saving, the details to hand over. */
export function AddMemberCard({ signInUrl, preview = false }: { signInUrl: string; preview?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AccountActionState, FormData>(createMemberAction, {});
  const [seen, setSeen] = useState<string | null>(null);
  const created = state.created && seen !== state.created.email ? state.created : null;
  if (created) return <Created created={created} signInUrl={signInUrl} onAgain={() => setSeen(created.email)} />;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full cursor-pointer items-center gap-3 rounded-[20px] border-2 border-dashed border-pulse-blue/40 bg-pulse-blue/[0.04] p-4 text-left transition-colors hover:border-pulse-blue hover:bg-pulse-blue/[0.07] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30"
      >
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white">
          <UserPlus aria-hidden className="size-5" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold">Add a team member</span>
          <span className="text-[13px] text-muted">Give them a password now; they add an authenticator app at their first sign-in. No email needed.</span>
        </span>
      </button>
    );
  }
  return (
    <form action={action} className="relative flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-4 shadow-[0_24px_60px_-40px_rgba(17,24,39,0.45)] sm:p-5">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-[22px] bg-brand-gradient" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-bold">Add a team member</h3>
          <p className="text-sm text-muted">They can sign in at once with this password, then must add an authenticator app. You send them the details.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-soft">
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Full name</span>
          <input name="name" required minLength={2} maxLength={80} className={input} placeholder="Aline Uwase" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Work email (they sign in with it)</span>
          <input name="email" type="email" required className={input} placeholder="aline@bupulse.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </label>
      </div>
      <RoleTiles />
      <PasswordField name="password" label="Password" />
      <p className="flex items-start gap-2 rounded-2xl bg-soft px-3.5 py-3 text-[13px]">
        <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-blue" />
        <span>
          <strong>Authenticator app required.</strong> At their first sign-in they scan a QR code with Google or Microsoft Authenticator, without an emailed code
          (valid for 7 days). They reach every department&apos;s chats; narrow them in Admin → Live chat.
        </span>
      </p>
      {state.error && (
        <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || preview}
        className="inline-flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-5 text-[15px] font-bold text-white shadow-[0_14px_30px_-14px_rgba(47,107,255,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Creating the account…" : "Create the account"}
      </button>
    </form>
  );
}

/** On a member's card: set a new password, or ask for a new authenticator app. */
export function ManageMember({ id, name, authenticator, preview = false }: { id: string; name: string; authenticator: boolean | null; preview?: boolean }) {
  const [open, setOpen] = useState<"none" | "password" | "app">("none");
  const [pw, pwAction, pwPending] = useActionState<AccountActionState, FormData>(setMemberPasswordAction, {});
  const [app, appAction, appPending] = useActionState<AccountActionState, FormData>(requireNewAuthenticatorAction, {});
  const btn = (on: boolean) =>
    cn(
      "inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors",
      on ? "border-pulse-blue bg-pulse-blue/[0.08]" : "border-line bg-surface hover:border-pulse-blue/40",
    );
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-expanded={open === "password"} onClick={() => setOpen(open === "password" ? "none" : "password")} className={btn(open === "password")}>
          <KeyRound aria-hidden className="size-4" /> Set a new password
        </button>
        <button type="button" aria-expanded={open === "app"} onClick={() => setOpen(open === "app" ? "none" : "app")} className={btn(open === "app")}>
          <Smartphone aria-hidden className="size-4" /> {authenticator ? "Ask for a new authenticator" : "Authenticator setup"}
        </button>
      </div>
      {open === "password" && (
        <form action={pwAction} className="flex flex-col gap-2.5 rounded-2xl bg-soft p-3">
          <input type="hidden" name="id" value={id} />
          <PasswordField name="password" label={`New password for ${name.split(/\s+/)[0]}`} />
          {pw.error && <p role="alert" className="text-[13px] text-danger">{pw.error}</p>}
          {pw.done && <p role="status" className="text-[13px] text-success">{pw.done}</p>}
          <button type="submit" disabled={pwPending || preview} className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-brand-gradient px-4 text-sm font-bold text-white disabled:opacity-50">
            {pwPending ? "Saving…" : "Save the new password"}
          </button>
          <p className="text-[12.5px] text-muted">They are signed out everywhere. Send them the new password yourself.</p>
        </form>
      )}
      {open === "app" && (
        <form action={appAction} className="flex flex-col gap-2.5 rounded-2xl bg-soft p-3 text-[13px]">
          <input type="hidden" name="id" value={id} />
          <p>
            {authenticator
              ? "Lost phone or new phone? This removes their current authenticator app and signs them out. At their next sign-in they must add one again (no emailed code needed for 7 days)."
              : "They have not added an authenticator app yet. This signs them out and lets them add one at their next sign-in without an emailed code (for 7 days)."}
          </p>
          {app.error && <p role="alert" className="text-danger">{app.error}</p>}
          {app.done && <p role="status" className="text-success">{app.done}</p>}
          <button type="submit" disabled={appPending || preview} className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-brand-gradient px-4 text-sm font-bold text-white disabled:opacity-50">
            {appPending ? "Working…" : authenticator ? "Remove it and ask for a new one" : "Ask them to add one"}
          </button>
        </form>
      )}
    </div>
  );
}
