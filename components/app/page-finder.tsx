"use client";

import { useRouter } from "next/navigation";
import { CornerDownLeft, ExternalLink, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { searchEntries, type FinderEntry } from "./nav";

/**
 * "Find a page": the sidebar's and the menu's search box, also opened with Cmd+K (Mac) or Ctrl+K. Lists the pages of
 * the menu and the Create actions the person may open, with other words for them (MoMo finds Billing). Arrow keys
 * move, Enter opens, Esc closes.
 */
export function PageFinder({ open, onOpenChange, entries }: { open: boolean; onOpenChange: (open: boolean) => void; entries: FinderEntry[] }) {
  const router = useRouter();
  const uid = useId();
  const [q, setQ] = useState("");
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
    if (open) input.current?.focus();
  }, [open]);

  const results = useMemo(() => searchEntries(q, entries), [q, entries]);
  const current = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (r: FinderEntry) => `${uid}-${r.key}`;
  const activeId = results[current] ? optionId(results[current]) : undefined;

  // The highlighted line stays in sight while the arrow keys move through a long list.
  useEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);

  if (!open) return null;
  const close = () => {
    onOpenChange(false);
    setQ("");
    setActive(0);
  };
  const go = (r: FinderEntry | undefined) => {
    if (!r) return;
    close();
    // The Video Studio opens in a new tab, as from the menu.
    if (r.external) window.open(r.href, "_blank", "noopener");
    else router.push(r.href);
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-3 pt-[10vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Find a page" className="glass-strong flex max-h-[75dvh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-surface">
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
                setActive(Math.min(current + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(current - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[current]);
              } else if (e.key === "Escape") {
                close();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={`${uid}-list`}
            aria-activedescendant={activeId}
            aria-label="Find a page"
            placeholder="Find a page: posts, MoMo, Instagram…"
            enterKeyHint="go"
            autoComplete="off"
            className="min-h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted"
          />
          <button type="button" onClick={close} aria-label="Close search" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft">
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <ul id={`${uid}-list`} role="listbox" aria-label="Pages" className="flex-1 overflow-y-auto p-2">
          {results.length === 0 && (
            <li role="presentation" className="px-3 py-6 text-center text-[15px] text-muted">
              Nothing matches. Try another word, or open the menu.
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.key}
              id={optionId(r)}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 py-2", i === current && "bg-soft")}
            >
              <r.icon aria-hidden className="size-[18px] shrink-0 text-pulse-blue" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-medium">{r.label}</span>
                {r.group && <span className="truncate text-xs text-muted">{r.group}</span>}
              </span>
              {r.external && <ExternalLink aria-label="opens in a new tab" className="size-4 shrink-0 text-muted" />}
              {i === current && <CornerDownLeft aria-hidden className="hidden size-4 shrink-0 text-muted sm:block" />}
            </li>
          ))}
        </ul>
        <p className="hidden border-t border-line px-4 py-2 text-xs text-muted sm:block">Up and down to move, Enter to open, Esc to close.</p>
      </div>
    </div>
  );
}
