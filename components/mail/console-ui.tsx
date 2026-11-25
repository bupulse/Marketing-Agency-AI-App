"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mailAppPath } from "@/lib/platform/app-hosts";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { avatarColor, initialOf } from "@/lib/mail/console-rules";
import type { ConsoleState } from "@/app/mail/(console)/console/actions";
import { BMark } from "./brand";

const NAV = [
  ["/mail/console", "Users"],
  ["/mail/console/departments", "Departments"],
  ["/mail/console/forwarding", "Forwarding"],
  ["/mail/console/company", "Company and look"],
  ["/mail/console/spam", "Spam and blocks"],
  ["/mail/console/sending", "Sending and limits"],
] as const;

/** The console's own side menu (the Mail folders are not shown here). */
export function ConsoleNav() {
  const path = mailAppPath(usePathname());
  const active = (href: string) => (href === "/mail/console" ? path === href || path === "/mail/console/new" : path.startsWith(href));
  return (
    <nav aria-label="Mail console" className="flex w-full shrink-0 flex-col gap-1 rounded-[26px] border border-white/75 bg-white/55 px-3 py-[18px] backdrop-blur-[26px] backdrop-saturate-[1.8] md:sticky md:top-[18px] md:w-[240px] dark:border-white/10 dark:bg-[rgba(28,28,34,0.7)]">
      <div className="flex items-center gap-2.5 px-2 pb-3.5">
        <BMark size={34} />
        <span className="flex flex-col leading-tight"><span className="text-[15px] font-bold">Mail console</span><span className="text-[12px] text-muted">Admins only</span></span>
      </div>
      <div className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={cn("flex h-10 shrink-0 items-center rounded-xl px-3 text-[14.5px] font-medium whitespace-nowrap transition-colors hover:bg-white/60 dark:hover:bg-white/10", active(href) && "bg-white font-semibold shadow-[0_4px_14px_-8px_rgba(15,23,42,0.35)] dark:bg-white/15")}>
            {label}
          </Link>
        ))}
      </div>
      <Link href="/mail" className="mt-2 flex h-10 items-center rounded-xl px-3 text-[14.5px] font-medium text-[#1f5ae6] hover:bg-white/60 md:mt-4 dark:text-[#9dbbff] dark:hover:bg-white/10">Back to Mail</Link>
    </nav>
  );
}

/** A round avatar with the first letter, in a steady colour for that person. */
export function Avatar({ name, seed, size = 36, ring = false, color }: { name: string; seed: string; size?: number; ring?: boolean; color?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", ring && "shadow-[0_0_0_2px_#fff] dark:shadow-[0_0_0_2px_#1c1c22]")}
      style={{ width: size, height: size, fontSize: size > 40 ? 17 : size > 30 ? 14 : 11, background: color ?? avatarColor(seed) }}
    >
      {initialOf(name)}
    </span>
  );
}

/** An iOS-style switch. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cn("inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full p-0.5 transition-colors disabled:cursor-default disabled:opacity-60", on ? "justify-end bg-[#34c759]" : "justify-start bg-[rgba(120,120,128,0.24)]")}>
      <span className="size-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)]" />
    </button>
  );
}

/** The result of an action: an error, or a success line (with a one-time password shown once and a Copy button). */
export function Note({ s }: { s: ConsoleState }) {
  const [copied, setCopied] = useState(false);
  if (s.error) return <p role="alert" className="rounded-xl bg-[#fdecec] px-4 py-2.5 text-[13.5px] font-medium text-[#b42318] dark:bg-[#b42318]/25 dark:text-[#ffb4ab]">{s.error}</p>;
  if (!s.ok) return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-xl bg-[#e9f7ef] px-4 py-2.5 text-[13.5px] text-[#11633a] dark:bg-[#11633a]/30 dark:text-[#9fe0bb]">
      <span>{s.ok}</span>
      {s.password && (
        <span className="flex flex-wrap items-center gap-2">
          <code className="select-all rounded-lg bg-white px-3 py-1.5 font-mono text-[15px] text-[#1d1d1f]">{s.password}</code>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(s.password!); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* the text stays selectable */ } }} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[#11633a] px-3 text-[12.5px] font-semibold text-white">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Copied" : "Copy"}
          </button>
          <span className="text-[12.5px]">Shown only this once.</span>
        </span>
      )}
    </div>
  );
}
