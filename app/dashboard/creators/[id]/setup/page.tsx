import { notFound, redirect } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { campaignActor, creatorsGate } from "@/components/creators/company/campaign-page";
import { wizardOptions } from "@/components/creators/company/wizard/load";
import { CampaignWizard } from "@/components/creators/company/wizard/wizard";
import { CreatorCampaignError, getWizardCampaign } from "@/lib/creators/campaigns";
import { STEP_COUNT, stepAt } from "@/lib/creators/wizard";

export const metadata = { title: "Set up your creator campaign" };

/**
 * Steps 2 to 12 of the wizard, and every step when editing (Settings). A draft still in the wizard opens at most the
 * furthest step it reached; ?step= past it opens that one.
 */
export default async function CampaignSetupPage({ params, searchParams }: PageProps<"/dashboard/creators/[id]/setup">) {
  const blocked = await creatorsGate();
  if (blocked) return blocked;
  const { id } = await params;
  const { step: raw } = await searchParams;
  const actor = await campaignActor();
  const { business } = await getAppContext();
  const campaign = await getWizardCampaign(actor, id).catch((error) => {
    if (error instanceof CreatorCampaignError && error.code === "not_found") notFound();
    throw error;
  });
  if (campaign.status === "ENDED") redirect(`/dashboard/creators/${id}/settings`);
  const asked = Number(typeof raw === "string" ? raw : NaN);
  const furthest = campaign.setupStep ?? STEP_COUNT;
  const step = stepAt(Math.min(Number.isFinite(asked) && asked >= 1 ? asked : furthest, furthest)).id;
  const { options, files } = await wizardOptions(actor, business, campaign, step);
  return <CampaignWizard key={step} step={step} initial={files ? { ...campaign.answers, files } : campaign.answers} options={options} />;
}
