"use client";

import { useRouter } from "next/navigation";
import { Building2, CornerDownLeft, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useHostHref } from "@/components/platform/hosts";
import { searchPages } from "./nav";
import { IconBadge } from "./kit/icon-badge";
import type { KitTone } from "./kit/tones";
import type { Permission } from "@/lib/staff/permissions";

type Company = { id: string; name: string; email: string | null; plan: string | null; status: string | null };
type Result = { key: string; href: string; title: string; sub: string; kind: "page" | "company"; icon?: LucideIcon; tone?: KitTone };

/**
 * Jump to any admin page or company: Cmd+K (Mac) or Ctrl+K, or the Search button. Arrow keys move, Enter opens, Esc
 * closes. Pages are matched here; companies come from /admin/search (name or any member's email).
 */
export function CommandPalette({ open, onOpenChange, permissions }: { open: boolean; onOpenChange: (open: boolean) => void; permissions: readonly Permission[] }) {
  const allowed = (p: Permission | readonly Permission[]) => (typeof p === "string" ? [p] : p).some((x) => permissions.includes(x));
  const companies_ = permissions.includes("clients.view");
  const router = useRouter();
  const toHref = useHostHref();
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
    const pages = searchPages(q).filter((p) => allowed(p.perm)).slice(0, q ? 8 : 40).map((p) => ({ key: p.href, href: p.href, title: p.label, sub: p.group.title ? `${p.group.title} · ${p.description}` : p.description, kind: "page" as const, icon: p.icon, tone: p.group.tone }));
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
    router.push(toHref(r.href));
  };
  const current = Math.min(active, Math.max(0, results.length - 1));

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/45 p-3 pt-[8vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Search the admin console" className="relative flex max-h-[78vh] w-full max-w-xl flex-col overflow-hidden rounded-[24px] border border-line bg-surface shadow-[0_30px_80px_-30px_rgba(17,24,39,0.6)] dark:bg-[#15151b]">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <div className="flex items-center gap-2 border-b border-line px-4 pt-1">
          <Search aria-hidden className="size-5 shrink-0 text-pulse-blue dark:text-[#8db0ff]" />
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
            style={{ outline: "none" }}
            className="min-h-14 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:font-normal placeholder:text-muted"
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
              className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-2", i === current && "bg-soft ring-1 ring-pulse-blue/25")}
            >
              <IconBadge icon={r.kind === "company" ? Building2 : (r.icon ?? Search)} tone={r.kind === "company" ? "violet" : (r.tone ?? "blue")} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{r.title}</span>
                <span className="truncate text-xs text-muted">{r.kind === "company" ? `Company · ${r.sub}` : r.sub}</span>
              </span>
              {i === current && <CornerDownLeft aria-hidden className="size-4 shrink-0 text-muted" />}
            </li>
          ))}
        </ul>
        <p className="hidden border-t border-line px-4 py-2 text-xs text-muted sm:block">Up and down to move, Enter to open, Esc to close.</p>
      </div>
    </div>
  );
}
