"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronLeft } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { cn } from "@/lib/cn";
import { formatMb, initialOf, LOCAL_PART, QUOTAS } from "@/lib/mail/console-rules";
import { signatureHtmlFor, type SignatureCompany } from "@/lib/mail/signature-render";
import { checkMailAddress, createDepartment, createMailUser, type ConsoleState } from "@/app/mail/(console)/console/actions";
import { darkBtn, ghostBtn, h1, h2, hint, input, label, panel } from "./console-styles";
import { Avatar, Note, Switch } from "./console-ui";

// Mail console: Create a user (design ConsoleNewUser). No invite email: the admin hands over a one-time password, the
// person chooses their own at the first sign-in, then adds an authenticator.

type Dept = { id: string; name: string; color: string; headName: string | null };
type Shared = { id: string; name: string; address: string; everyone: boolean; departmentId: string | null };
type Props = { depts: Dept[]; shared: Shared[]; poolLeftMb: number; company: SignatureCompany; look: string; isSuper: boolean };

const ROLES = [
  { id: "member", name: "Member", text: "Their own inbox, shared ones you tick, and mail an admin forwards to them." },
  { id: "admin", name: "Mail admin", text: "Also opens this console and can send to any department." },
  { id: "owner", name: "Super admin", text: "Everything a mail admin does, plus roles, new passwords and other admins." },
] as const;

const chosen = "bg-white shadow-[0_0_0_2px_#1f5ae6,0_10px_24px_-16px_rgba(31,90,230,0.8)] dark:bg-white/10";
const unchosen = "bg-white/90 shadow-[inset_0_0_0_1px_rgba(60,60,67,0.14)] dark:bg-white/5 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]";

export function NewUserView(props: Props) {
  const [round, setRound] = useState(0);
  return <NewUserForm key={round} {...props} again={() => setRound((r) => r + 1)} />;
}

