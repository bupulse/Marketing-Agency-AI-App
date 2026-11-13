"use client";

import { useState, type ReactNode } from "react";

/**
 * A social account's picture from the network's CDN, or `fallback` (the initials) when it cannot load. Instagram and
 * Facebook picture links are signed and expire after a few days, so a saved one starts answering 403 and the browser
 * showed a broken-image icon (QA 13 Nov, Channels and Autopilot).
 */
export function AvatarImage({ src, size, className, fallback }: { src: string; size: number; className?: string; fallback: ReactNode }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (broken === src) return <>{fallback}</>;
  return (
    // Network avatars come from each network's own CDN, which next/image is not configured for.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(src)} className={className} />
  );
}
