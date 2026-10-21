import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { CampaignOverviewView } from "@/components/creators/company/overview";
import { campaignOverview } from "@/lib/creators/analytics";

export const metadata = { title: "Creator campaign" };

export default async function CampaignOverviewPage({ params }: PageProps<"/dashboard/creators/[id]">) {
  const { id } = await params;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { actor, campaign } = page;
  const data = await campaignOverview(actor, campaign.id);
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="overview" />
      <CampaignOverviewView campaign={campaign} data={data} />
    </div>
  );
}
