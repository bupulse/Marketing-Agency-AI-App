import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { CreatorsList } from "@/components/creators/company/creators-list";
import { creatorTotals } from "@/lib/creators/analytics";

export const metadata = { title: "Campaign creators" };

export default async function CampaignCreatorsPage({ params }: PageProps<"/dashboard/creators/[id]/creators">) {
  const { id } = await params;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { actor, campaign } = page;
  const rows = await creatorTotals(actor, campaign.id);
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="creators" />
      <CreatorsList campaignId={campaign.id} rows={rows} currency={campaign.currency} />
    </div>
  );
}
