import Link from "next/link";
import { MessageCircleWarning } from "lucide-react";
import { readKnowledge } from "@/lib/brand/schemas";
import { hasEssentials } from "@/lib/business-info/facts";

/**
 * For companies onboarded before hours, head office and phone became required: a reminder, never a lock. The rule
 * is enforced only when they next save step 4 on the Brand page.
 */
export function EssentialsBanner({ knowledge, href = "/dashboard/brand#brand-knowledge" }: { knowledge: unknown; href?: string }) {
  if (hasEssentials(readKnowledge(knowledge))) return null;
  return (
    <div role="status" className="glass flex flex-wrap items-center gap-3 rounded-2xl border border-pulse-violet/30 p-4 text-[14px]">
      <MessageCircleWarning aria-hidden className="size-5 shrink-0 text-pulse-violet" />
      <p className="min-w-0 flex-[1_1_240px]">Add your opening hours, location and phone so your chat assistant can answer customers.</p>
      <Link href={href} className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline-offset-2 hover:underline">
        Add them now
      </Link>
    </div>
  );
}
