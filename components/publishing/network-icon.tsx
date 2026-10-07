import { cn } from "@/lib/cn";
import type { Network } from "@/lib/social/types";

const BRAND: Record<Network, string> = {
  instagram: "bg-[linear-gradient(45deg,#f9a03f,#e1306c_55%,#833ab4)]",
  facebook: "bg-[#1877f2]",
  linkedin: "bg-[#0a66c2]",
  tiktok: "bg-[#111111]",
  youtube: "bg-[#ff0000]",
};

const NAME: Record<Network, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube" };

export const networkName = (network: string) => NAME[network as Network] ?? network;

function Glyph({ network }: { network: Network }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (network) {
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className="size-[62%]" aria-hidden {...common}>
          <rect x="4" y="4" width="16" height="16" rx="5" />
          <circle cx="12" cy="12" r="3.6" />
          <circle cx="16.8" cy="7.2" r="0.6" fill="currentColor" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" className="size-[62%]" aria-hidden fill="currentColor">
          <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" className="size-[62%]" aria-hidden fill="currentColor">
          <path d="M5 9h3v10H5zM6.5 4.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM10 9h2.9v1.4c.5-.9 1.6-1.6 3.1-1.6 3 0 3.6 2 3.6 4.6V19h-3v-5c0-1.2 0-2.7-1.7-2.7s-1.9 1.3-1.9 2.6V19h-3z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" className="size-[62%]" aria-hidden {...common}>
          <path d="M14 4v10.2a3.4 3.4 0 1 1-3.4-3.4M14 4c.3 2.3 1.8 3.8 4 4" />
        </svg>
      );
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" className="size-[62%]" aria-hidden fill="currentColor">
          <path d="M20.6 8.1a2.2 2.2 0 0 0-1.5-1.6C17.8 6.2 12 6.2 12 6.2s-5.8 0-7.1.3a2.2 2.2 0 0 0-1.5 1.6C3.1 9.4 3.1 12 3.1 12s0 2.6.3 3.9a2.2 2.2 0 0 0 1.5 1.6c1.3.3 7.1.3 7.1.3s5.8 0 7.1-.3a2.2 2.2 0 0 0 1.5-1.6c.3-1.3.3-3.9.3-3.9s0-2.6-.3-3.9zM10.2 14.6V9.4l4.5 2.6z" />
        </svg>
      );
  }
}

/** A round network badge in its brand colour. */
export function NetworkIcon({ network, size = 20, className }: { network: Network; size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={networkName(network)}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-white", BRAND[network], className)}
      style={{ width: size, height: size }}
    >
      <Glyph network={network} />
    </span>
  );
}

/** The account's picture with its network badge in the corner; falls back to the badge alone. */
export function AccountAvatar({ network, name, src, size = 44 }: { network: Network; name: string; src?: string | null; size?: number }) {
  const initial = name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src ? (
        // Network avatars come from the network's own CDN, which next/image is not configured for.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" className="size-full rounded-full object-cover" />
      ) : (
        <span aria-hidden className="inline-flex size-full items-center justify-center rounded-full bg-soft text-sm font-semibold text-muted">
          {initial}
        </span>
      )}
      <NetworkIcon network={network} size={Math.round(size * 0.46)} className="absolute -right-1 -bottom-1 ring-2 ring-[var(--bp-bg-solid)]" />
    </span>
  );
}
