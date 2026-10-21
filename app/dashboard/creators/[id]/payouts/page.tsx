import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { Payouts } from "@/components/creators/company/payouts";
import { payoutPeriods } from "@/lib/creators/analytics";

export const metadata = { title: "Campaign payouts" };

export default async function CampaignPayoutsPage({ params }: PageProps<"/dashboard/creators/[id]/payouts">) {
  const { id } = await params;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { actor, campaign } = page;
  const periods = await payoutPeriods(actor, campaign.id);
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="payouts" />
      <Payouts campaignId={campaign.id} periods={periods} currency={campaign.currency} ended={campaign.status === "ENDED"} />
    </div>
  );
}
