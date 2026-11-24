"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEPT_COLORS, firstNames, initialOf } from "@/lib/mail/console-rules";
import { createDepartment, deleteDepartment, setDepartmentHead, updateDepartment, type ConsoleState } from "@/app/mail/(console)/console/actions";
import { darkBtn, h1, input, panel, sub } from "./console-styles";
import { Avatar, Note } from "./console-ui";

// Mail console: Departments (design ConsoleDepartments): one card per department with its head and people, and who may
// send to a department as a whole.

type Person = { id: string; name: string; email: string };
type Dept = { id: string; name: string; color: string; headMemberId: string | null; members: Person[] };

function Swatches({ value, onPick, label }: { value: string; onPick: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {DEPT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} onClick={() => onPick(c)} className={cn("size-7 cursor-pointer rounded-full transition-transform hover:scale-110", value.toLowerCase() === c && "shadow-[0_0_0_2px_#fff,0_0_0_4px_#1f5ae6] dark:shadow-[0_0_0_2px_#1c1c22,0_0_0_4px_#9dbbff]")} style={{ background: c }} />
      ))}
    </div>
  );
}

export function DepartmentsView({ depts, dailyLimit }: { depts: Dept[]; dailyLimit: number }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEPT_COLORS[depts.length % DEPT_COLORS.length]);
  const [note, setNote] = useState<ConsoleState>({});
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const r = await createDepartment(name, color);
      setNote(r);
      if (!r.error) { setCreating(false); setName(""); }
    });

  return (
    <>
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-[1_1_320px]"><h1 className={h1}>Departments</h1><p className={sub}>Pick a department in To and everyone in it gets their own email, starting with their name.</p></div>
        <button type="button" onClick={() => setCreating((v) => !v)} aria-expanded={creating} className={darkBtn}><Plus className="size-[17px]" strokeWidth={2.2} aria-hidden />New department</button>
      </header>

      {creating && (
        <section aria-label="New department" className={cn(panel, "flex flex-wrap items-end gap-4 p-5")}>
          <label className="flex flex-[1_1_220px] flex-col gap-[7px] text-[13.5px] font-semibold">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} placeholder="e.g. Accounting" className={input} /></label>
          <div className="flex flex-col gap-[7px] text-[13.5px] font-semibold"><span>Colour</span><Swatches value={color} onPick={setColor} label="Colour" /></div>
          <button type="button" disabled={pending || !name.trim()} onClick={create} className={darkBtn}>Create</button>
        </section>
      )}
      <Note s={note} />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {depts.map((d) => <DeptCard key={d.id} d={d} onNote={setNote} />)}
        {depts.length === 0 && <p className="text-[14px] text-muted">No departments yet. Create the first one (Sales, Support, Office...).</p>}
      </div>

      <section aria-label="Who may send to a department" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5 rounded-[24px] border border-white/80 bg-white/60 p-5 backdrop-blur-[26px] backdrop-saturate-[1.8] dark:border-white/10 dark:bg-[rgba(28,28,34,0.7)]">
        {[
          ["Owner and mail admins", "Any department, or Everyone."],
          ["Heads of department", "Their own department only."],
          ["Members", "Type addresses one by one."],
          ["Each copy is one send", `Sending to 6 people uses 6 of the ${dailyLimit} daily sends.`],
        ].map(([t, x]) => (
          <div key={t} className="flex flex-col gap-1"><span className="text-[14.5px] font-bold">{t}</span><span className="text-[13.5px] leading-normal text-[#3c3c43] dark:text-white/70">{x}</span></div>
        ))}
      </section>
    </>
  );
}

