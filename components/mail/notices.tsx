"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { notify } from "./settings-form";

// New mail while B Mail is open (Settings > Notifications, kept in this browser): every minute the unread count is
// checked; when it grows the list refreshes, and if the tab is in the background a notice shows the newest email. Off: nothing runs.
export function NewMailNotices({ unread }: { unread: number }) {
  const on = useSyncExternalStore(notify.subscribe, notify.get, () => false);
  const router = useRouter();
  const last = useRef(unread);
  useEffect(() => { last.current = unread; }, [unread]);
  useEffect(() => {
    if (!on || !("Notification" in window)) return;
    const tick = async () => {
      try {
        const r = await fetch("/api/mail/unread", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { unread: number; latest: { id: string; subject: string; from: string } | null };
        if (j.unread > last.current && j.latest) {
          router.refresh();
          if (Notification.permission !== "granted" || (document.visibilityState === "visible" && document.hasFocus())) { last.current = j.unread; return; }
          const n = new Notification(j.latest.from || "New mail", { body: j.latest.subject, icon: "/brand/icon.png", tag: `bmail-${j.latest.id}` });
          n.onclick = () => { window.focus(); router.push(`/mail/t/${j.latest!.id}`); n.close(); };
        }
        last.current = j.unread;
      } catch {
        // Offline for a moment: try again next minute.
      }
    };
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [on, router]);
  return null;
}
