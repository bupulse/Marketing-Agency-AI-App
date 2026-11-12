import { ArrowRight, Megaphone } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Badge, Button } from "@/components/ui";
import { CampaignCard, campaignStatusKey } from "@/components/media-cards";
import { NETWORKS, type Network } from "@/lib/social/types";
import { formatShortDate } from "@/components/analytics/format";
import { CAMPAIGN_STATUS_LABEL, PLATFORM_LABEL, type CampaignStatus, type Platform } from "@/lib/creators/company-forms";
import type { CampaignRow } from "@/lib/creators/campaigns";
import { continueHref, detailedSetupHref } from "@/lib/creators/quick";
import { STEP_COUNT } from "@/lib/creators/wizard";

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
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {campaigns.map((c, i) => {
        // A draft still being set up: "Draft · step 6 of 12", Continue in quick mode, or the detailed wizard.
        const setting = c.status === "DRAFT" && c.setupStep !== null;
        const href = setting ? continueHref(c.id, c.setupStep!) : `/dashboard/creators/${c.id}`;
        const platforms = c.platforms.filter((p): p is Network => (NETWORKS as readonly string[]).includes(p));
        return (
          <li key={c.id} className="flex">
            <CampaignCard
              index={i}
              className="w-full"
              href={href}
              name={c.name}
              status={campaignStatusKey(c.status)}
              statusLabel={setting ? `Draft · step ${c.setupStep} of ${STEP_COUNT}` : (CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status)}
              kindLabel={c.platforms.length > 0 ? c.platforms.map((p) => PLATFORM_LABEL[p as Platform] ?? p).join(" · ") : "Creator campaign"}
              platforms={platforms}
              dateText={`${formatShortDate(c.startsOn)} to ${formatShortDate(c.endsOn)}`}
              creators={setting ? null : c.joined}
              facts={setting ? [] : [`${c.tasks} ${c.tasks === 1 ? "task" : "tasks"}`]}
              extra={
                c.applied > 0 || c.hidden ? (
                  <>
                    {c.applied > 0 && <Badge tone="violet">{c.applied} new {c.applied === 1 ? "applicant" : "applicants"}</Badge>}
                    {c.hidden && <Badge tone="danger">Hidden by BuPulse</Badge>}
                  </>
                ) : undefined
              }
              actions={
                setting
                  ? [
                      { id: "detailed", label: "Detailed setup", href: detailedSetupHref(c.id, c.setupStep!) },
                      { id: "continue", label: "Continue", tone: "primary", icon: <ArrowRight />, href },
                    ]
                  : []
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
