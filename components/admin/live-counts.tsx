"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { adminCountsAction } from "@/app/admin/(console)/actions";

const POLL_MS = 20_000;

/**
 * Keeps the console's to-do numbers live. The sidebar badges are drawn by the layout, which Next does not fetch again
 * on a client-side navigation, and an open Overview never re-reads by itself: so a payment reported meanwhile showed
 * on Payments but not on the Overview or the badges. This asks for the counts every 20 seconds while the tab is visible
 * (and when it comes back to the front) and refreshes the page, layout included, as soon as they differ from what
 * was drawn (`signature`, from lib/admin/inbox.ts countsSignature). Renders nothing.
 */
export function LiveCounts({ signature }: { signature: string }) {
  const router = useRouter();
  const shown = useRef(signature);

  useEffect(() => {
    shown.current = signature;
  }, [signature]);

  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const now = await adminCountsAction();
        if (now !== shown.current) {
          shown.current = now;
          router.refresh();
        }
      } catch {
        // Network hiccup: try again on the next tick.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  return null;
}
