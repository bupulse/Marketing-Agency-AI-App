import type { Network } from "@/lib/social/types";

/** Inline brand icons (24x24, brand colours) so the Channels page needs no image requests. */
export function NetworkIcon({ network, className = "size-6" }: { network: Network; className?: string }) {
  const common = { viewBox: "0 0 24 24", className, "aria-hidden": true, focusable: false } as const;
  switch (network) {
    case "instagram":
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="bp-ig" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#FEDA77" />
              <stop offset="0.35" stopColor="#F58529" />
              <stop offset="0.6" stopColor="#DD2A7B" />
              <stop offset="1" stopColor="#515BD4" />
            </linearGradient>
          </defs>
          <rect width="24" height="24" rx="6.5" fill="url(#bp-ig)" />
          <rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="16.1" cy="7.9" r="1" fill="#fff" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#1877F2" />
          <path fill="#fff" d="M13.4 19.5v-6.3h2.1l.4-2.6h-2.5V9c0-.7.3-1.3 1.4-1.3h1.2V5.4c-.2 0-1-.1-1.9-.1-2 0-3.3 1.2-3.3 3.4v1.9H8.7v2.6h2.1v6.3z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="5" fill="#0A66C2" />
          <rect x="5.6" y="9.6" width="2.5" height="8.4" fill="#fff" />
          <circle cx="6.85" cy="6.9" r="1.45" fill="#fff" />
          <path fill="#fff" d="M10.2 9.6h2.4v1.1c.4-.7 1.3-1.3 2.6-1.3 2.5 0 3 1.6 3 3.7V18h-2.5v-4.2c0-1 0-2.1-1.3-2.1s-1.5 1-1.5 2.1V18h-2.5z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#111" />
          <path fill="#25F4EE" d="M15.2 5.2c.3 1.6 1.2 2.6 2.8 2.8v2.2c-1 0-1.9-.3-2.8-.9v4.4c0 2.5-2 4-4.1 4-2.2 0-4-1.7-4-3.9 0-2.5 2.2-4.2 4.6-3.8v2.3c-1.2-.4-2.3.4-2.3 1.5 0 1 .8 1.7 1.7 1.7 1 0 1.7-.8 1.7-1.9V5.2z" transform="translate(-.6 .5)" />
          <path fill="#FE2C55" d="M15.2 5.2c.3 1.6 1.2 2.6 2.8 2.8v2.2c-1 0-1.9-.3-2.8-.9v4.4c0 2.5-2 4-4.1 4-2.2 0-4-1.7-4-3.9 0-2.5 2.2-4.2 4.6-3.8v2.3c-1.2-.4-2.3.4-2.3 1.5 0 1 .8 1.7 1.7 1.7 1 0 1.7-.8 1.7-1.9V5.2z" transform="translate(.6 -.4)" />
          <path fill="#fff" d="M15.2 5.2c.3 1.6 1.2 2.6 2.8 2.8v2.2c-1 0-1.9-.3-2.8-.9v4.4c0 2.5-2 4-4.1 4-2.2 0-4-1.7-4-3.9 0-2.5 2.2-4.2 4.6-3.8v2.3c-1.2-.4-2.3.4-2.3 1.5 0 1 .8 1.7 1.7 1.7 1 0 1.7-.8 1.7-1.9V5.2z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <rect x="0" y="3.5" width="24" height="17" rx="5" fill="#FF0000" />
          <path fill="#fff" d="M9.8 8.8v6.4l5.6-3.2z" />
        </svg>
      );
  }
}