function NewUserForm({ depts: initialDepts, shared, poolLeftMb, company, look, isSuper, again }: Props & { again: () => void }) {
  const [state, action, submitting] = useActionState<ConsoleState, FormData>(createMailUser, {});
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [local, setLocal] = useState("");
  const [check, setCheck] = useState<{ local: string; free: boolean; message: string } | null>(null);
  const [depts, setDepts] = useState(initialDepts);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [head, setHead] = useState(false);
  const [role, setRole] = useState<string>("member");
  const [quota, setQuota] = useState(250);
  const [access, setAccess] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newDept, setNewDept] = useState("");
  const [deptNote, setDeptNote] = useState<ConsoleState>({});
  const [deptPending, startDept] = useTransition();
  const seq = useRef(0);

  const clean = local.trim().toLowerCase();
  // The live "address is free" check, a moment after typing stops.
  useEffect(() => {
    if (!clean) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await checkMailAddress(clean).catch(() => null);
      if (r && n === seq.current) setCheck({ local: clean, free: r.free, message: r.message });
    }, 350);
    return () => clearTimeout(t);
  }, [clean]);

  const address = `${clean || "name"}@bupulse.com`;
  const first = name.trim().split(/\s+/)[0] || "They";
  const dept = depts.find((d) => d.id === deptId) ?? null;
  const live = clean && check?.local === clean ? check : null;
  const badLocal = !!clean && !LOCAL_PART.test(clean);
  const roleName = ROLES.find((r) => r.id === role)?.name ?? "Member";
  const sigHtml = signatureHtmlFor(look, company, { name: name.trim() || "Their name", title: title.trim() || null, email: address, mobile: null, extra: null });

  if (state.ok) {
    return (
      <>
        <Link href="/mail/console" className="inline-flex w-fit items-center gap-1 text-[14px] font-medium text-[#1f5ae6] dark:text-[#9dbbff]"><ChevronLeft className="size-4" strokeWidth={2.2} aria-hidden />Users</Link>
        <h1 className={h1}>{state.email ?? "The user"} is ready</h1>
        <section className={cn(panel, "flex max-w-[720px] flex-col gap-4 p-[22px]")}>
          <Note s={state} />
          {state.password && <p className="m-0 text-[14px] leading-relaxed text-[#3c3c43] dark:text-white/70">Hand it over in person or by phone, not by email. At the first sign-in on bupulse.com/mail ({"“"}Password{"”"} tab) {first === "They" ? "they choose" : `${first} chooses`} a new password, then adds an authenticator app.</p>}
          <div className="flex flex-wrap gap-2.5">
            <button type="button" onClick={again} className={darkBtn}>Create another</button>
            <Link href="/mail/console" className={ghostBtn}>Back to users</Link>
          </div>
        </section>
      </>
    );
  }

  const addDept = () =>
    startDept(async () => {
      const r = await createDepartment(newDept);
      setDeptNote(r.error ? r : {});
      if (r.id && r.name && r.color) {
        setDepts((d) => [...d, { id: r.id!, name: r.name!, color: r.color!, headName: null }]);
        setDeptId(r.id);
        setHead(true);
        setAdding(false);
        setNewDept("");
      }
    });

  return (
    <>
      <Link href="/mail/console" className="inline-flex w-fit items-center gap-1 text-[14px] font-medium text-[#1f5ae6] dark:text-[#9dbbff]"><ChevronLeft className="size-4" strokeWidth={2.2} aria-hidden />Users</Link>
      <h1 className={h1}>Create a user</h1>

      <div className="flex flex-wrap items-start gap-4">
        <form action={action} className="flex min-w-0 flex-[999_1_500px] flex-col gap-4">
          <section className={cn(panel, "flex flex-col gap-4 p-[22px]")}>
            <h2 className={h2}>Who they are</h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
              <label className={label}>Full name<input name="name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={input} /></label>
              <label className={label}>Job title<input name="title" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" className={input} /><span className={hint}>Goes in their signature</span></label>
            </div>
            <label className={label}>Email address
              <span className={cn("flex items-stretch overflow-hidden rounded-xl bg-white/95 dark:bg-white/5", live && !live.free || badLocal ? "shadow-[0_0_0_2px_#b42318]" : "shadow-[0_0_0_2px_#1f5ae6]")}>
                <input name="local" required value={local} onChange={(e) => setLocal(e.target.value.replace(/\s/g, "").toLowerCase())} placeholder="grace" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="addr-check" className="h-[46px] min-w-0 flex-1 bg-transparent px-3.5 text-[15px] font-medium outline-none" />
                <span className="inline-flex items-center bg-[rgba(60,60,67,0.06)] px-3.5 text-[15px] font-medium text-[#3c3c43] dark:bg-white/10 dark:text-white/70">@bupulse.com</span>
              </span>
              <span id="addr-check" aria-live="polite" className={cn(hint, live?.free && "text-[#11633a] dark:text-[#9fe0bb]", (live && !live.free || badLocal) && "text-[#b42318] dark:text-[#ffb4ab]")}>
                {badLocal ? "Use letters, numbers, dots or dashes (e.g. grace)." : live ? live.message : clean ? "Checking…" : "Their own address, e.g. grace@bupulse.com"}
              </span>
            </label>
            <div className={label}>
              <span>Personal phone (optional)</span>
              <PhoneInput name="phone" placeholder="720 123 456" countryLabel="Country" />
              <span className={hint}>The company phone is added to every signature by itself</span>
            </div>
          </section>

          <section className={cn(panel, "flex flex-col gap-4 p-[22px]")}>
            <h2 className={h2}>Department</h2>
            <input type="hidden" name="departmentId" value={deptId ?? ""} />
            <div role="radiogroup" aria-label="Department" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
              {depts.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={deptId === d.id} onClick={() => { setDeptId(deptId === d.id ? null : d.id); setHead(false); }} className={cn("flex cursor-pointer items-center gap-2.5 rounded-2xl p-3.5 text-left transition-shadow", deptId === d.id ? chosen : unchosen)}>
                  <span aria-hidden className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold text-white" style={{ background: d.color }}>{initialOf(d.name)}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{d.name}</span>
                  {deptId === d.id && <Check className="size-[18px] text-[#1f5ae6]" strokeWidth={2.6} aria-hidden />}
                </button>
              ))}
              {adding ? (
                <span className="flex items-center gap-1.5 rounded-2xl bg-white/90 p-2 shadow-[inset_0_0_0_1.5px_rgba(60,60,67,0.25)] dark:bg-white/5">
                  <input autoFocus value={newDept} onChange={(e) => setNewDept(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDept(); } if (e.key === "Escape") setAdding(false); }} placeholder="Name" aria-label="New department name" className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[14px] outline-none" />
                  <button type="button" disabled={deptPending || !newDept.trim()} onClick={addDept} className="h-9 cursor-pointer rounded-xl bg-[#1f5ae6] px-3 text-[13px] font-semibold text-white disabled:opacity-50">Add</button>
                </span>
              ) : (
                <button type="button" onClick={() => setAdding(true)} className="flex cursor-pointer items-center justify-center rounded-2xl bg-white/50 p-3.5 font-semibold text-[#1f5ae6] shadow-[inset_0_0_0_1.5px_rgba(60,60,67,0.25)] dark:bg-white/5 dark:text-[#9dbbff]">+ New</button>
              )}
            </div>
            <Note s={deptNote} />
            {dept && (
              <div className="flex items-center gap-3.5 rounded-2xl bg-white/75 px-4 py-3.5 dark:bg-white/5">
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">Head of {dept.name}</span>
                  <span className="text-[13px] text-muted">{dept.headName ? `Today: ${dept.headName}. Turning this on makes ${first === "They" ? "this person" : first} the head instead.` : `No head yet. The head may send to everyone in ${dept.name}.`}</span>
                </span>
                <Switch on={head} onChange={setHead} label={`Head of ${dept.name}`} />
                {head && <input type="hidden" name="head" value="on" />}
              </div>
            )}
            <div role="radiogroup" aria-label="Role" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
              {ROLES.filter((r) => r.id !== "owner" || isSuper).map((r) => (
                <label key={r.id} className={cn("flex cursor-pointer gap-3 rounded-2xl p-3.5 transition-shadow", role === r.id ? chosen : unchosen)}>
                  <input type="radio" name="role" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} className="mt-0.5 size-[18px] accent-[#1f5ae6]" />
                  <span className="flex flex-col gap-[3px]"><span className="font-semibold">{r.name}</span><span className="text-[13px] leading-[1.45] text-[#3c3c43] dark:text-white/70">{r.text}</span></span>
                </label>
              ))}
            </div>
          </section>

          {role === "member" && shared.length > 0 && (
            <section className={cn(panel, "flex flex-col gap-3 p-[22px]")}>
              <h2 className={h2}>Shared mailboxes</h2>
              <span className={hint}>Tick the shared mailboxes {first === "They" ? "they" : first} may read and send from.</span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {shared.map((b) => {
                  const auto = b.everyone || (!!b.departmentId && b.departmentId === deptId);
                  return (
                    <li key={b.id}>
                      <label className={cn("flex items-center gap-3 rounded-2xl bg-white/75 px-4 py-3 dark:bg-white/5", auto ? "cursor-default" : "cursor-pointer")}>
                        <input type="checkbox" name={auto ? undefined : "access"} value={b.id} checked={auto || access.includes(b.id)} disabled={auto} onChange={(e) => setAccess((a) => (e.target.checked ? [...a, b.id] : a.filter((x) => x !== b.id)))} className="size-[18px] accent-[#1f5ae6]" />
                        <span className="flex flex-1 flex-col"><span className="font-semibold">{b.name}</span><span className="text-[13px] text-muted">{b.address}</span></span>
                        {auto && <span className="text-[12.5px] text-muted">{b.everyone ? "Everyone sees it" : "Their department"}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className={cn(panel, "flex flex-col gap-4 p-[22px]")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2.5"><h2 className={h2}>Storage</h2><span className={cn(hint, quota > poolLeftMb && "text-[#8a4b00] dark:text-[#ffd8a8]")}>{quota > poolLeftMb ? `Only ${formatMb(poolLeftMb)} left in the team pool: lower someone else's first` : `${formatMb(poolLeftMb)} still free in the team pool`}</span></div>
            <input type="hidden" name="quotaMb" value={quota} />
            <div role="radiogroup" aria-label="Storage allowance" className="flex flex-wrap gap-2">
              {QUOTAS.filter((q) => q >= 100).map((q) => (
                <button key={q} type="button" role="radio" aria-checked={quota === q} onClick={() => setQuota(q)} className={cn("inline-flex h-10 cursor-pointer items-center rounded-full px-4 text-[14px]", quota === q ? "bg-[#1d1d1f] font-semibold text-white dark:bg-white dark:text-[#1d1d1f]" : "bg-white/90 font-medium shadow-[inset_0_0_0_1px_rgba(60,60,67,0.18)] dark:bg-white/5 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]")}>{formatMb(q)}</button>
              ))}
            </div>
          </section>

          <Note s={state} />
          <div className="flex flex-wrap gap-2.5">
            <button disabled={submitting || badLocal || (!!live && !live.free)} className={cn(darkBtn, "h-12 px-6")}>{submitting ? "Creating…" : "Create user"}</button>
            <Link href="/mail/console" className={cn(ghostBtn, "h-12")}>Cancel</Link>
          </div>
        </form>

        <aside aria-label={`What ${first} gets`} className={cn(panel, "flex max-w-full min-w-0 flex-[1_1_340px] flex-col gap-4 p-[22px] lg:sticky lg:top-[18px]")}>
          <span className="text-[12px] font-semibold text-muted">What {first === "They" ? "they get" : `${first} gets`}</span>
          <div className="flex items-center gap-3">
            <Avatar name={name || "?"} seed={address} size={44} />
            <span className="flex min-w-0 flex-col"><span className="truncate text-[16px] font-semibold">{address}</span><span className="text-[13px] text-muted">{[dept?.name ?? "No department", roleName, formatMb(quota)].join(" · ")}</span></span>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white p-4 text-[#0f172a]" dangerouslySetInnerHTML={{ __html: sigHtml }} />
          <span className="text-[13px] leading-normal text-[#3c3c43] dark:text-white/70">Their signature is filled in now. They can pick another of the 5 looks and edit their own lines in Settings.</span>
          <span className="text-[13px] leading-normal text-[#3c3c43] dark:text-white/70">After you create the user you get a one-time password to hand over. At the first sign-in they choose their own password, then add an authenticator.</span>
        </aside>
      </div>
    </>
  );
}
