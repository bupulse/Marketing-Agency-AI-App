import Image from "next/image";
import { cn } from "@/lib/cn";

type MarkProps = {
  /** Square size in px. */
  size?: number;
  /** "mark" = pulse B glyph, "icon" = rounded app icon. */
  variant?: "mark" | "icon";
  priority?: boolean;
  /** Pass "" for decorative use. */
  alt?: string;
  className?: string;
};

export function Mark({ size = 40, variant = "mark", priority = false, alt = "BuPulse", className }: MarkProps) {
  return (
    <Image
      src={variant === "icon" ? "/brand/icon.png" : "/brand/mark.png"}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0", className)}
    />
  );
}
