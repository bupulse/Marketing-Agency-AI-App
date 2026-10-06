import { Users } from "lucide-react";
import { Badge, GlassCard } from "@/components/ui";

export function TeamCard() {
  return (
    <GlassCard as="section" aria-labelledby="team" className="flex items-start gap-4 p-5 sm:p-6">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft">
        <Users aria-hidden className="size-5 text-muted" />
      </span>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="team" className="text-lg font-semibold">
            Team
          </h2>
          <Badge>Coming soon</Badge>
        </div>
        <p className="text-sm text-muted">Soon you will be able to invite colleagues to work in your account.</p>
      </div>
    </GlassCard>
  );
}
