"use client";

import { useActionState, useTransition } from "react";
import { PhoneInput } from "@/components/ui/phone-input";
import { addForwarder, createMailUser, removeForwarder, saveCompany, setDepartmentHead, toggleForwarder, updateMailUser, type ConsoleState } from "@/app/mail/(app)/console/actions";

type Dept = { id: string; name: string; color: string; headMemberId: string | null };
type Member = { id: string; name: string; email: string; role: string; departmentId: string | null; quotaMb: number; status: string };
type Fwd = { id: string; source: string; target: string; external: boolean; keepCopy: boolean; enabled: boolean; verified: boolean };
type Company = { companyPhone: string; website: string; address: string; linkedinUrl: string; instagramUrl: string; facebookUrl: string; ctaText: string; ctaUrl: string };

const card = "rounded-[22px] border border-white/80 bg-white/[0.86] p-5 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.4)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(28,28,34,0.86)]";
const input = "h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-[15px] outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/25 dark:border-white/15 dark:bg-white/5";
const label = "flex flex-col gap-1.5 text-[13px] font-semibold";
const btn = "h-11 cursor-pointer rounded-full bg-[#1f5ae6] px-5 text-[14.5px] font-semibold text-white hover:bg-[#1a4fd0] disabled:opacity-60";

function Note({ s }: { s: ConsoleState }) {
  if (s.error) return <p role="alert" className="rounded-xl bg-[#fdecec] px-4 py-2.5 text-[13.5px] font-medium text-[#b42318]">{s.error}</p>;
  if (s.ok) return (
    <div role="status" className="flex flex-col gap-2 rounded-xl bg-[#e9f7ef] px-4 py-2.5 text-[13.5px] text-[#11633a]">
      <span>{s.ok}</span>
      {s.password && <code className="w-fit select-all rounded-lg bg-white px-3 py-1.5 font-mono text-[15px] text-[#1d1d1f]">{s.password}</code>}
    </div>
  );
  return null;
}

