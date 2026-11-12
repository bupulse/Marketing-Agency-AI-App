import { ArrowRight, Megaphone } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { CARD, FOCUS, LIFT } from "@/components/admin/kit/tones";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
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
    <ul className="kit-rise grid grid-cols-1 gap-3 md:grid-cols-2">
      {campaigns.map((c) => {
        // A draft still being set up: "Draft · step 6 of 12", Continue in quick mode, or the detailed wizard.
        const setting = c.status === "DRAFT" && c.setupStep !== null;
        const href = setting ? continueHref(c.id, c.setupStep!) : `/dashboard/creators/${c.id}`;
        return (
          <li key={c.id} className={cn("relative flex flex-col gap-3 p-4 sm:p-5", CARD, LIFT)}>
            <div className="flex items-start gap-3">
              <span aria-hidden className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-xl", c.status === "LIVE" ? "bg-brand-gradient text-white" : "bg-soft text-muted")}>
                <Megaphone className="size-5" />
              </span>
              <Link href={href} className={cn("flex min-w-0 flex-1 flex-col gap-1 text-text no-underline after:absolute after:inset-0 after:rounded-[22px] after:content-['']", FOCUS)}>
                <span className="truncate text-[16px] font-bold">{c.name}</span>
                <span className="text-[13px] text-muted">
                  {formatShortDate(c.startsOn)} to {formatShortDate(c.endsOn)}
                  {c.platforms.length > 0 && ` · ${c.platforms.map((p) => PLATFORM_LABEL[p as Platform] ?? p).join(", ")}`}
                </span>
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{setting ? `Draft · step ${c.setupStep} of ${STEP_COUNT}` : (CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status)}</Badge>
              {c.applied > 0 && <Badge tone="violet">{c.applied} new {c.applied === 1 ? "applicant" : "applicants"}</Badge>}
              {c.hidden && <Badge tone="danger">Hidden by BuPulse</Badge>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              {setting ? (
                <>
                  <Link href={detailedSetupHref(c.id, c.setupStep!)} className="relative z-10 inline-flex min-h-10 items-center text-[13px] font-medium text-muted underline underline-offset-2 hover:text-text">
                    Detailed setup
                  </Link>
                  <Button href={href} size="sm" className="relative z-10" trailing={<ArrowRight aria-hidden className="size-4" />}>
                    Continue
                  </Button>
                </>
              ) : (
                <span className="text-[13px] text-muted">
                  <strong className="font-semibold tabular-nums text-text">{c.joined}</strong> {c.joined === 1 ? "creator" : "creators"} · <strong className="font-semibold tabular-nums text-text">{c.tasks}</strong> {c.tasks === 1 ? "task" : "tasks"}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
