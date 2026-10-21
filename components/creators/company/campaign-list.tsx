import { Megaphone } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Badge, Button, GlassCard } from "@/components/ui";
import { formatShortDate } from "@/components/analytics/format";
import { CAMPAIGN_STATUS_LABEL, PLATFORM_LABEL, type CampaignStatus, type Platform } from "@/lib/creators/company-forms";
import type { CampaignRow } from "@/lib/creators/campaigns";
import { STATUS_TONE } from "./campaign-page";

/** The company's campaigns, newest first, or how to start the first one. */
export function CampaignList({ campaigns }: { campaigns: CampaignRow[] }) {
  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Your first creator campaign"
        text="Content creators post about you on their own Instagram, Facebook Page or TikTok. You set the tasks and the pay; BuPulse counts every post's views and works out what each creator earned. You pay them by Mobile Money."
        points={["Share one link: creators apply on it", "Pick the ones you like: they get a login", "Watch the views come in, then pay at the end of each 30 days"]}
        action={<Button href="/dashboard/creators/new">New campaign</Button>}
      />
    );
  }
  return (
    <GlassCard padding="none" className="divide-y divide-line">
      {campaigns.map((c) => (
        <Link key={c.id} href={`/dashboard/creators/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3.5 no-underline hover:bg-soft">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[15px] font-semibold">{c.name}</span>
              <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status}</Badge>
              {c.applied > 0 && <Badge tone="violet">{c.applied} new {c.applied === 1 ? "applicant" : "applicants"}</Badge>}
            </span>
            <span className="text-[13px] text-muted">
              {formatShortDate(c.startsOn)} to {formatShortDate(c.endsOn)} · {c.platforms.map((p) => PLATFORM_LABEL[p as Platform] ?? p).join(", ")}
            </span>
          </span>
          <span className="text-right text-[13px] text-muted">
            {c.joined} {c.joined === 1 ? "creator" : "creators"} · {c.tasks} {c.tasks === 1 ? "task" : "tasks"}
          </span>
        </Link>
      ))}
    </GlassCard>
  );
}
