"use client";

import { useActionState, useOptimistic, useTransition } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/cn";
import { createAgentKeyAction, revokeAgentKeyAction, type ConsoleState } from "@/app/mail/(console)/console/actions";
import { darkBtn, h2, hint, input, label, panel, pill, smallBtn } from "./console-styles";
import { Note } from "./console-ui";

// Mail console, Sending and limits: agent keys (docs/mail-crm/AGENT_API.md). An outreach agent such as Sellbird sends
// from one mailbox and reads what arrives in it with one of these keys; revoking one stops it at once.

export type AgentKeyView = {
  id: string;
  name: string;
  prefix: string;
  mailbox: string;
  fromName: string | null;
  signature: boolean;
  dailyLimit: number;
  sentToday: number;
  lastUsed: string | null;
  revoked: boolean;
};
type Box = { id: string; address: string };

export function AgentKeys({ keys, mailboxes, defaultMailboxId }: { keys: AgentKeyView[]; mailboxes: Box[]; defaultMailboxId: string | null }) {
  const [state, action, pending] = useActionState<ConsoleState, FormData>(createAgentKeyAction, {});
  const [list, revoke] = useOptimistic(keys, (rows: AgentKeyView[], id: string) => rows.map((k) => (k.id === id ? { ...k, revoked: true } : k)));
  const [, start] = useTransition();

  return (
    <section aria-label="Agent keys" className={cn(panel, "flex flex-col gap-4 p-5")}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e3ecff] text-[#1946b8] dark:bg-[#1946b8]/40 dark:text-[#b9ccff]"><Bot className="size-5" /></span>
        <div className="flex flex-col gap-1">
          <h2 className={h2}>Agent keys</h2>
          <span className="text-[13.5px] leading-normal text-[#3c3c43] dark:text-white/70">
            Let an outreach agent such as Sellbird send from one mailbox and read the replies that arrive in it. Its emails use the team&rsquo;s daily sends, up to the limit you set, and show in the mailbox like everyone else&rsquo;s. Revoke a key and it stops at once.
          </span>
        </div>
      </div>

      <form action={action} aria-label="New agent key" className="flex flex-wrap items-end gap-3">
        <label className={cn(label, "flex-[1_1_180px]")}>Name<input name="name" required maxLength={60} defaultValue="Sellbird" autoComplete="off" className={input} /></label>
        <label className={cn(label, "flex-[1_1_220px]")}>Sends from and reads
          <select name="mailboxId" required defaultValue={defaultMailboxId ?? mailboxes[0]?.id} className={cn(input, "cursor-pointer font-medium")}>
            {mailboxes.map((b) => <option key={b.id} value={b.id}>{b.address}</option>)}
          </select>
        </label>
        <label className={cn(label, "flex-[0_1_140px]")}>Sends a day<input name="dailyLimit" type="number" min={1} max={100} required defaultValue={50} className={input} /></label>
        <label className={cn(label, "flex-[1_1_200px]")}>Sender name <span className={hint}>Empty: as B Mail would</span><input name="fromName" maxLength={80} placeholder="Sales · BuPulse" autoComplete="off" className={input} /></label>
        <label className="flex h-[46px] items-center gap-2 text-[14px] font-medium"><input type="checkbox" name="signature" defaultChecked className="size-[18px] accent-[#1f5ae6]" />Add the B Mail signature</label>
        <button disabled={pending || !mailboxes.length} className={cn(darkBtn, "h-[46px]")}>Make key</button>
        <div className="basis-full empty:hidden"><Note s={state} /></div>
      </form>

      <div className="flex flex-col">
        {list.map((k, i) => (
          <div key={k.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 py-3", i > 0 && "border-t border-[rgba(60,60,67,0.08)] dark:border-white/10", k.revoked && "opacity-50")}>
            <span className="flex min-w-0 flex-[1_1_200px] flex-col">
              <span className="truncate text-[15px] font-semibold">{k.name} <code className="ml-1 text-[12.5px] font-normal text-muted">{k.prefix}…</code></span>
              <span className="text-[12.5px] text-muted">{k.mailbox} · {k.fromName ?? "default sender name"} · {k.signature ? "with signature" : "no signature"}</span>
            </span>
            <span className="text-[13px] text-[#3c3c43] dark:text-white/70">{k.sentToday} / {k.dailyLimit} today</span>
            <span className="text-[13px] text-[#3c3c43] dark:text-white/70">{k.lastUsed ? `Last used ${k.lastUsed}` : "Not used yet"}</span>
            {k.revoked ? (
              <span className={cn(pill, "bg-[#ececf1] text-[#3c3c43] dark:bg-white/10 dark:text-white/70")}>Revoked</span>
            ) : (
              <button type="button" onClick={() => { if (confirm(`Revoke "${k.name}"? The agent stops sending and reading at once.`)) start(async () => { revoke(k.id); await revokeAgentKeyAction(k.id); }); }} className={cn(smallBtn, "text-[#b42318] dark:text-[#ffb4ab]")}>Revoke</button>
            )}
          </div>
        ))}
        {list.length === 0 && <p className="m-0 py-2 text-[14px] text-muted">No agent keys yet.</p>}
      </div>
    </section>
  );
}
