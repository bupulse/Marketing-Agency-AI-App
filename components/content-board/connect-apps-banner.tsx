"use client";

import { useEffect, useState } from "react";
import { Plug, X } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { networkLabel } from "@/lib/content-board/labels";

const key = (apps: readonly string[]) => `bp-connect-apps-dismissed:${[...apps].sort().join(",")}`;

/** Hidden for this browser session once dismissed; back in a new session, or when the list of missing apps changes. */
export function ConnectAppsBanner({ apps, canConnect }: { apps: readonly string[]; canConnect: boolean }) {
  const [hidden, setHidden] = useState(true);
  const storageKey = key(apps);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(storageKey) === "1";
    } catch {
      // Storage blocked: show it.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading storage is only possible after mount
    setHidden(dismissed);
  }, [storageKey]);
  if (hidden || apps.length === 0) return null;
  const names = apps.map(networkLabel);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];

  return (
    <GlassCard role="region" aria-label="Connect your apps" className="flex flex-wrap items-center gap-3 border-2 border-amber-500 p-4 dark:border-amber-400">
      <Plug aria-hidden className="size-5 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Connect your apps so we can post for you</p>
        <p className="text-[14px] text-muted">
          {list} {names.length === 1 ? "is" : "are"} not connected. Until then, their posts come to you as reminders to post yourself.
        </p>
      </div>
      {canConnect ? <Button href="/dashboard/connections" size="sm">Connect apps</Button> : <p className="text-[13px] text-muted">Ask your company owner or an admin to connect them.</p>}
      <button
        type="button"
        aria-label="Dismiss until next time"
        onClick={() => {
          try {
            sessionStorage.setItem(storageKey, "1");
          } catch {
            // Storage blocked: hide for this page view only.
          }
          setHidden(true);
        }}
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text"
      >
        <X aria-hidden className="size-5" />
      </button>
    </GlassCard>
  );
}
