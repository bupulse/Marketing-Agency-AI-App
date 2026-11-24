"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMb, bytesToMb, quotaUse, stepQuota, type StorageSummary } from "@/lib/mail/console-rules";
import { newMailPassword, resetMailAuthenticator, updateMailUser, type ConsoleState } from "@/app/mail/(console)/console/actions";
import { card, darkBtn, h1, smallBtn, STATUS_STYLE, sub } from "./console-styles";
import { Avatar, Note } from "./console-ui";

// Mail console: Users (design ConsoleUsers): summary cards, then everyone with a @bupulse.com address.

type Dept = { id: string; name: string; color: string; headMemberId: string | null };
export type ConsoleMember = { id: string; name: string; email: string; role: string; departmentId: string | null; quotaMb: number; status: string; isHead: boolean; usedBytes: number; forwards: string };

const ROLE_LABEL: Record<string, string> = { member: "Member", admin: "Mail admin", owner: "Super admin" };
const selectPill = "h-7 cursor-pointer appearance-none rounded-full border-0 px-2.5 text-[12.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#2f6bff] disabled:cursor-default";
const step = "inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/90 text-[16px] font-semibold shadow-[inset_0_0_0_1px_rgba(60,60,67,0.18)] transition-transform hover:scale-[1.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f6bff] disabled:cursor-default disabled:opacity-40 disabled:hover:scale-100 dark:bg-white/10 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]";

