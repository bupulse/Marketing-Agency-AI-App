"use client";

import { useRouter } from "next/navigation";
import { Building2, CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { searchPages } from "./nav";
import type { Permission } from "@/lib/staff/permissions";

type Company = { id: string; name: string; email: string | null; plan: string | null; status: string | null };
type Result = { key: string; href: string; title: string; sub: string; kind: "page" | "company" };

/**
 * Jump to any admin page or company: Cmd+K (Mac) or Ctrl+K, or the Search button. Arrow keys move, Enter opens, Esc
 * closes. Pages are matched here; companies come from /admin/search (name or any member's email).
 */
export function CommandPalette({ open, onOpenChange, permissions }: { open: boolean; onOpenChange: (open: boolean) => void; permissions: readonly Permission[] }) {
  const allowed = (p: Permission | readonly Permission[]) => (typeof p === "string" ? [p] : p).some((x) => permissions.includes(x));
  const companies_ = permissions.includes("clients.view");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open || !companies_ || q.trim().length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/admin/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal, headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : { companies: [] }))
        .then((d: { companies?: Company[] }) => setCompanies(d.companies ?? []))
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, open, companies_]);

  const results: Result[] = useMemo(() => {
    const pages = searchPages(q).filter((p) => allowed(p.perm)).slice(0, q ? 8 : 40).map((p) => ({ key: p.href, href: p.href, title: p.label, sub: p.group.title ? `${p.group.title} · ${p.description}` : p.description, kind: "page" as const }));
    const firms = !companies_ || q.trim().length < 2 ? [] : companies.map((c) => ({ key: `c:${c.id}`, href: `/admin/companies/${c.id}`, title: c.name, sub: [c.email, c.plan, c.status?.toLowerCase()].filter(Boolean).join(" · "), kind: "company" as const }));
    return [...pages, ...firms];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, companies, permissions, companies_]);

  if (!open) return null;
  const close = () => {
    onOpenChange(false);
    setQ("");
    setActive(0);
  };
  const go = (r: Result | undefined) => {
    if (!r) return;
    close();
    router.push(r.href);
  };
  const current = Math.min(active, Math.max(0, results.length - 1));

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-3 pt-[10vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Search the admin console" className="glass-strong flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-[24px] bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search aria-hidden className="size-5 shrink-0 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[current]);
              } else if (e.key === "Escape") {
                close();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-search-results"
            aria-activedescendant={results[current] ? `res-${results[current].key}` : undefined}
            placeholder={companies_ ? "Find a page or a company..." : "Find a page..."}
            className="min-h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted"
          />
          <button type="button" onClick={close} aria-label="Close search" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft">
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <ul id="admin-search-results" role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[15px] text-muted">Nothing matches. Try a company name or an email.</li>}
          {results.map((r, i) => (
            <li
              key={r.key}
              id={`res-${r.key}`}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 py-2", i === current && "bg-soft")}
            >
              {r.kind === "company" ? <Building2 aria-hidden className="size-4 shrink-0 text-pulse-violet" /> : <span aria-hidden className="size-4 shrink-0 rounded-full bg-pulse-blue/20" />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-medium">{r.title}</span>
                <span className="truncate text-xs text-muted">{r.kind === "company" ? `Company · ${r.sub}` : r.sub}</span>
              </span>
              {i === current && <CornerDownLeft aria-hidden className="size-4 shrink-0 text-muted" />}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">Up and down to move, Enter to open, Esc to close.</p>
      </div>
    </div>
  );
}
