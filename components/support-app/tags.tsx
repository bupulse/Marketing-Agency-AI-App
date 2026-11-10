import { cn } from "@/lib/cn";
import type { Tag, TagTone } from "@/lib/support/app-client/lists";

const TONES: Record<TagTone, string> = {
  danger: "bg-danger-bg text-danger",
  blue: "bg-ok-bg text-ok",
  violet: "bg-new-bg text-new",
  success: "bg-success-bg text-success",
  neutral: "bg-black/[0.05] text-muted dark:bg-white/[0.08]",
  warning: "bg-[#fff4e0] text-[#8a5a00] dark:bg-[#d08700]/20 dark:text-[#ffc65c]",
};

const DOTS: Partial<Record<TagTone, string>> = { danger: "bg-danger", violet: "bg-new", success: "bg-success", warning: "bg-[#d08700]" };

/** A chat's tags as small pills; urgent, hot-lead, AI and ticket tags get a coloured dot. */
export function TagList({ tags, className }: { tags: Tag[]; className?: string }) {
  if (!tags.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((t) => (
        <span key={t.label} className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold", TONES[t.tone])}>
          {DOTS[t.tone] && <span aria-hidden className={cn("size-1.5 rounded-full", DOTS[t.tone])} />}
          {t.label}
        </span>
      ))}
    </span>
  );
}
