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
