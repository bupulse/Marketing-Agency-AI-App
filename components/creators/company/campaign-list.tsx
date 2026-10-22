import { ArrowRight, Megaphone } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Badge, Button, GlassCard } from "@/components/ui";
import { formatShortDate } from "@/components/analytics/format";
import { CAMPAIGN_STATUS_LABEL, PLATFORM_LABEL, type CampaignStatus, type Platform } from "@/lib/creators/company-forms";
import type { CampaignRow } from "@/lib/creators/campaigns";
import { continueHref, detailedSetupHref } from "@/lib/creators/quick";
import { STEP_COUNT } from "@/lib/creators/wizard";
import { STATUS_TONE } from "./campaign-page";

/** The company's campaigns, newest first, or how to start the first one. */
export function CampaignList({ campaigns }: { campaigns: CampaignRow[] }) {
  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Your first creator campaign"
        text="Content creators post about you on their own Instagram, Facebook Page or TikTok. You set the tasks and the pay; BuPulse counts every post's views and works out what each creator earned. You pay them by Mobile Money."
        points={["Write one line: the AI drafts the whole campaign, you check it in a few quick cards", "Share one link: creators apply on it, and you pick the ones you like", "Watch the views come in, then pay at the end of each 30 days"]}
        action={<Button href="/dashboard/creators/new">New campaign</Button>}
      />
    );
  }
  return (
    <GlassCard padding="none" className="divide-y divide-line">
      {campaigns.map((c) => {
        // A draft still being set up: "Draft · step 6 of 12", Continue in quick mode, or the detailed wizard.
        const setting = c.status === "DRAFT" && c.setupStep !== null;
        const href = setting ? continueHref(c.id, c.setupStep!) : `/dashboard/creators/${c.id}`;
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-soft">
            <Link href={href} className="flex min-w-0 flex-1 flex-col gap-1 no-underline">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[15px] font-semibold">{c.name}</span>
                <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{setting ? `Draft · step ${c.setupStep} of ${STEP_COUNT}` : (CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status)}</Badge>
                {c.applied > 0 && <Badge tone="violet">{c.applied} new {c.applied === 1 ? "applicant" : "applicants"}</Badge>}
                {c.hidden && <Badge tone="danger">Hidden by BuPulse</Badge>}
              </span>
              <span className="text-[13px] text-muted">
                {formatShortDate(c.startsOn)} to {formatShortDate(c.endsOn)}
                {c.platforms.length > 0 && ` · ${c.platforms.map((p) => PLATFORM_LABEL[p as Platform] ?? p).join(", ")}`}
              </span>
            </Link>
            {setting ? (
              <span className="flex items-center gap-1">
                <Link href={detailedSetupHref(c.id, c.setupStep!)} className="inline-flex min-h-11 items-center px-2 text-[13px] font-medium text-muted underline underline-offset-2 hover:text-text">
                  Detailed setup
                </Link>
                <Button href={href} size="sm" trailing={<ArrowRight aria-hidden className="size-4" />}>
                  Continue
                </Button>
              </span>
            ) : (
              <span className="text-right text-[13px] text-muted">
                {c.joined} {c.joined === 1 ? "creator" : "creators"} · {c.tasks} {c.tasks === 1 ? "task" : "tasks"}
              </span>
            )}
          </div>
        );
      })}
    </GlassCard>
  );
}
