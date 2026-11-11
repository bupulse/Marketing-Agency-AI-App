import Image from "next/image";
import { cn } from "@/lib/cn";

type LogoProps = {
  /** Rendered height in px; width follows the 10:3 asset ratio. */
  height?: number;
  /** Set on above-the-fold logos (preloads). */
  priority?: boolean;
  className?: string;
};

/**
 * Wordmark. Both variants are in the DOM; CSS (`dark:`) shows the right one,
 * so the theme never flashes. logo.png = dark text (light mode), logo-white.png = dark mode.
 */
export function Logo({ height = 36, priority = false, className }: LogoProps) {
  const width = Math.round((height * 2000) / 600);
  return (
    <span className={cn("inline-flex items-center", className)}>
      <Image
        src="/brand/logo.png"
        alt="BuPulse"
        width={width}
        height={height}
        priority={priority}
        className="block dark:hidden"
        style={{ width, height }}
      />
      <Image
        src="/brand/logo-white.png"
        alt="BuPulse"
        width={width}
        height={height}
        priority={priority}
        className="hidden dark:block"
        style={{ width, height }}
      />
    </span>
  );
}

/**
 * The Marketing service's logo: BuPulse's logo with "MARKETING" under the wordmark in the brand gradient, matching
 * Agency OS's "AGENCY OS" logo (public/brand/marketing-logo*.png, made with Agency OS's
 * scripts/brand/make-agency-logos.swift; the owner, 11 November 2026). Shown in the Marketing dashboard so clients see
 * which BuPulse service they are in. 25:8 ratio (2000x640).
 */
export function MarketingLogo({ height = 40, priority = false, className }: LogoProps) {
  const width = Math.round((height * 2000) / 640);
  return (
    <span className={cn("inline-flex items-center", className)}>
      <Image src="/brand/marketing-logo.png" alt="BuPulse Marketing" width={width} height={height} priority={priority} className="block dark:hidden" style={{ width, height }} />
      <Image src="/brand/marketing-logo-white.png" alt="BuPulse Marketing" width={width} height={height} priority={priority} className="hidden dark:block" style={{ width, height }} />
    </span>
  );
}
