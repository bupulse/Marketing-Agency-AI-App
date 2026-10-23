import { cn } from "@/lib/cn";

/** The support app's mark: BuPulse's pulse line on a soft tile, and the name. */
export function SupportBrand({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-9 rounded-[11px]" : "size-8 rounded-[10px]";
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span aria-hidden className={cn("inline-flex items-center justify-center bg-white/22", box)}>
        <svg width={size === "lg" ? 20 : 18} height={size === "lg" ? 20 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h4l3-7 4 14 3-7h4" />
        </svg>
      </span>
      <span className={cn("font-bold", size === "lg" ? "text-lg" : "text-base")}>BuPulse Support</span>
    </span>
  );
}
