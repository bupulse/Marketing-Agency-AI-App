"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the server page's data every `ms` while the tab is visible, and at once when it becomes visible again. */
export function AutoRefresh({ ms = 60_000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "hidden") router.refresh();
    };
    const timer = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, ms]);
  return null;
}
