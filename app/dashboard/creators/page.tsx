import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui";
import { CampaignList } from "@/components/creators/company/campaign-list";
import { campaignActor, creatorsGate } from "@/components/creators/company/campaign-page";
import { campaignLimits, listCampaigns } from "@/lib/creators/campaigns";

export const metadata = { title: "Creator campaigns" };

export default async function CreatorsPage() {
  const blocked = await creatorsGate();
  if (blocked) return blocked;
  const actor = await campaignActor();
  const [campaigns, limits] = await Promise.all([listCampaigns(actor), campaignLimits(actor.businessId)]);
  const running = campaigns.filter((c) => c.status === "LIVE" || c.status === "PAUSED").length;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Creator campaigns"
        description="Creators post your tasks on their own accounts. BuPulse counts the views and works out their pay; you pay them by Mobile Money."
        action={
          campaigns.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button href="/dashboard/creators/find" variant="outline" leading={<Search aria-hidden className="size-4" />}>Find creators</Button>
              <Button href="/dashboard/creators/new" leading={<Plus aria-hidden className="size-4" />}>New campaign</Button>
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
