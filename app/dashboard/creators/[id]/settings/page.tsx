import { CampaignForm } from "@/components/creators/company/campaign-form";
import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { CampaignSettingsExtras } from "@/components/creators/company/campaign-settings";
import { defaultBudget } from "@/lib/creators/campaigns";

export const metadata = { title: "Campaign settings" };

export default async function CampaignSettingsPage({ params }: PageProps<"/dashboard/creators/[id]/settings">) {
  const { id } = await params;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { campaign } = page;
  const budget = await defaultBudget(campaign.id);
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="settings" />
      <CampaignSettingsExtras campaignId={campaign.id} status={campaign.status} accepting={campaign.acceptingApplications} listed={campaign.listed} hiddenReason={campaign.hiddenAt ? campaign.hiddenReason : false} />
      {campaign.status === "ENDED" ? (
        <p className="px-1 text-[15px] text-muted">This campaign has ended, so its settings can no longer change.</p>
      ) : (
        <CampaignForm mode="edit" campaignId={campaign.id} draft={campaign.status === "DRAFT"} initial={{ ...campaign, budget }} />
      )}
    </div>
  );
}
