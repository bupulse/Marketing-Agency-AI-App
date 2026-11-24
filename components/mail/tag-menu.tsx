"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Plus, Tag } from "lucide-react";
import { cn } from "@/lib/cn";
import { createMailLabel, setThreadTag } from "@/app/mail/(app)/actions";
import { LABEL_HEX, TAG_STYLE, useMail } from "./shell";

// Tags by hand on a conversation (design "ReadSplit"): the built-in tags and the team's own tags, plus "New tag".
export function TagMenu({ threadId, tags, labelIds, className }: { threadId: string; tags: string[]; labelIds: string[]; className?: string }) {
  const { data } = useMail();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(new Set([...tags, ...labelIds]));
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const toggle = (id: string) => {
    const next = new Set(on);
    const v = !next.has(id);
    if (v) next.add(id); else next.delete(id);
    setOn(next);
    start(async () => { await setThreadTag(threadId, id, v); router.refresh(); });
  };
  const create = () => start(async () => {
    const r = await createMailLabel(name, color);
    if (r.ok && r.id) { setName(""); const id = r.id; setOn((s) => new Set([...s, id])); await setThreadTag(threadId, id, true); router.refresh(); }
  });
  const item = "flex h-9 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-[14px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]";
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label="Tags" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={className}><Tag className="size-[19px]" /></button>
      {open && (
        <div role="menu" aria-label="Tags" className="bmail-pop absolute right-0 top-11 z-30 w-[260px] rounded-2xl border border-white/80 bg-white/95 p-1.5 text-text shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c22]/95">
          <p className="px-3 pb-1 pt-1.5 text-[12px] font-semibold text-muted">Tag this conversation</p>
          {Object.entries(TAG_STYLE).map(([id, t]) => (
            <button key={id} type="button" role="menuitemcheckbox" aria-checked={on.has(id)} onClick={() => toggle(id)} className={item}>
              <span className="size-2.5 rounded-[3px]" style={{ background: t.color }} /><span className="flex-1">{t.label}</span>{on.has(id) && <Check className="size-4 text-[#1f5ae6]" />}
            </button>
          ))}
          {data.labels.map((l) => (
            <button key={l.id} type="button" role="menuitemcheckbox" aria-checked={on.has(l.id)} onClick={() => toggle(l.id)} className={item}>
              <span className="size-2.5 rounded-[3px]" style={{ background: LABEL_HEX[l.color] ?? LABEL_HEX.blue }} /><span className="flex-1 truncate">{l.name}</span>{on.has(l.id) && <Check className="size-4 text-[#1f5ae6]" />}
            </button>
          ))}
          <div className="mx-2 my-1.5 h-px bg-black/10 dark:bg-white/10" />
          <form onSubmit={(e) => { e.preventDefault(); create(); }} className="flex flex-col gap-2 px-2 pb-1.5">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="New tag" aria-label="New tag name" className="h-9 rounded-xl border border-black/12 bg-white px-3 text-[14px] outline-none focus:border-[#2f6bff] dark:border-white/15 dark:bg-white/5" />
            <span className="flex items-center gap-1.5">
              {Object.entries(LABEL_HEX).map(([c, hex]) => <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} className={cn("size-5 cursor-pointer rounded-full", color === c && "ring-2 ring-offset-2 ring-[#1f5ae6]")} style={{ background: hex }} />)}
              <span className="flex-1" />
              <button disabled={!name.trim()} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full bg-[#1f5ae6] px-3 text-[13px] font-semibold text-white disabled:opacity-40"><Plus className="size-3.5" />Add</button>
            </span>
          </form>
        </div>
      )}
    </div>
  );
}
