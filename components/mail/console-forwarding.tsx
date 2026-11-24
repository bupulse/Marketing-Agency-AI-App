"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { isOurAddress } from "@/lib/mail/addresses";
import { forwardShort, forwardWhere } from "@/lib/mail/console-rules";
import { addAlias, addForwarder, removeAlias, removeForwarder, setForwarderKeepCopy, toggleForwarder, type ConsoleState } from "@/app/mail/(console)/console/actions";
import { darkBtn, h1, h2, input, label, panel, pill, sub } from "./console-styles";
import { Note, Switch } from "./console-ui";

// Mail console: Forwarding (design ConsoleForwarding): rules "mail to X also goes to Y", and extra addresses.

type Rule = { id: string; source: string; target: string; external: boolean; keepCopy: boolean; enabled: boolean; verified: boolean };
type Alias = { id: string; address: string; into: string };
type Box = { id: string; address: string };
type Owners = Record<string, { name: string; note: string }>;

export function ForwardingView({ rules, aliases, mailboxes, owners }: { rules: Rule[]; aliases: Alias[]; mailboxes: Box[]; owners: Owners }) {
  const [fwdState, fwdAction, fwdPending] = useActionState<ConsoleState, FormData>(addForwarder, {});
  const [aliasState, aliasAction, aliasPending] = useActionState<ConsoleState, FormData>(addAlias, {});
  const [list, patch] = useOptimistic(rules, (rows: Rule[], p: { id: string; data: Partial<Rule> | null }) => (p.data ? rows.map((r) => (r.id === p.id ? { ...r, ...p.data } : r)) : rows.filter((r) => r.id !== p.id)));
  const [aliasList, dropAlias] = useOptimistic(aliases, (rows: Alias[], id: string) => rows.filter((a) => a.id !== id));
  const [, start] = useTransition();
  const [source, setSource] = useState(mailboxes[0]?.address ?? "");
  const [target, setTarget] = useState("");
  const outside = /@/.test(target) && !isOurAddress(target.trim().toLowerCase());
  const nameOf = (address: string) => owners[address]?.name ?? address.split("@")[0];

  return (
    <>
      <header>
        <h1 className={h1}>Forwarding</h1>
        <p className={cn(sub, "max-w-[760px]")}>Only admins set forwarding. The receiver gets a folder named after the account, and the mail also shows in their All inboxes with a &ldquo;from&rdquo; tag. The employee sees a short note in their Settings.</p>
      </header>

      <form action={fwdAction} aria-label="New rule" className={cn(panel, "flex flex-wrap items-end gap-3 p-5")}>
        <label className={cn(label, "flex-[1_1_220px]")}>Mail that reaches
          <select name="source" value={source} onChange={(e) => setSource(e.target.value)} required className={cn(input, "cursor-pointer font-medium")}>
            {mailboxes.map((b) => <option key={b.id} value={b.address}>{b.address}</option>)}
          </select>
        </label>
        <span aria-hidden className="inline-flex size-[46px] items-center justify-center text-[#1f5ae6] dark:text-[#9dbbff]"><ArrowRight className="size-[22px]" /></span>
        <label className={cn(label, "flex-[1_1_240px]")}>Also goes to<input name="target" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder="cyusa@bupulse.com or name@example.com" autoComplete="off" className={input} /></label>
        <label className="flex h-[46px] items-center gap-2 text-[14px] font-medium"><input type="checkbox" name="keepCopy" defaultChecked className="size-[18px] accent-[#1f5ae6]" />Keep it in {nameOf(source)}&rsquo;s inbox too</label>
        {outside && <label className="flex h-[46px] items-center gap-2 text-[14px] font-medium"><input type="checkbox" name="confirmed" className="size-[18px] accent-[#1f5ae6]" />Confirmed in Cloudflare</label>}
        <button disabled={fwdPending || !mailboxes.length} className={cn(darkBtn, "h-[46px]")}>Add rule</button>
        <div className="basis-full empty:hidden"><Note s={fwdState} /></div>
      </form>

      <section aria-label="Rules" className={cn(panel, "py-1")}>
        {list.map((r, i) => {
          const badge = !r.external ? ["Instant", "bg-[#e3ecff] text-[#1946b8] dark:bg-[#1946b8]/40 dark:text-[#b9ccff]"] : r.verified ? ["Confirmed", "bg-[#e2f5ea] text-[#11633a] dark:bg-[#11633a]/40 dark:text-[#9fe0bb]"] : ["Waiting for the link", "bg-[#fff4e5] text-[#8a4b00] dark:bg-[#8a4b00]/40 dark:text-[#ffd8a8]"];
          return (
            <div key={r.id} className={cn("flex flex-wrap items-center gap-4 px-5 py-4 transition-opacity", i > 0 && "border-t border-[rgba(60,60,67,0.08)] dark:border-white/10", !r.enabled && "opacity-50")}>
              <span className="flex min-w-0 flex-[1_1_200px] flex-col"><span className="truncate text-[15px] font-semibold">{r.source}</span><span className="text-[12.5px] text-muted">{owners[r.source]?.note ?? "Other address"}</span></span>
              <ArrowRight aria-hidden className="size-5 text-[#8e8e93]" />
              <span className="flex min-w-0 flex-[1_1_220px] flex-col"><span className="truncate text-[15px] font-medium">{r.target}</span><span className="text-[12.5px] text-muted">{forwardWhere(r, nameOf(r.source))}</span></span>
              <span className={cn(pill, badge[1])}>{badge[0]}</span>
              <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={r.keepCopy} onChange={(e) => { const keep = e.target.checked; start(async () => { patch({ id: r.id, data: { keepCopy: keep } }); await setForwarderKeepCopy(r.id, keep); }); }} className="size-4 accent-[#1f5ae6]" />Keep a copy</label>
              <Switch on={r.enabled} label={`Forward ${r.source} to ${r.target}`} onChange={(on) => start(async () => { patch({ id: r.id, data: { enabled: on } }); await toggleForwarder(r.id, on); })} />
              <button type="button" aria-label={`Remove the rule ${r.source} to ${r.target}`} onClick={() => start(async () => { patch({ id: r.id, data: null }); await removeForwarder(r.id); })} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-[#b42318] hover:bg-[#fdecec] dark:text-[#ffb4ab] dark:hover:bg-[#b42318]/20"><X className="size-4" /></button>
            </div>
          );
        })}
        {list.length === 0 && <p className="m-0 px-5 py-4 text-[14px] text-muted">No forwarding yet.</p>}
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        <div className={cn(panel, "flex flex-col gap-2.5 p-5")}>
          <h2 className={h2}>Extra addresses</h2>
          <span className="text-[14px] text-[#3c3c43] dark:text-white/70">Land in an existing mailbox, no new user.</span>
          {aliasList.map((a) => (
            <span key={a.id} className="flex items-center justify-between gap-2 rounded-[14px] bg-white/75 py-2 pr-2 pl-3.5 text-[14px] dark:bg-white/5">
              <strong className="truncate">{a.address}</strong>
              <span className="flex items-center gap-1 text-[#3c3c43] dark:text-white/70">into {forwardShort(a.into, false)}
                <button type="button" aria-label={`Remove ${a.address}`} onClick={() => start(async () => { dropAlias(a.id); await removeAlias(a.id); })} className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"><X className="size-3.5" /></button>
              </span>
            </span>
          ))}
          <form action={aliasAction} className="mt-1 flex flex-wrap items-end gap-2">
            <label className="flex flex-[1_1_160px] flex-col gap-1.5 text-[13px] font-semibold">New address
              <span className="flex items-stretch overflow-hidden rounded-xl border border-[rgba(60,60,67,0.2)] bg-white/[0.92] dark:border-white/15 dark:bg-white/5">
                <input name="address" required placeholder="info" autoComplete="off" autoCapitalize="none" className="h-[42px] min-w-0 flex-1 bg-transparent px-3 text-[14.5px] font-normal outline-none" />
                <span className="inline-flex items-center bg-[rgba(60,60,67,0.06)] px-2.5 text-[13.5px] font-medium text-muted dark:bg-white/10">@bupulse.com</span>
              </span>
            </label>
            <label className="flex flex-[1_1_140px] flex-col gap-1.5 text-[13px] font-semibold">Lands in
              <select name="mailboxId" required className="h-[42px] cursor-pointer rounded-xl border border-[rgba(60,60,67,0.2)] bg-white/[0.92] px-2.5 text-[14.5px] font-normal dark:border-white/15 dark:bg-white/5">
                {mailboxes.map((b) => <option key={b.id} value={b.id}>{b.address}</option>)}
              </select>
            </label>
            <button disabled={aliasPending} className={cn(darkBtn, "h-[42px] px-4 text-[14px]")}>Add</button>
          </form>
          <Note s={aliasState} />
        </div>
        <div className={cn(panel, "flex flex-col gap-2.5 p-5")}>
          <h2 className={h2}>Outside addresses</h2>
          <span className="text-[14px] leading-normal text-[#3c3c43] dark:text-white/70">Forwarding to a Gmail or other outside address is free and never uses the 100 daily sends. That address clicks a confirmation link once first (Cloudflare, Email Routing, Destination addresses); tick &ldquo;Confirmed in Cloudflare&rdquo; when it has.</span>
        </div>
      </section>
    </>
  );
}
