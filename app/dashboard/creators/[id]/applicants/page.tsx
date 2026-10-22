import { Applicants } from "@/components/creators/company/applicants";
import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { applicantDetails } from "@/lib/creators/applicants-view";
import { campaignLimits, listCampaignCreators } from "@/lib/creators/campaigns";
import { offerExpired } from "@/lib/creators/company-forms";

export const metadata = { title: "Campaign applicants" };

export default async function CampaignApplicantsPage({ params }: PageProps<"/dashboard/creators/[id]/applicants">) {
  const { id } = await params;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { actor, campaign } = page;
  const [rows, limits] = await Promise.all([listCampaignCreators(actor, campaign.id), campaignLimits(actor.businessId)]);
  // The answers in words, the match against the campaign's requirements and the followers' check (lib/creators/applicants-view.ts).
  const details = await applicantDetails(actor.businessId, campaign.id, rows);
  // The same count as placesTaken() in lib/creators/campaigns.ts: invited, joined and offers still waiting.
  const taken = rows.filter((r) => r.status === "SELECTED" || r.status === "JOINED" || (r.status === "OFFERED" && !offerExpired(r.offeredAt))).length;
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="applicants" />
      <Applicants campaignId={campaign.id} rows={rows} details={details} places={{ taken, limit: limits.creatorsPerCampaign }} ended={campaign.status === "ENDED"} />
    </div>
  );
}
