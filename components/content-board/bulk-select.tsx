"use client";

import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Square, Trash2, X } from "lucide-react";
import { deletePostsAction } from "@/app/dashboard/calendar/actions";
import { Button, Dialog, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { bulkDeleteMessage, MAX_BULK_DELETE, selectAllButton } from "@/lib/publishing/bulk-delete";

/** One section in select mode at a time: entering it in one tells the others to leave it (one action bar on screen). */
const EVENT = "bp-bulk-select";

export type BulkSelect = {
  active: boolean;
  selected: ReadonlySet<string>;
  /** The posts of this section that can be picked (lib/publishing/bulk-delete.ts). */
  ids: string[];
  start: () => void;
  stop: () => void;
  toggle: (id: string) => void;
  /** Picks every pickable post of the section, or clears them when all are picked. */
  toggleAll: () => void;
};

/** Select mode for one list of posts. Picks that are no longer on the page (deleted, approved) drop out by themselves. */
export function useBulkSelect(ids: string[]): BulkSelect {
  const owner = useId();
  const [active, setActive] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const key = ids.join(",");
  // Only the ids still on the page count: a refresh after a delete or an approval leaves no stale picks.
  const selected = useMemo<ReadonlySet<string>>(() => {
    const here = new Set(key ? key.split(",") : []);
    return new Set([...picked].filter((id) => here.has(id)));
  }, [picked, key]);
  const pickable = active && ids.length > 0;

  const stop = useCallback(() => {
    setActive(false);
    setPicked(new Set());
  }, []);

  useEffect(() => {
    const other = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== owner) stop();
    };
    window.addEventListener(EVENT, other);
    return () => window.removeEventListener(EVENT, other);
  }, [owner, stop]);

  // Esc leaves select mode (when no dialog is open: the dialog handles its own Esc first).
  useEffect(() => {
    if (!pickable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickable, stop]);

  return {
    active: pickable,
    selected,
    ids,
    start: () => {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: owner }));
      setActive(true);
    },
    stop,
    toggle: (id) =>
      setPicked((prev) => {
        const next = new Set([...prev].filter((x) => ids.includes(x)));
        if (next.has(id)) next.delete(id);
        else if (next.size < MAX_BULK_DELETE) next.add(id);
        return next;
      }),
    toggleAll: () => setPicked(selectAllButton(ids.length, selected.size).all ? new Set() : new Set(ids.slice(0, MAX_BULK_DELETE))),
  };
}

/** The section header's "Select" button, and in select mode "Select all" and "Done". */
export function SelectToggle({ select, what = "posts" }: { select: BulkSelect; what?: string }) {
  if (select.ids.length === 0) return null;
  if (!select.active)
    return (
      <Button size="sm" variant="outline" leading={<CheckSquare aria-hidden className="size-4" />} onClick={select.start} aria-label={`Select ${what} to delete`}>
        Select
      </Button>
    );
  const { all, label } = selectAllButton(select.ids.length, select.selected.size);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" leading={all ? <Square aria-hidden className="size-4" /> : <CheckSquare aria-hidden className="size-4" />} onClick={select.toggleAll} aria-pressed={all}>
        {label}
      </Button>
      <Button size="sm" variant="ghost" onClick={select.stop}>
        Done
      </Button>
    </span>
  );
}

/**
 * The card's checkbox in select mode: a real checkbox (Space toggles it, the label names the post) inside a 44px tap
 * target, over the card's top-left corner.
 */
export function SelectCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="absolute top-1.5 left-1.5 z-10 inline-flex size-12 cursor-pointer items-center justify-center rounded-full">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="peer sr-only" />
      <span
        aria-hidden
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-[10px] border-2 shadow-glass transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-pulse-blue peer-focus-visible:ring-offset-2 motion-reduce:transition-none",
          checked ? "border-transparent bg-brand-gradient text-white" : "border-white bg-black/35 text-transparent backdrop-blur-sm",
        )}
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
    </label>
  );
}

/**
 * The bar at the bottom while posts are picked: "N selected · Delete · Cancel". Delete asks first, in BuPulse's own
 * dialog, saying how many go and that it cannot be undone; then one server action deletes them all.
 */
export function BulkActionBar({ select }: { select: BulkSelect }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const n = select.selected.size;
  if (!select.active) return null;
  const posts = n === 1 ? "1 post" : `${n} posts`;

  const remove = () =>
    start(async () => {
      const res = await deletePostsAction([...select.selected]).catch(() => null);
      setConfirming(false);
      if (!res) {
        toast("We lost the connection before BuPulse answered. The page now shows where things stand.", "error");
      } else if (!res.ok) {
        toast(res.error ?? "That did not work. Please try again.", "error");
      } else {
        const message = bulkDeleteMessage(res);
        toast(message.text, message.tone);
        select.stop();
      }
      router.refresh();
    });

  return (
    <>
      <div
        role="region"
        aria-label="Selected posts"
        className="fixed bottom-[calc(var(--bp-bottom-bar,0px)+1rem)] left-4 right-[5.25rem] z-50 flex animate-pop items-center gap-2 rounded-full border border-line bg-[var(--bp-dialog)] py-1.5 pr-1.5 pl-4 shadow-glass sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:gap-3 sm:pl-5"
      >
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-[15px] font-semibold whitespace-nowrap sm:flex-none">
          {n} selected
        </p>
        <span aria-hidden className="hidden text-muted sm:inline">
          ·
        </span>
        <Button size="sm" disabled={n === 0 || pending} onClick={() => setConfirming(true)} leading={<Trash2 aria-hidden className="size-4" />} className="!bg-[#c81e3a] !bg-none !px-3.5 !text-white !shadow-none sm:!px-4">
          Delete
        </Button>
        <Button size="sm" variant="outline" onClick={select.stop} disabled={pending} className="!px-3 sm:!px-4" aria-label="Cancel selecting">
          <X aria-hidden className="size-4 sm:hidden" />
          <span className="hidden sm:inline">Cancel</span>
        </Button>
      </div>
      <Dialog open={confirming} onOpenChange={(o) => !pending && setConfirming(o)} title={`Delete ${posts}?`} description={`${n === 1 ? "It is" : "They are"} removed from BuPulse for good, with ${n === 1 ? "its caption and versions" : "their captions and versions"}. This can't be undone.`}>
        <div className="mt-2 flex flex-wrap justify-end gap-3">
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
            {n === 1 ? "Keep it" : "Keep them"}
          </Button>
          <Button size="sm" disabled={pending || n === 0} className="!bg-[#c81e3a] !bg-none !text-white !shadow-none" leading={<Trash2 aria-hidden className="size-4" />} onClick={remove}>
            {pending ? "Deleting..." : `Delete ${posts}`}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
