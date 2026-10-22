import { Pencil } from "lucide-react";
import { Button } from "@/components/ui";
import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { CampaignSettingsExtras } from "@/components/creators/company/campaign-settings";
import { CampaignSummary } from "@/components/creators/company/wizard/review-step";
import { getWizardCampaign } from "@/lib/creators/campaigns";
import { subjectOptions } from "@/lib/knowledge/service";

export const metadata = { title: "Campaign settings" };

/** The campaign's steps, each opening the wizard on it (all of them can be opened), and the switches that stay here. */
export default async function CampaignSettingsPage({ params }: PageProps<"/dashboard/creators/[id]/settings">) {
  const { id } = await params;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { actor, campaign } = page;
  const [wizard, options] = await Promise.all([getWizardCampaign(actor, campaign.id), subjectOptions(actor.businessId)]);
  const facts = {
    products: options.products.map((p) => ({ id: p.id, label: p.name })),
    knowledgeCampaigns: options.campaigns.map((c) => ({ id: c.id, label: c.name })),
    counts: wizard.counts,
    hasCover: Boolean(wizard.answers.look.coverAssetId),
  };
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="settings" />
      <CampaignSettingsExtras campaignId={campaign.id} status={campaign.status} accepting={campaign.acceptingApplications} listed={campaign.listed} hiddenReason={campaign.hiddenAt ? campaign.hiddenReason : false} />
      {campaign.status === "ENDED" ? (
        <p className="px-1 text-[15px] text-muted">This campaign has ended, so its settings can no longer change.</p>
      ) : (
        <section aria-labelledby="campaign-steps" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div className="flex flex-col gap-1">
              <h2 id="campaign-steps" className="text-lg font-semibold tracking-[-0.02em]">
                Your campaign, step by step
              </h2>
              <p className="max-w-2xl text-[14px] text-muted">
                Open any step to change it.{campaign.status === "DRAFT" ? "" : " The dates and the currency are fixed now; new pay rules count from the period running now."}
              </p>
            </div>
            <Button href={`/dashboard/creators/${campaign.id}/setup?step=1`} variant="outline" size="sm" leading={<Pencil aria-hidden className="size-4" />}>
              Go through all steps
            </Button>
          </div>
          <CampaignSummary campaignId={campaign.id} a={wizard.answers} facts={facts} />
        </section>
      )}
    </div>
  );
}
