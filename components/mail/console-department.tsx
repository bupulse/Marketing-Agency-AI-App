"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type DragEvent } from "react";
import { ArrowLeft, ArrowRight, Check, GripVertical, Lock, Search, Trash2, UserMinus, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEPT_COLORS, initialOf } from "@/lib/mail/console-rules";
import { deleteDepartment, setDepartmentHead, setMemberDepartment, updateDepartment, type ConsoleState } from "@/app/mail/(console)/console/actions";
import { h1, panel, smallBtn, sub } from "./console-styles";
import { Avatar, Note } from "./console-ui";

// Mail console > Departments > one department (owner 24 Nov 2026): click a department to open it, change its name and
// colour, pick its head, and move people in by dragging them from the whole team (or with Add / Remove buttons, which
// also work on phones and with the keyboard).

type Dept = { id: string; name: string; color: string; headMemberId: string | null };
type Person = { id: string; name: string; email: string; departmentId: string | null; locked: boolean; suspended: boolean };
type Moved = { id: string; name: string; from: string | null; to: string | null };

const DRAG_TYPE = "application/x-bmail-member";

export function DepartmentDetail({ dept, departments, people: initial }: { dept: Dept; departments: { id: string; name: string; color: string }[]; people: Person[] }) {
  const router = useRouter();
  const [people, setPeople] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // Fresh data from the server (after a save) replaces the local copy (React's "adjust state on a prop change").
  if (seen !== initial) {
    setSeen(initial);
    setPeople(initial);
  }
  const [name, setName] = useState(dept.name);
  const [color, setColor] = useState(dept.color);
  const [head, setHead] = useState(dept.headMemberId);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<ConsoleState>({});
  const [moved, setMoved] = useState<Moved | null>(null);
  const [over, setOver] = useState<"in" | "out" | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, start] = useTransition();

  const deptName = (id: string | null) => (id === dept.id ? name : departments.find((d) => d.id === id)?.name ?? null);
  const deptColor = (id: string | null) => (id === dept.id ? color : departments.find((d) => d.id === id)?.color ?? "#8e8e93");
  const members = people.filter((p) => p.departmentId === dept.id);
  const q = query.trim().toLowerCase();
  const others = useMemo(
    () => people.filter((p) => p.departmentId !== dept.id && (!q || p.name.toLowerCase().includes(q) || p.email.includes(q))),
    [people, dept.id, q],
  );

  /** Moves one person (optimistic: the lists change at once, and go back if the server says no). */
  const move = (id: string, to: string | null, undo = false) => {
    const person = people.find((p) => p.id === id);
    if (!person || person.departmentId === to) return;
    if (person.locked) return setNote({ error: "Only a super admin can move a super admin." });
    const from = person.departmentId;
    setPeople((list) => list.map((p) => (p.id === id ? { ...p, departmentId: to } : p)));
    if (to !== dept.id && head === id) setHead(null);
    setNote({});
    setMoved(undo ? null : { id, name: person.name, from, to });
    start(async () => {
      const r = await setMemberDepartment(id, to);
      if (r.error) {
        setPeople((list) => list.map((p) => (p.id === id ? { ...p, departmentId: from } : p)));
        setMoved(null);
        setNote(r);
      }
    });
  };

  const saveName = () => {
    const next = name.trim().replace(/\s+/g, " ");
    if (!next) return setName(dept.name);
    if (next === dept.name) return;
    start(async () => {
      const r = await updateDepartment(dept.id, { name: next });
      if (r.error) { setName(dept.name); setNote(r); } else setNote({ ok: `Renamed to ${next}.` });
    });
  };
  const pickColor = (c: string) => {
    setColor(c);
    start(async () => { const r = await updateDepartment(dept.id, { color: c }); if (r.error) { setColor(dept.color); setNote(r); } });
  };
  const pickHead = (id: string | null) => {
    setHead(id);
    start(async () => { await setDepartmentHead(dept.id, id); });
  };
  const remove = () =>
    start(async () => {
      const r = await deleteDepartment(dept.id, members.length > 0);
      if (r.error) return setNote(r);
      router.push("/mail/console/departments");
    });

  // Drag and drop: a row carries the person's id; the two lists are the drop targets.
  const dragStart = (e: DragEvent, p: Person) => {
    if (p.locked) return e.preventDefault();
    e.dataTransfer.setData(DRAG_TYPE, p.id);
    e.dataTransfer.setData("text/plain", p.email);
    e.dataTransfer.effectAllowed = "move";
    setDragging(p.id);
  };
  const dropZone = (zone: "in" | "out") => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== zone) setOver(zone);
    },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      setDragging(null);
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (!id) return;
      const p = people.find((x) => x.id === id);
      if (zone === "in") move(id, dept.id);
      else if (p?.departmentId === dept.id) move(id, null);
    },
  });

  const movedText = moved
    ? moved.to === dept.id
      ? moved.from ? `${moved.name} moved from ${deptName(moved.from)} to ${name}.` : `${moved.name} is now in ${name}.`
      : `${moved.name} is no longer in ${name}.`
    : "";

  return (
    <>
      <Link href="/mail/console/departments" className="inline-flex w-fit items-center gap-1.5 text-[14px] font-semibold text-[#1f5ae6] hover:underline dark:text-[#8fb4ff]"><ArrowLeft className="size-4" />All departments</Link>

      <header className={cn(panel, "flex flex-col gap-4 p-5 sm:p-6")}>
        <div className="flex flex-wrap items-center gap-4">
          <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-[18px] text-[22px] font-bold text-white transition-colors" style={{ background: color }}>{initialOf(name || dept.name)}</span>
          <label className="flex min-w-0 flex-[1_1_260px] flex-col">
            <span className="text-[12.5px] font-semibold text-muted">Department name (click to change)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(dept.name); e.currentTarget.blur(); } }}
              maxLength={40}
              aria-label="Department name"
              className={cn(h1, "-ml-2 w-full min-w-0 rounded-xl border border-transparent bg-transparent px-2 py-0.5 outline-none hover:border-black/10 focus:border-[#2f6bff] focus:bg-white/80 dark:hover:border-white/15 dark:focus:bg-white/5")}
            />
          </label>
          <span className="inline-flex h-9 items-center gap-2 rounded-full bg-black/[0.05] px-4 text-[14px] font-semibold dark:bg-white/10"><Users className="size-4" />{members.length === 1 ? "1 person" : `${members.length} people`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-muted">Colour</span>
            <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
              {DEPT_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color.toLowerCase() === c} aria-label={c} onClick={() => pickColor(c)} className={cn("size-7 cursor-pointer rounded-full transition-transform hover:scale-110", color.toLowerCase() === c && "shadow-[0_0_0_2px_#fff,0_0_0_4px_#1f5ae6] dark:shadow-[0_0_0_2px_#1c1c22,0_0_0_4px_#9dbbff]")} style={{ background: c }} />
              ))}
            </div>
          </div>
          <label className="flex min-w-[220px] flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-muted">Head (can send to the whole department)</span>
            <select value={head ?? ""} onChange={(e) => pickHead(e.target.value || null)} disabled={members.length === 0} className="h-10 cursor-pointer rounded-xl border border-black/15 bg-white/90 px-3 text-[14.5px] font-semibold outline-none focus:border-[#2f6bff] disabled:cursor-default disabled:opacity-60 dark:border-white/15 dark:bg-white/5">
              <option value="">{members.length ? "No head yet (pick one)" : "Add people first"}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <span className="flex-1" />
          {confirmDelete ? (
            <span role="alertdialog" aria-label={`Delete ${name}`} className="flex flex-wrap items-center gap-2 rounded-2xl bg-[#fdecec] px-3 py-2 text-[13.5px] text-[#7a1a12] dark:bg-[#b42318]/20 dark:text-[#ffb4ab]">
              {members.length ? `${members.length === 1 ? "1 person moves" : `${members.length} people move`} to no department.` : `Delete ${name}?`}
              <button type="button" onClick={remove} className="h-8 cursor-pointer rounded-full bg-[#b42318] px-3 text-[12.5px] font-semibold text-white">Delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 cursor-pointer rounded-full px-3 text-[12.5px]">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className={cn(smallBtn, "h-9 gap-1.5 text-[#b42318] dark:text-[#ffb4ab]")}><Trash2 className="size-4" />Delete department</button>
          )}
        </div>
      </header>

      <Note s={note} />
      {moved && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#1d1d1f] px-4 py-2.5 text-[14px] text-white shadow-lg dark:bg-white dark:text-[#1d1d1f]">
          <Check className="size-4 text-[#7ee2a8] dark:text-[#11633a]" />
          <span className="flex-1">{movedText}</span>
          <button type="button" onClick={() => move(moved.id, moved.from, true)} className="h-8 cursor-pointer rounded-lg px-3 font-semibold text-[#9dbbff] hover:bg-white/10 dark:text-[#1f5ae6] dark:hover:bg-black/5">Undo</button>
        </div>
      )}

      <p className={cn(sub, "-mb-1")}>Drag a person from <b>Everyone</b> into <b>{name || dept.name}</b>, or press <b>Add</b>. Drag them back, or press <b>Remove</b>, to take them out. Each person is in one department.</p>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Everyone" {...dropZone("out")} className={cn(panel, "flex min-h-[360px] flex-col gap-3 p-4 transition", over === "out" && "ring-2 ring-[#8e8e93] ring-offset-2 ring-offset-transparent")}>
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-[17px] font-semibold">Everyone <span className="text-[14px] font-normal text-muted">{others.length}</span></h2>
          </div>
          <label className="relative block">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person or address" aria-label="Find a person" className="h-10 w-full rounded-xl border border-black/12 bg-white/90 pl-9 pr-3 text-[14.5px] outline-none focus:border-[#2f6bff] dark:border-white/15 dark:bg-white/5" />
          </label>
          <ul className="flex flex-col gap-1.5">
            {others.map((p) => (
              <PersonRow key={p.id} p={p} dragging={dragging === p.id} onDragStart={(e) => dragStart(e, p)} onDragEnd={() => { setDragging(null); setOver(null); }}
                chip={p.departmentId ? { name: deptName(p.departmentId) ?? "Other", color: deptColor(p.departmentId) } : null}
                action={<button type="button" disabled={p.locked} onClick={() => move(p.id, dept.id)} aria-label={`Add ${p.name} to ${name}`} className={cn(smallBtn, "h-9 shrink-0 gap-1 bg-white/80 px-3.5 font-semibold dark:bg-white/5")}>Add<ArrowRight className="size-3.5" /></button>} />
            ))}
            {others.length === 0 && <li className="px-2 py-8 text-center text-[14px] text-muted">{q ? "Nobody matches that." : "Everyone is already in this department."}</li>}
          </ul>
        </section>

        <section aria-label={`In ${name}`} {...dropZone("in")} className={cn(panel, "flex min-h-[360px] flex-col gap-3 p-4 transition", over === "in" && "bg-[rgba(214,227,255,0.85)] ring-2 ring-[#1f5ae6] dark:bg-[rgba(45,63,107,0.6)]")}>
          <h2 className="flex items-center gap-2 text-[17px] font-semibold"><span aria-hidden className="size-3 rounded-full" style={{ background: color }} />In {name || dept.name} <span className="text-[14px] font-normal text-muted">{members.length}</span></h2>
          <ul className="flex flex-col gap-1.5">
            {members.map((p) => (
              <PersonRow key={p.id} p={p} dragging={dragging === p.id} onDragStart={(e) => dragStart(e, p)} onDragEnd={() => { setDragging(null); setOver(null); }} head={head === p.id}
                action={<button type="button" disabled={p.locked} onClick={() => move(p.id, null)} aria-label={`Remove ${p.name} from ${name}`} className={cn(smallBtn, "h-9 shrink-0 gap-1.5 px-3.5")}><UserMinus className="size-3.5" />Remove</button>} />
            ))}
          </ul>
          {members.length === 0 && (
            <div className={cn("flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center text-[14.5px] text-muted transition", over === "in" ? "border-[#1f5ae6] text-[#1f5ae6]" : "border-black/15 dark:border-white/15")}>
              <Users className="size-7" />Drag people here from Everyone, or press Add.
            </div>
          )}
          {members.length > 0 && <div aria-hidden className={cn("rounded-2xl border-2 border-dashed px-4 py-4 text-center text-[13.5px] transition", over === "in" ? "border-[#1f5ae6] text-[#1f5ae6]" : "border-transparent text-transparent")}>Drop to add to {name}</div>}
        </section>
      </div>
    </>
  );
}

