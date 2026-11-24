"use client";

import { useActionState, useOptimistic, useTransition } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { addSenderRule, removeSenderRule, type ConsoleState } from "@/app/mail/(console)/console/actions";
import { darkBtn, h1, h2, input, label, panel, sub } from "./console-styles";
import { Note } from "./console-ui";

// Mail console: Spam and blocks. The same sender rules that "Report spam" and "Not spam" in Mail write
// (MailSenderRule, read by lib/mail/inbound.ts spamVerdict): an address rule wins over its domain, and "allow" wins
// over the receiving side's checks.

type Rule = { id: string; pattern: string; action: string; createdBy: string; createdAt: string };

export function SpamView({ rules, catchAll }: { rules: Rule[]; catchAll: string }) {
  const [state, action, pending] = useActionState<ConsoleState, FormData>(addSenderRule, {});
  const [list, drop] = useOptimistic(rules, (rows: Rule[], id: string) => rows.filter((r) => r.id !== id));
  const [, start] = useTransition();
  const blocked = list.filter((r) => r.action === "spam");
  const allowed = list.filter((r) => r.action !== "spam");

  const group = (title: string, note: string, rows: Rule[]) => (
    <section aria-label={title} className={cn(panel, "flex min-w-0 flex-[1_1_340px] flex-col gap-2 p-5")}>
      <h2 className={h2}>{title} <span className="text-[13px] font-medium text-muted">{rows.length}</span></h2>
      <span className="text-[13.5px] text-[#3c3c43] dark:text-white/70">{note}</span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-[14px] bg-white/75 py-2 pr-2 pl-3.5 dark:bg-white/5">
            <span className="flex min-w-0 flex-1 flex-col"><strong className="truncate text-[14px]">{r.pattern}</strong><span className="text-[12px] text-muted">{r.pattern.startsWith("@") ? "Whole domain" : "One address"} · added {r.createdAt.slice(0, 10)} by {r.createdBy.split("@")[0]}</span></span>
            <button type="button" aria-label={`Remove the rule for ${r.pattern}`} onClick={() => start(async () => { drop(r.id); await removeSenderRule(r.id); })} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"><X className="size-4" /></button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-1 py-2 text-[13.5px] text-muted">None yet.</li>}
      </ul>
    </section>
  );

  return (
    <>
      <header>
        <h1 className={h1}>Spam and blocks</h1>
        <p className={cn(sub, "max-w-[760px]")}>Senders that always go to Spam, and senders that never do. &ldquo;Report spam&rdquo; and &ldquo;Not spam&rdquo; in Mail add to these lists by themselves.</p>
      </header>

      <form action={action} aria-label="New rule" className={cn(panel, "flex flex-wrap items-end gap-3 p-5")}>
        <label className={cn(label, "flex-[1_1_260px]")}>Address or domain<input name="pattern" required placeholder="offers@example.com or @example.com" autoComplete="off" autoCapitalize="none" className={input} /></label>
        <fieldset className="flex h-[46px] items-center gap-4 border-0 p-0">
          <legend className="sr-only">What happens to their mail</legend>
          <label className="flex items-center gap-2 text-[14px] font-medium"><input type="radio" name="action" value="spam" defaultChecked className="size-[18px] accent-[#1f5ae6]" />Always to Spam</label>
          <label className="flex items-center gap-2 text-[14px] font-medium"><input type="radio" name="action" value="allow" className="size-[18px] accent-[#1f5ae6]" />Never to Spam</label>
        </fieldset>
        <button disabled={pending} className={cn(darkBtn, "h-[46px]")}>Add rule</button>
        <div className="basis-full empty:hidden"><Note s={state} /></div>
      </form>

      <div className="flex flex-wrap items-start gap-4">
        {group("Always to Spam", "Their mail skips the inbox and waits in Spam. Nothing is deleted.", blocked)}
        {group("Never to Spam", "Trusted senders: their mail always reaches the inbox, even when a check fails.", allowed)}
      </div>

      <section aria-label="How spam is decided" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5 rounded-[24px] border border-white/80 bg-white/60 p-5 backdrop-blur-[26px] backdrop-saturate-[1.8] dark:border-white/10 dark:bg-[rgba(28,28,34,0.7)]">
        {[
          ["1. An address rule", "A rule for name@example.com wins over one for @example.com."],
          ["2. A domain rule", "@example.com covers every address at that domain."],
          ["3. The sender's checks", "With no rule, mail that fails DMARC or is flagged as spam on the way in goes to Spam."],
          ["Other addresses", catchAll === "refuse" ? "Mail to an address nobody has is refused." : "Mail to an address nobody has lands in the Other inbox."],
        ].map(([t, x]) => (
          <div key={t} className="flex flex-col gap-1"><span className="text-[14.5px] font-bold">{t}</span><span className="text-[13.5px] leading-normal text-[#3c3c43] dark:text-white/70">{x}</span></div>
        ))}
      </section>
    </>
  );
}
