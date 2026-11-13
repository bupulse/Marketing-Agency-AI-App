import { Megaphone, Plus, Search } from "lucide-react";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import { Button } from "@/components/ui";
import type { CampaignRow } from "@/lib/creators/campaigns";
import { CampaignList } from "./campaign-list";

/** The Creator campaigns page (plain data in, so the page and the dev preview draw the same). */
export function CreatorsScreen({ campaigns, limits }: { campaigns: CampaignRow[]; limits: { liveCampaigns: number; creatorsPerCampaign: number } }) {
  const running = campaigns.filter((c) => c.status === "LIVE" || c.status === "PAUSED").length;
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader
        icon={Megaphone}
        title="Creator campaigns"
        description="Creators post about you on their own accounts. BuPulse counts the views and works out their pay; you pay by Mobile Money."
        actions={
          campaigns.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button href="/dashboard/creators/find" variant="outline" leading={<Search aria-hidden className="size-4" />}>
                Find creators
              </Button>
              <Button href="/dashboard/creators/new" leading={<Plus aria-hidden className="size-4" />}>
                New campaign
              </Button>
            </div>
          ) : undefined
        }
      />
      <CampaignList campaigns={campaigns} />
      {campaigns.length > 0 && (
        <p className="px-1 text-[13px] text-muted">
          {running} of {limits.liveCampaigns} live campaigns on your plan (paused ones count). Up to {limits.creatorsPerCampaign} creators in each.
        </p>
      )}
    </div>
  );
}