export function UsersView({ depts, members, summary, admins, sentToday, dailyLimit, isSuper, myEmail }: { depts: Dept[]; members: ConsoleMember[]; summary: StorageSummary; admins: number; sentToday: number; dailyLimit: number; isSuper: boolean; myEmail: string }) {
  const [list, patch] = useOptimistic(members, (rows: ConsoleMember[], p: { id: string; data: Partial<ConsoleMember> }) => rows.map((m) => (m.id === p.id ? { ...m, ...p.data } : m)));
  const [pending, start] = useTransition();
  const [note, setNote] = useState<ConsoleState>({});
  const [authFor, setAuthFor] = useState<string | null>(null);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const dept = new Map(depts.map((d) => [d.id, d]));

  const save = (m: ConsoleMember, field: "role" | "departmentId" | "quotaMb" | "status", value: string) =>
    start(async () => {
      patch({ id: m.id, data: { [field]: field === "quotaMb" ? Number(value) : value || null } });
      const fd = new FormData();
      fd.set("id", m.id);
      fd.set(field, value);
      setNote(await updateMailUser({}, fd));
    });

  return (
    <>
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-[1_1_320px]"><h1 className={h1}>Users</h1><p className={sub}>Everyone with a @bupulse.com address.</p></div>
        <Link href="/mail/console/new" className={darkBtn}><Plus className="size-[17px]" strokeWidth={2.2} aria-hidden />Create user</Link>
      </header>

      <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        <div className={card}>
          <span className="text-[13px] text-muted">Users</span>
          <span className="text-[28px] font-bold tracking-[-0.02em]">{members.length}</span>
          <span className="text-[13px] text-[#3c3c43] dark:text-white/70">{depts.length === 1 ? "1 department" : `${depts.length} departments`} · {admins === 1 ? "1 admin" : `${admins} admins`}</span>
        </div>
        <div className={card}>
          <span className="text-[13px] text-muted">Storage given out</span>
          <span className="text-[28px] font-bold tracking-[-0.02em]">{formatMb(summary.givenMb)}{summary.over && <span className="text-[15px] font-medium text-[#b42318]"> (over the pool)</span>}</span>
          <div className="flex h-2 overflow-hidden rounded-full bg-[rgba(60,60,67,0.1)] dark:bg-white/10" role="img" aria-label={`${formatMb(summary.usedMb)} used, ${formatMb(summary.givenMb)} given out of a ${formatMb(summary.poolMb)} pool`}>
            <div className="h-2 bg-[#1f5ae6]" style={{ width: `${summary.usedPct}%` }} />
            <div className="h-2 bg-[#b9ccff] transition-[width] duration-300 dark:bg-[#3d5bb0]" style={{ width: `${Math.max(0, summary.givenPct - summary.usedPct)}%` }} />
          </div>
          <span className="text-[13px] text-[#3c3c43] dark:text-white/70">{formatMb(summary.usedMb)} used · {formatMb(summary.poolMb)} pool (free plan)</span>
        </div>
        <div className={card}>
          <span className="text-[13px] text-muted">Sent today</span>
          <span className="text-[28px] font-bold tracking-[-0.02em]">{sentToday} <span className="text-[15px] font-medium text-muted">/ {dailyLimit}</span></span>
          <span className="text-[13px] text-[#3c3c43] dark:text-white/70">Resets at 02:00 Kigali time</span>
        </div>
      </section>

      <section aria-label="All users" className="overflow-hidden rounded-[24px] border border-white/80 bg-white/[0.72] backdrop-blur-[26px] backdrop-saturate-[1.8] dark:border-white/10 dark:bg-[rgba(28,28,34,0.78)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-[14px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold whitespace-nowrap text-muted [&>th]:px-3.5 [&>th]:py-3">
                <th>User</th><th>Department</th><th>Role</th><th>Storage (− and + to change)</th><th>Forwards to</th><th>Status</th><th><span className="sr-only">Sign-in</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const d = m.departmentId ? dept.get(m.departmentId) : undefined;
                const use = quotaUse(m.usedBytes, m.quotaMb);
                const usedMb = bytesToMb(m.usedBytes);
                const less = stepQuota(m.quotaMb, -1, usedMb);
                const more = stepQuota(m.quotaMb, 1);
                const locked = m.role === "owner" && !isSuper;
                return (
                  <tr key={m.id} className="border-t border-[rgba(60,60,67,0.08)] align-middle dark:border-white/10 [&>td]:px-3.5 [&>td]:py-[13px]">
                    <td>
                      <span className="flex items-center gap-3"><Avatar name={m.name} seed={m.email} /><span className="flex flex-col"><span className="font-semibold">{m.name}</span><span className="text-[13px] text-muted">{m.email}</span></span></span>
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: d?.color ?? "#c7c7cc" }} />
                        <select aria-label={`Department of ${m.name}`} value={m.departmentId ?? ""} disabled={locked} onChange={(e) => save(m, "departmentId", e.target.value)} className={cn(selectPill, "bg-transparent px-0 text-[14px] font-normal hover:underline")}>
                          <option value="">None</option>
                          {depts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        {m.isHead && <span className="inline-flex h-5 items-center rounded-md bg-[#fff4e5] px-[7px] text-[11.5px] font-bold text-[#8a4b00] dark:bg-[#8a4b00]/40 dark:text-[#ffd8a8]">Head</span>}
                      </span>
                    </td>
                    <td>
                      <select aria-label={`Role of ${m.name}`} value={m.role} disabled={!isSuper || m.email === myEmail} title={!isSuper ? "Only a super admin can change roles" : undefined} onChange={(e) => save(m, "role", e.target.value)} className={cn(selectPill, m.role === "member" ? "bg-[rgba(60,60,67,0.08)] dark:bg-white/10" : "bg-[#1d1d1f] text-white dark:bg-white dark:text-[#1d1d1f]")}>
                        {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td>
                      <span className="flex items-center gap-2.5">
                        <button type="button" className={step} aria-label={`Less storage for ${m.name}`} disabled={!less || locked || pending} title={!less && m.quotaMb > 50 ? "They already use more than the next step down" : undefined} onClick={() => less && save(m, "quotaMb", String(less))}>−</button>
                        <span className="flex w-[130px] flex-col gap-[5px]">
                          <span className="flex justify-between text-[12.5px]"><span className="text-[#3c3c43] dark:text-white/70">{formatMb(usedMb)}</span><span className="font-bold">{formatMb(m.quotaMb)}</span></span>
                          <span className="block h-1.5 overflow-hidden rounded-full bg-[rgba(60,60,67,0.1)] dark:bg-white/10"><span className={cn("block h-1.5 rounded-full transition-[width] duration-300", use.warn ? "bg-[#ff9500]" : "bg-[#1f5ae6]")} style={{ width: `${use.pct}%` }} /></span>
                        </span>
                        <button type="button" className={step} aria-label={`More storage for ${m.name}`} disabled={!more || locked || pending} onClick={() => more && save(m, "quotaMb", String(more))}>+</button>
                      </span>
                    </td>
                    <td className="text-[13.5px] text-[#3c3c43] dark:text-white/70">{m.forwards || "—"}</td>
                    <td>
                      <select aria-label={`Status of ${m.name}`} value={m.status === "suspended" ? "suspended" : "active"} disabled={locked || m.email === myEmail} onChange={(e) => save(m, "status", e.target.value)} className={cn(selectPill, STATUS_STYLE[m.status] ?? STATUS_STYLE.active)}>
                        <option value="active">{m.status === "invited" ? "Invited" : "Active"}</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {m.email !== myEmail && (isSuper || m.role === "member") && (authFor === m.id ? (
                        <span className="mr-1 inline-flex items-center gap-1">
                          <button type="button" disabled={pending} onClick={() => start(async () => { setNote(await resetMailAuthenticator(m.id)); setAuthFor(null); })} className="h-8 cursor-pointer rounded-full bg-[#b42318] px-3 text-[12.5px] font-semibold text-white">Yes, reset</button>
                          <button type="button" onClick={() => setAuthFor(null)} className="h-8 cursor-pointer rounded-full px-3 text-[12.5px]">Cancel</button>
                        </span>
                      ) : (
                        <button type="button" title="Lost phone: they add a new authenticator at the next sign-in" onClick={() => setAuthFor(m.id)} className={cn(smallBtn, "mr-1")}>Reset authenticator</button>
                      ))}
                      {isSuper && (pwFor === m.id ? (
                        <span className="inline-flex items-center gap-1">
                          <button type="button" disabled={pending} onClick={() => start(async () => { setNote(await newMailPassword(m.id)); setPwFor(null); })} className="h-8 cursor-pointer rounded-full bg-[#b42318] px-3 text-[12.5px] font-semibold text-white">Yes, new password</button>
                          <button type="button" onClick={() => setPwFor(null)} className="h-8 cursor-pointer rounded-full px-3 text-[12.5px]">Cancel</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setPwFor(m.id)} className={smallBtn}>New password</button>
                      ))}
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && <tr><td colSpan={7} className="px-3.5 py-5 text-muted">No users yet. The owner (ADMIN_EMAILS) always has access. <Link href="/mail/console/new" className="font-semibold text-[#1f5ae6]">Create the first one</Link>.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <div aria-live="polite"><Note s={note} /></div>
    </>
  );
}