function PersonRow({ p, dragging, onDragStart, onDragEnd, chip, head, action }: {
  p: Person; dragging: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void;
  chip?: { name: string; color: string } | null; head?: boolean; action: React.ReactNode;
}) {
  return (
    <li
      draggable={!p.locked}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={p.locked ? "Only a super admin can move a super admin" : "Drag to move"}
      className={cn("group flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white/85 py-2 pl-2 pr-2 transition dark:border-white/10 dark:bg-white/[0.06]", !p.locked && "cursor-grab hover:border-black/15 hover:shadow-[0_8px_20px_-14px_rgba(15,23,42,0.5)] active:cursor-grabbing", dragging && "opacity-40")}
    >
      <span aria-hidden className="text-black/25 group-hover:text-black/45 dark:text-white/25">{p.locked ? <Lock className="size-4" /> : <GripVertical className="size-4" />}</span>
      <Avatar name={p.name} seed={p.email} size={36} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 truncate text-[14.5px] font-semibold">
          <span className="truncate">{p.name}</span>
          {head && <span className="shrink-0 rounded-full bg-[#fdf0d9] px-2 py-0.5 text-[11.5px] font-semibold text-[#7d4c00]">Head</span>}
          {p.suspended && <span className="shrink-0 rounded-full bg-black/[0.06] px-2 py-0.5 text-[11.5px] font-medium text-muted dark:bg-white/10">Suspended</span>}
        </span>
        <span className="truncate text-[13px] text-muted">{p.email}</span>
      </span>
      {chip !== undefined && (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-black/[0.05] px-2.5 py-1 text-[12px] font-medium text-[#3c3c43] sm:inline-flex dark:bg-white/10 dark:text-white/70">
          {chip ? <><span aria-hidden className="size-2 rounded-full" style={{ background: chip.color }} />{chip.name}</> : "No department"}
        </span>
      )}
      {action}
    </li>
  );
}
