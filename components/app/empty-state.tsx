import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, GlassCard } from "@/components/ui";

/** Polished empty / coming-soon panel explaining what a section will do. */
export function EmptyState({
  icon: Icon,
  title,
  text,
  points,
  action,
  comingSoon = false,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  points?: string[];
  action?: ReactNode;
  comingSoon?: boolean;
}) {
  return (
    <GlassCard padding="lg" className="flex flex-col items-center gap-5 px-6 py-12 text-center sm:py-16">
      <span className="relative inline-flex size-20 items-center justify-center rounded-[28px] bg-brand-gradient text-white shadow-glow">
        <Icon aria-hidden className="size-9" />
      </span>
      {comingSoon && <Badge tone="violet">Coming soon</Badge>}
      <div className="flex max-w-xl flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-[-0.02em]">{title}</h2>
        <p className="text-[15px] text-muted">{text}</p>
      </div>
      {points && points.length > 0 && (
        <ul className="flex max-w-xl flex-col gap-2 text-left text-[15px]">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2.5">
              <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-blue" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      {action}
    </GlassCard>
  );
}
