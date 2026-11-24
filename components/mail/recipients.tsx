"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Users, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEPT_PREFIX, deptToken, isDeptToken } from "@/lib/mail/personal";
import { suggest, type AddressBook } from "@/lib/mail/suggest";

const VALID = /^[^\s@<>()",;:\\[\]]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const clean = (s: string) => s.trim().replace(/^.*<([^>]+)>\s*$/, "$1").replace(/[,;]+$/, "").trim();
const AVATAR = ["#0d5f61", "#5131c4", "#8a4b00", "#11633a", "#1f5ae6", "#b4236b", "#3c3c43"];
const tint = (s: string) => AVATAR[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR.length];

/**
 * To / Cc / Bcc: each address becomes a chip on Enter, comma, Tab or leaving the field (owner, 23 Nov 2026). While
 * typing, suggestions show departments this person may send to (To only), team members, shared mailboxes and recent
 * contacts; arrows move, Enter or Tab picks, Esc closes. A department chip reads "Sales (4)".
 */
export function RecipientInput({ id, value, onChange, autoFocus, placeholder, book, departments = false }: { id: string; value: string[]; onChange: (v: string[]) => void; autoFocus?: boolean; placeholder?: string; book?: AddressBook | null; departments?: boolean }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const hits = useMemo(() => (book && draft.trim() ? suggest(draft, book, value, { departments }) : { departments: [], people: [] }), [book, draft, value, departments]);
  const options = [...hits.departments.map((d) => ({ key: deptToken(d.id), dept: d, person: null })), ...hits.people.map((p) => ({ key: p.address, dept: null, person: p }))];
  const showList = open && options.length > 0;
  const at = Math.min(active, Math.max(0, options.length - 1));

  const add = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map(clean).filter(Boolean);
    if (!parts.length) return;
    onChange([...value, ...parts.filter((p) => !value.includes(p.toLowerCase()) && !value.includes(p))]);
    setDraft("");
  };
  const pick = (key: string) => {
    if (!value.includes(key)) onChange([...value, key]);
    setDraft("");
    setActive(0);
    input.current?.focus();
  };
  const label = (a: string) => {
    if (isDeptToken(a)) {
      const g = book?.departments.find((d) => d.id === a.slice(DEPT_PREFIX.length));
      return g ? `${g.name} (${g.members.length})` : "Department";
    }
    return book?.people.find((p) => p.kind === "team" && p.address === a.toLowerCase())?.name ?? a;
  };

  return (
    <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1.5" onClick={() => input.current?.focus()}>
      {value.map((a) => {
        const dept = isDeptToken(a);
        const ok = dept || VALID.test(a);
        return (
          <span key={a} title={dept ? "Each person gets their own email" : ok ? a : "This is not an email address"} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full pl-1 pr-1.5 text-[13.5px] font-medium", dept ? "bg-[#1d1d1f] text-white dark:bg-white dark:text-[#1d1d1f]" : ok ? "bg-[#ececf1] text-[#1d1d1f] dark:bg-white/10 dark:text-white" : "bg-[#fdecec] text-[#b42318]")}>
            {dept ? (
              <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-full bg-white/20 dark:bg-black/10"><Users className="size-3.5" /></span>
            ) : (
              <span aria-hidden className={cn("inline-flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-white", ok ? "bg-[#5c6bff]" : "bg-[#b42318]")}>{a[0]?.toUpperCase()}</span>
            )}
            {label(a)}
            <button type="button" aria-label={`Remove ${label(a)}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== a)); }} className={cn("inline-flex size-5 cursor-pointer items-center justify-center rounded-full", dept ? "hover:bg-white/20" : "hover:bg-black/10")}><X className="size-3.5" /></button>
          </span>
        );
      })}
      <input
        id={id}
        ref={input}
        value={draft}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${at}` : undefined}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          setOpen(true);
          setActive(0);
          if (/[,;]$/.test(e.target.value)) add(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (showList && e.key === "ArrowDown") { e.preventDefault(); setActive((at + 1) % options.length); }
          else if (showList && e.key === "ArrowUp") { e.preventDefault(); setActive((at - 1 + options.length) % options.length); }
          else if (showList && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); pick(options[at].key); }
          else if (showList && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          else if ((e.key === "Enter" || e.key === "Tab") && draft.trim()) { e.preventDefault(); add(draft); }
          else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/[,;\s]/.test(t.trim())) { e.preventDefault(); add(t); } }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); if (draft.trim()) add(draft); }}
        className="h-8 min-w-[140px] flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted"
      />
      {showList && (
        <div id={listId} role="listbox" aria-label="Suggestions" className="bmail-rise absolute left-0 top-full z-30 mt-1 w-[min(380px,calc(100vw-3rem))] rounded-2xl border border-black/[0.12] bg-white/[0.94] p-1.5 shadow-[0_24px_50px_-20px_rgba(15,23,42,0.45)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#26262c]/95">
          {options.map((o, i) => (
            <div key={o.key}>
              {i === 0 && o.dept && <p className="mx-2.5 mb-1 mt-1.5 text-[11.5px] font-semibold text-muted">Departments</p>}
              {o.person && (i === 0 || options[i - 1].dept) && <p className="mx-2.5 mb-1 mt-2 text-[11.5px] font-semibold text-muted">People</p>}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === at}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.key)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-xl p-2.5", i === at && "bg-[rgba(31,90,230,0.1)] dark:bg-[rgba(122,162,255,0.16)]")}
              >
                {o.dept ? (
                  <span aria-hidden className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold" style={{ background: `${o.dept.color}22`, color: o.dept.color }}>{o.dept.name[0]?.toUpperCase()}</span>
                ) : (
                  <span aria-hidden className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white" style={{ background: tint(o.person!.address) }}>{(o.person!.name || o.person!.address)[0]?.toUpperCase()}</span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  {o.dept ? (
                    <>
                      <span className="truncate text-[14px] font-semibold">{o.dept.id === "everyone" ? "Everyone" : `${o.dept.name} department`}</span>
                      <span className="truncate text-[12.5px] text-muted">{o.dept.members.length} {o.dept.members.length === 1 ? "person" : "people"}{o.dept.head ? ` · head: ${o.dept.head}` : ""}</span>
                    </>
                  ) : (
                    <>
                      <span className="truncate text-[14px] font-semibold">{o.person!.kind === "mailbox" ? o.person!.address : o.person!.name}</span>
                      <span className="truncate text-[12.5px] text-muted">{o.person!.kind === "mailbox" ? o.person!.note : `${o.person!.address}${o.person!.note && o.person!.kind === "team" ? ` · ${o.person!.note}` : o.person!.kind === "recent" ? " · Recent" : ""}`}</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
