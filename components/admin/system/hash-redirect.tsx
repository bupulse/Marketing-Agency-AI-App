"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hashTarget } from "./settings-areas";

/**
 * Old links to a panel of a page that was split (/admin/settings#paddle, /admin/services#setup-meta) open the new
 * page that holds it. The server never sees the #anchor, so this runs in the browser, on load and when the anchor
 * changes. `?notice=` and `?error=` are kept, so a save that still returns to the old address shows its message.
 */
export function HashRedirect({ routes }: { routes: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const go = () => {
      const to = hashTarget(routes, window.location.hash, window.location.search);
      if (to) router.replace(to);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [routes, router]);
  return null;
}
