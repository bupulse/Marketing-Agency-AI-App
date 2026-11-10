"use client";

import { useEffect } from "react";

/**
 * Keeps old `#anchor` links working after a section moved to its own page: when the page opens with one of the
 * hashes in `to` (`{ bills: "/admin/costs/bills" }`), the browser goes to that page instead, keeping the query
 * (`?notice=`, `?error=`, filters). The server never sees a hash, so this is the only place it can be read. Renders
 * nothing.
 */
export function HashRedirect({ to }: { to: Record<string, string> }) {
  useEffect(() => {
    const key = decodeURIComponent(window.location.hash.slice(1));
    if (!key || !Object.hasOwn(to, key)) return;
    const target = new URL(to[key], window.location.origin);
    new URLSearchParams(window.location.search).forEach((v, k) => {
      if (!target.searchParams.has(k)) target.searchParams.set(k, v);
    });
    // Already there (a target that keeps the same hash): stay, so the page never bounces.
    const same = (a: URLSearchParams, b: URLSearchParams) => [...a].sort().join("&") === [...b].sort().join("&");
    if (target.pathname === window.location.pathname && same(target.searchParams, new URLSearchParams(window.location.search))) return;
    window.location.replace(target.pathname + target.search + target.hash);
  }, [to]);
  return null;
}
