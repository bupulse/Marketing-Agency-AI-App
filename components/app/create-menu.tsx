"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { CreateAction } from "./nav";

/**
 * The + Create menu (the sidebar button and the phone bar's +): New post, New video, New design, Add photo. On phones a
 * sheet above the bottom bar; on computers a small menu under the button (`anchor`). Arrow keys move, Enter opens,
 * Esc, Tab or a tap outside close it.
 */
export function CreateMenu({ actions, anchor, onClose }: { actions: CreateAction[]; anchor: DOMRect | null; onClose: (restoreFocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(items.length - 1);
    }
  };

  const row = "flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 text-left no-underline outline-none hover:bg-soft focus-visible:bg-soft focus-visible:ring-2 focus-visible:ring-pulse-blue";
  const content = (a: CreateAction) => (
    <>
      <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-pulse-blue/10 text-pulse-blue">
        <a.icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold text-text">{a.label}</span>
        <span className="text-[13px] text-muted">{a.text}</span>
      </span>
    </>
  );

  return (
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      <div aria-hidden onClick={() => onClose(true)} className="bp-fade-in absolute inset-0 bg-black/30 backdrop-blur-[2px] lg:bg-transparent lg:backdrop-blur-none" />
      <div
        ref={ref}
        role="menu"
        aria-label="Create"
        style={anchor ? ({ "--x": `${anchor.left}px`, "--y": `${anchor.bottom + 8}px`, "--w": `${Math.max(anchor.width, 280)}px` } as CSSProperties) : undefined}
        className="bp-sheet-in absolute border border-line bg-surface inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] mx-auto flex max-w-md flex-col gap-1 rounded-[24px] p-2 shadow-glass lg:inset-x-auto lg:bottom-auto lg:left-[var(--x,1.25rem)] lg:top-[var(--y,6rem)] lg:mx-0 lg:w-[var(--w,280px)]"
      >
        <p className="px-3 pt-1.5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Create</p>
        {actions.map((a) =>
          a.external ? (
            // A plain link, not next/link: it must never be prefetched (each visit writes a sign-in ticket).
            <a key={a.id} href={a.href} target="_blank" rel="noopener" role="menuitem" onClick={() => onClose(false)} className={row}>
              {content(a)}
              <ExternalLink aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <Link key={a.id} href={a.href} role="menuitem" onClick={() => onClose(false)} className={row}>
              {content(a)}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
