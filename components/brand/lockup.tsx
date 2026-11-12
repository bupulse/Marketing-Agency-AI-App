import Image from "next/image";
import { cn } from "@/lib/cn";

type LockupProps = {
  /** The service name shown after the logo, e.g. "Admin" or "Support". */
  service: string;
  /** Rendered height of the logo in px; its width follows the 10:3 asset ratio. */
  height?: number;
  /**
   * "auto": the dark wordmark in light mode, the white one in dark mode (CSS `dark:` swaps them, so the theme never
   * flashes). "white": the white wordmark in both, for coloured surfaces such as the support app's gradient sidebar.
   */
  tone?: "auto" | "white";
  /** Above-the-fold logos (sign-in pages): load at once instead of lazily. */
  eager?: boolean;
  className?: string;
};

/**
 * BuPulse's real logo (public/brand/logo.png and logo-white.png) with the service it opens, Apple-style:
 * the wordmark, a hairline and the service name. Used by the admin console and the support app, so neither shows a
 * made-up mark. The images carry the "BuPulse" alt text; the service name is real text, so the whole reads
 * "BuPulse Admin" to a screen reader.
 */
export function BrandLockup({ service, height = 30, tone = "auto", eager = false, className }: LockupProps) {
  const width = Math.round((height * 2000) / 600);
  const loading = eager ? "eager" : undefined;
  const img = { width, height, loading, style: { width, height } } as const;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* The PNGs have about 3.5% clear space on the left: pulled back so the mark lines up with the content below. */}
      <span className="inline-flex shrink-0" style={{ marginLeft: -Math.round(width * 0.035) }}>
        {tone === "white" ? (
          <Image src="/brand/logo-white.png" alt="BuPulse" {...img} className="block" />
        ) : (
          <>
            <Image src="/brand/logo.png" alt="BuPulse" {...img} className="block dark:hidden" />
            <Image src="/brand/logo-white.png" alt="BuPulse" {...img} className="hidden dark:block" />
          </>
        )}
      </span>
      <span aria-hidden className={cn("mx-2.5 w-px self-stretch", tone === "white" ? "bg-white/35" : "bg-line")} style={{ marginBlock: Math.round(height * 0.22) }} />
      {/* Nudged down a touch so its baseline sits on the wordmark's (the wordmark is a little below the PNG's centre). */}
      <span className={cn("whitespace-nowrap font-semibold tracking-[-0.01em]", tone === "white" ? "text-white/85" : "text-muted")} style={{ fontSize: Math.round(height * 0.5), transform: `translateY(${(height * 0.04).toFixed(1)}px)` }}>
        {service}
      </span>
    </span>
  );
}
