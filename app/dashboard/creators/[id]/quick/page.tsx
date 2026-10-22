import { notFound, redirect } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { BackLink } from "@/components/knowledge/back-link";
import { campaignActor, creatorsGate } from "@/components/creators/company/campaign-page";
import { QuickCampaign } from "@/components/creators/company/quick/quick-campaign";
import { wizardOptions } from "@/components/creators/company/wizard/load";
import { CreatorCampaignError, getWizardCampaign } from "@/lib/creators/campaigns";
import { cardForStep, isQuickCard } from "@/lib/creators/quick";

export const metadata = { title: "Quick setup" };

/**
 * Quick mode for a draft still being set up (docs/QUIZ_MODE.md, "C"): cards 2 to 9 after the draft is made, and the
 * card quick mode's "Change" returns to (`?card=`). The Files and Ready cards make and count the campaign's Photos
 * folders, as the wizard's Files step does. Anything else (live, or set up already) opens Settings.
 */
export default async function QuickCampaignPage({ params, searchParams }: PageProps<"/dashboard/creators/[id]/quick">) {
  const blocked = await creatorsGate();
  if (blocked) return blocked;
  const { id } = await params;
  const { card: raw } = await searchParams;
  const actor = await campaignActor();
  const { business } = await getAppContext();
  const campaign = await getWizardCampaign(actor, id).catch((error) => {
    if (error instanceof CreatorCampaignError && error.code === "not_found") notFound();
    throw error;
  });
  if (campaign.status !== "DRAFT" || campaign.setupStep === null) redirect(`/dashboard/creators/${id}/settings`);
  const card = isQuickCard(raw) ? raw : cardForStep(campaign.setupStep);
  const { options, files } = await wizardOptions(actor, business, campaign, card === "files" || card === "ready" ? "files" : "goal");
  return (
    <div className="flex flex-col gap-4">
      <BackLink href="/dashboard/creators" label="Creator campaigns" />
      <QuickCampaign key={id} card={card} initial={files ? { ...campaign.answers, files } : campaign.answers} options={options} detailedHref={`/dashboard/creators/${id}/setup`} />
    </div>
  );
}
