"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const VALID = /^[^\s@<>()",;:\\[\]]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const clean = (s: string) => s.trim().replace(/^.*<([^>]+)>\s*$/, "$1").replace(/[,;]+$/, "").trim();

/** To / Cc / Bcc: each address becomes a chip on Enter, comma, Tab or leaving the field (owner, 23 Nov 2026). */
export function RecipientInput({ id, value, onChange, autoFocus, placeholder }: { id: string; value: string[]; onChange: (v: string[]) => void; autoFocus?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map(clean).filter(Boolean);
    if (!parts.length) return;
    onChange([...value, ...parts.filter((p) => !value.includes(p.toLowerCase()) && !value.includes(p))]);
    setDraft("");
  };
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1.5" onClick={() => input.current?.focus()}>
      {value.map((a) => {
        const ok = VALID.test(a);
        return (
          <span key={a} title={ok ? a : "This is not an email address"} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full pl-1 pr-1.5 text-[13.5px] font-medium", ok ? "bg-[#ececf1] text-[#1d1d1f] dark:bg-white/10 dark:text-white" : "bg-[#fdecec] text-[#b42318]")}>
            <span aria-hidden className={cn("inline-flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-white", ok ? "bg-[#5c6bff]" : "bg-[#b42318]")}>{a[0]?.toUpperCase()}</span>
            {a}
            <button type="button" aria-label={`Remove ${a}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== a)); }} className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full hover:bg-black/10"><X className="size-3.5" /></button>
          </span>
        );
      })}
      <input
        id={id}
        ref={input}
        value={draft}
        autoFocus={autoFocus}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => (/[,;]$/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === "Tab") && draft.trim()) { e.preventDefault(); add(draft); }
          else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/[,;\s]/.test(t.trim())) { e.preventDefault(); add(t); } }}
        onBlur={() => draft.trim() && add(draft)}
        className="h-8 min-w-[140px] flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted"
      />
    </div>
  );
}