export function ConsoleView({ depts, members, forwarders, company, mailboxAddresses }: { depts: Dept[]; members: Member[]; forwarders: Fwd[]; company: Company; mailboxAddresses: string[] }) {
  const [userState, userAction, userPending] = useActionState<ConsoleState, FormData>(createMailUser, {});
  const [fwdState, fwdAction, fwdPending] = useActionState<ConsoleState, FormData>(addForwarder, {});
  const [coState, coAction, coPending] = useActionState<ConsoleState, FormData>(saveCompany, {});
  const [, edit] = useActionState<ConsoleState, FormData>(updateMailUser, {});
  const [pending, start] = useTransition();
  const deptName = new Map(depts.map((d) => [d.id, d.name]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="px-1 text-[28px] font-bold tracking-[-0.025em]">Mail console</h1>

      <section className={card} aria-labelledby="users">
        <h2 id="users" className="mb-3 text-[18px] font-semibold">Users</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead><tr className="text-left text-[12px] text-muted"><th className="py-2 pr-3">Person</th><th className="pr-3">Department</th><th className="pr-3">Role</th><th className="pr-3">Storage</th><th className="pr-3">Status</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-black/[0.07] dark:border-white/10">
                  <td className="py-2.5 pr-3"><div className="font-semibold">{m.name}</div><div className="text-[12.5px] text-muted">{m.email}</div></td>
                  <td className="pr-3">
                    <form action={edit}><input type="hidden" name="id" value={m.id} />
                      <select name="departmentId" defaultValue={m.departmentId ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-9 cursor-pointer rounded-lg border border-black/10 bg-transparent px-2"><option value="">None</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                    </form>
                  </td>
                  <td className="pr-3">
                    <form action={edit}><input type="hidden" name="id" value={m.id} />
                      <select name="role" defaultValue={m.role} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-9 cursor-pointer rounded-lg border border-black/10 bg-transparent px-2"><option value="member">Member</option><option value="admin">Mail admin</option></select>
                    </form>
                  </td>
                  <td className="pr-3">
                    <form action={edit}><input type="hidden" name="id" value={m.id} />
                      <select name="quotaMb" defaultValue={String(m.quotaMb)} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-9 cursor-pointer rounded-lg border border-black/10 bg-transparent px-2">{[50, 100, 250, 500, 1000].map((q) => <option key={q} value={q}>{q >= 1000 ? "1 GB" : `${q} MB`}</option>)}</select>
                    </form>
                  </td>
                  <td className="pr-3">
                    <form action={edit}><input type="hidden" name="id" value={m.id} />
                      <select name="status" defaultValue={m.status === "suspended" ? "suspended" : "active"} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-9 cursor-pointer rounded-lg border border-black/10 bg-transparent px-2"><option value="active">{m.status === "invited" ? "Invited" : "Active"}</option><option value="suspended">Suspended</option></select>
                    </form>
                  </td>
                </tr>
              ))}
              {members.length === 0 && <tr><td colSpan={5} className="py-4 text-muted">No users yet. The owner (ADMIN_EMAILS) always has access.</td></tr>}
            </tbody>
          </table>
        </div>
        <form action={userAction} className="mt-4 grid grid-cols-1 gap-3 border-t border-black/[0.07] pt-4 md:grid-cols-3 dark:border-white/10">
          <h3 className="text-[15px] font-semibold md:col-span-3">Create a user</h3>
          <label className={label}>Full name<input name="name" required className={input} /></label>
          <label className={label}>Email address<span className="flex items-stretch overflow-hidden rounded-xl border border-black/15 dark:border-white/15"><input name="local" required placeholder="grace" className="h-11 min-w-0 flex-1 bg-white px-3 text-[15px] outline-none dark:bg-white/5" /><span className="flex items-center bg-black/[0.04] px-3 text-[14px] text-muted">@bupulse.com</span></span></label>
          <label className={label}>Job title<input name="title" className={input} /></label>
          <div className={label}><span>Personal phone (optional)</span><PhoneInput name="phone" placeholder="720 123 456" countryLabel="Country" /></div>
          <label className={label}>Department<select name="departmentId" className={input}><option value="">None</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className={label}>Role<select name="role" className={input}><option value="member">Member</option><option value="admin">Mail admin</option></select></label>
          <label className={label}>Storage<select name="quotaMb" defaultValue="250" className={input}>{[50, 100, 250, 500, 1000].map((q) => <option key={q} value={q}>{q >= 1000 ? "1 GB" : `${q} MB`}</option>)}</select></label>
          <div className="flex items-end md:col-span-2"><button disabled={userPending} className={btn}>{userPending ? "Creating…" : "Create user"}</button></div>
          <div className="md:col-span-3"><Note s={userState} /></div>
        </form>
      </section>

      <section className={card} aria-labelledby="depts">
        <h2 id="depts" className="mb-3 text-[18px] font-semibold">Departments and heads</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {depts.map((d) => (
            <div key={d.id} className="flex flex-col gap-2 rounded-2xl bg-white/70 p-4 dark:bg-white/5">
              <span className="flex items-center gap-2 font-semibold"><span className="inline-block size-3 rounded" style={{ background: d.color }} />{d.name}</span>
              <span className="text-[12.5px] text-muted">{members.filter((m) => m.departmentId === d.id).length} people</span>
              <select aria-label={`Head of ${d.name}`} defaultValue={d.headMemberId ?? ""} disabled={pending} onChange={(e) => start(() => setDepartmentHead(d.id, e.target.value || null))} className="h-9 cursor-pointer rounded-lg border border-black/10 bg-transparent px-2 text-[14px]"><option value="">No head</option>{members.filter((m) => m.departmentId === d.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            </div>
          ))}
        </div>
      </section>

      <section className={card} aria-labelledby="fwd">
        <h2 id="fwd" className="mb-1 text-[18px] font-semibold">Forwarding</h2>
        <p className="mb-3 text-[13.5px] text-muted">To a @bupulse.com address: instant, shown as its own folder. To an outside address: free through Cloudflare, once Cloudflare has confirmed that address.</p>
        <ul className="mb-3 flex flex-col">
          {forwarders.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 border-t border-black/[0.07] py-2.5 text-[14px] dark:border-white/10">
              <span className="font-semibold">{f.source}</span><span className="text-muted">→</span><span>{f.target}</span>
              {f.external && <span className={f.verified ? "rounded-md bg-[#e2f5ea] px-2 py-0.5 text-[12px] font-semibold text-[#11633a]" : "rounded-md bg-[#fff4e5] px-2 py-0.5 text-[12px] font-semibold text-[#8a4b00]"}>{f.verified ? "Confirmed" : "Waiting for Cloudflare"}</span>}
              {!f.keepCopy && <span className="text-[12.5px] text-muted">no copy kept</span>}
              <span className="flex-1" />
              <button type="button" disabled={pending} onClick={() => start(() => toggleForwarder(f.id, !f.enabled))} className="h-8 cursor-pointer rounded-full border border-black/15 px-3 text-[13px]">{f.enabled ? "On" : "Off"}</button>
              <button type="button" disabled={pending} onClick={() => start(() => removeForwarder(f.id))} className="h-8 cursor-pointer rounded-full px-3 text-[13px] text-[#b42318] hover:bg-[#fdecec]">Remove</button>
            </li>
          ))}
        </ul>
        <form action={fwdAction} className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className={label}>Mail that reaches<input name="source" list="bmail-boxes" required placeholder="grace@bupulse.com" className={input} /></label>
          <datalist id="bmail-boxes">{mailboxAddresses.map((a) => <option key={a} value={a} />)}</datalist>
          <label className={label}>Also goes to<input name="target" required placeholder="cyusa@bupulse.com" className={input} /></label>
          <label className="flex items-center gap-2 self-end pb-3 text-[13.5px]"><input type="checkbox" name="confirmed" className="size-4 accent-[#1f5ae6]" />Outside address is confirmed in Cloudflare</label>
          <div className="flex items-end"><button disabled={fwdPending} className={btn}>Add rule</button></div>
          <div className="md:col-span-4"><Note s={fwdState} /></div>
        </form>
      </section>

      <section className={card} aria-labelledby="company">
        <h2 id="company" className="mb-1 text-[18px] font-semibold">Company details in every signature</h2>
        <p className="mb-3 text-[13.5px] text-muted">Staff cannot change these. Each person adds their own mobile number.</p>
        <form action={coAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className={label}><span>Company phone</span><PhoneInput name="companyPhone" defaultValue={company.companyPhone} placeholder="720 123 456" countryLabel="Country" /></div>
          <label className={label}>Website<input name="website" defaultValue={company.website} className={input} /></label>
          <label className={`${label} md:col-span-2`}>Address<input name="address" defaultValue={company.address} className={input} /></label>
          <label className={label}>LinkedIn page<input name="linkedinUrl" defaultValue={company.linkedinUrl} placeholder="linkedin.com/company/bupulse" className={input} /></label>
          <label className={label}>Instagram<input name="instagramUrl" defaultValue={company.instagramUrl} placeholder="instagram.com/bupulse" className={input} /></label>
          <label className={label}>Facebook page<input name="facebookUrl" defaultValue={company.facebookUrl} placeholder="facebook.com/bupulse" className={input} /></label>
          <label className={label}>Button text<input name="ctaText" defaultValue={company.ctaText} className={input} /></label>
          <label className={`${label} md:col-span-2`}>Button link<input name="ctaUrl" defaultValue={company.ctaUrl} className={input} /></label>
          <div><button disabled={coPending} className={btn}>Save</button></div>
          <div className="md:col-span-2"><Note s={coState} /></div>
        </form>
      </section>
      <p className="px-1 text-[12.5px] text-muted">Departments shown: {depts.map((d) => deptName.get(d.id)).join(", ")}.</p>
    </div>
  );
}
