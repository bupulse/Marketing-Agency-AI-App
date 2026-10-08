"use client";

import { Megaphone, X } from "lucide-react";
import { useSyncExternalStore } from "react";

type Item = { id: string; title: string; body: string; dismissible: boolean };
const KEY = "bp-dismissed-announcements";

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
// The raw string is the snapshot, so React compares it by value and never loops.
function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function parse(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Announcements from the admin console. Dismissing is remembered on this device only. */
export function AnnouncementBanner({ items }: { items: Item[] }) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const dismissed = parse(raw);
  const shown = items.filter((i) => !(i.dismissible && dismissed.includes(i.id)));
  if (shown.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...new Set([...dismissed, id])].slice(-50);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: it just comes back next visit */
    }
    listeners.forEach((fn) => fn());
  };

  return (
    <div className="flex flex-col gap-2">
      {shown.map((a) => (
        <div key={a.id} role="status" className="flex items-start gap-3 rounded-2xl bg-ok-bg px-4 py-3 text-ok">
          <Megaphone aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1 text-[15px]">
            <p className="font-semibold">{a.title}</p>
            <p className="whitespace-pre-line break-words">{a.body}</p>
          </div>
          {a.dismissible && (
            <button type="button" onClick={() => dismiss(a.id)} aria-label={`Dismiss: ${a.title}`} className="-m-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-soft">
              <X aria-hidden className="size-5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