function DeptCard({ d, onNote }: { d: Dept; onNote: (s: ConsoleState) => void }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newName, setNewName] = useState(d.name);
  const [pending, start] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const head = d.members.find((m) => m.id === d.headMemberId) ?? null;
  const count = d.members.length;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const run = (fn: () => Promise<ConsoleState>) => start(async () => { const r = await fn(); onNote(r.error ? r : {}); });

  return (
    <article className={cn(panel, "relative flex flex-col gap-3.5 p-5 transition duration-200 hover:-translate-y-[3px] hover:shadow-[0_22px_40px_-26px_rgba(15,23,42,0.5)]")}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] text-[17px] font-bold text-white" style={{ background: d.color }}>{initialOf(d.name)}</span>
        {renaming ? (
          <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await updateDepartment(d.id, { name: newName }); if (!r.error) setRenaming(false); return r; }); }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }} aria-label="Department name" className="h-9 min-w-0 flex-1 rounded-lg border border-black/15 bg-white px-2 text-[15px] outline-none focus:border-[#2f6bff] dark:border-white/15 dark:bg-white/5" />
            <button disabled={pending} className="h-9 cursor-pointer rounded-lg bg-[#1f5ae6] px-3 text-[13px] font-semibold text-white">Save</button>
          </form>
        ) : (
          <Link href={`/mail/console/departments/${d.id}`} aria-label={`Open ${d.name}: rename it and add people`} className="flex min-w-0 flex-1 flex-col rounded-lg outline-none after:absolute after:inset-0 after:rounded-[24px] after:content-[''] focus-visible:ring-2 focus-visible:ring-[#2f6bff]"><span className="truncate text-[17px] font-bold">{d.name}</span><span className="text-[13px] text-muted">{count === 1 ? "1 person" : `${count} people`}</span></Link>
        )}
        <div ref={menuRef} className="relative z-10">
          <button type="button" aria-label={`More for ${d.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-[#3c3c43] hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"><MoreHorizontal className="size-[18px]" /></button>
          {menu && (
            <div role="menu" className="absolute top-10 right-0 z-20 flex w-[248px] flex-col gap-1 rounded-2xl border border-white/80 bg-white/95 p-2 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-[#232329]/95">
              <button type="button" role="menuitem" onClick={() => { setRenaming(true); setNewName(d.name); setMenu(false); }} className="h-9 cursor-pointer rounded-lg px-3 text-left text-[14px] hover:bg-black/5 dark:hover:bg-white/10">Rename</button>
              <div className="px-3 py-1.5"><span className="mb-1.5 block text-[12px] font-semibold text-muted">Colour</span><Swatches value={d.color} label={`Colour of ${d.name}`} onPick={(c) => run(() => updateDepartment(d.id, { color: c }))} /></div>
              <button type="button" role="menuitem" onClick={() => { setConfirmDelete(true); setMenu(false); }} className="h-9 cursor-pointer rounded-lg px-3 text-left text-[14px] text-[#b42318] hover:bg-[#fdecec] dark:text-[#ffb4ab] dark:hover:bg-[#b42318]/20">Delete…</button>
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div role="alertdialog" aria-label={`Delete ${d.name}`} className="relative z-10 flex flex-col gap-2 rounded-[14px] bg-[#fdecec] px-3 py-2.5 text-[13.5px] text-[#7a1a12] dark:bg-[#b42318]/20 dark:text-[#ffb4ab]">
          <span>{count ? `${count === 1 ? "1 person is" : `${count} people are`} in ${d.name}. They move to no department.` : `Delete ${d.name}?`}</span>
          <span className="flex gap-1.5">
            <button type="button" disabled={pending} onClick={() => run(() => deleteDepartment(d.id, count > 0))} className="h-8 cursor-pointer rounded-full bg-[#b42318] px-3 text-[12.5px] font-semibold text-white">{count ? "Move them and delete" : "Delete"}</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 cursor-pointer rounded-full px-3 text-[12.5px]">Cancel</button>
          </span>
        </div>
      )}

      <div className="relative z-10 flex items-center gap-2.5 rounded-[14px] bg-white/70 px-3 py-2.5 dark:bg-white/5">
        {head ? <Avatar name={head.name} seed={head.email} size={32} /> : <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-full bg-black/[0.06] text-[13px] text-muted dark:bg-white/10">?</span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <select aria-label={`Head of ${d.name}`} value={d.headMemberId ?? ""} disabled={pending || count === 0} onChange={(e) => { const v = e.target.value || null; start(async () => { await setDepartmentHead(d.id, v); }); }} className="h-6 w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent text-[14px] font-semibold outline-none disabled:cursor-default">
            <option value="">{count ? "No head yet (pick one)" : "No head yet"}</option>
            {d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <span className="text-[12px] text-muted">Head · can send to this department</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="inline-flex">{d.members.slice(0, 6).map((m, i) => <span key={m.id} role="img" aria-label={m.name} className={cn("inline-flex", i > 0 && "-ml-1.5")}><Avatar name={m.name} seed={m.email} size={28} ring /></span>)}</span>
        <span className="text-[13px] text-[#3c3c43] dark:text-white/70">{count ? firstNames(d.members.map((m) => m.name)) : "Nobody yet: open it and drag people in."}</span>
      </div>
      <span className="-mt-1 inline-flex items-center gap-1 self-end text-[13px] font-semibold text-[#1f5ae6] dark:text-[#8fb4ff]">Open to edit and add people<ChevronRight className="size-4" /></span>
    </article>
  );
}
