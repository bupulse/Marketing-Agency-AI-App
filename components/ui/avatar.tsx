import Image from "next/image";
import { cn } from "@/lib/cn";

type AvatarProps = {
  name: string;
  src?: string | null;
  /** px */
  size?: number;
  className?: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function Avatar({ name, src, size = 40, className }: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-gradient text-sm font-semibold text-white",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
    >
      {src ? (
        <Image src={src} alt={name} width={size} height={size} className="size-full object-cover" />
      ) : (
        <span aria-label={name}>{initials(name)}</span>
      )}
    </span>
  );
}
