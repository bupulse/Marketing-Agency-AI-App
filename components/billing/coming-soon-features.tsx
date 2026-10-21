import { Clock } from "lucide-react";
import { comingSoonIn, featureLabel } from "@/lib/features";
import { cn } from "@/lib/cn";

/**
 * The plan's "Coming soon" features (lib/features.ts), under its highlights on the plan cards: the plan has them, they
 * switch on when they are ready. Nothing when it has none.
 */
export function ComingSoonFeatures({ features, className }: { features: readonly string[]; className?: string }) {
  const soon = comingSoonIn(features);
  if (soon.length === 0) return null;
  return (
    <li className={cn("flex items-start gap-2.5 text-muted", className)}>
      <Clock aria-hidden className="mt-0.5 size-5 shrink-0" />
      <span>
        <span className="mr-1.5 rounded-full bg-new-bg px-2 py-0.5 text-[12px] font-semibold text-new">Coming soon</span>
        {soon.map(featureLabel).join(", ")}
      </span>
    </li>
  );
}
