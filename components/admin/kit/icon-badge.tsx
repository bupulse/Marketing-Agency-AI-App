import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { TONE_BADGE, type KitTone } from "./tones";

const SIZE = {
  sm: "size-8 rounded-[10px] [&>svg]:size-4",
  md: "size-10 rounded-xl [&>svg]:size-5",
  lg: "size-12 rounded-2xl [&>svg]:size-6",
} as const;

/** A white icon on a tone gradient: the mark of a page, a section or a number. Decorative (hidden from readers). */
export function IconBadge({ icon: Icon, tone = "blue", size = "md", className }: { icon: LucideIcon; tone?: KitTone; size?: keyof typeof SIZE; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center text-white", SIZE[size], TONE_BADGE[tone], className)}>
      <Icon />
    </span>
  );
}
