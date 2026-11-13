import { campaignActor, creatorsGate } from "@/components/creators/company/campaign-page";
import { CreatorsScreen } from "@/components/creators/company/creators-screen";
import { campaignLimits, listCampaigns } from "@/lib/creators/campaigns";

export const metadata = { title: "Creator campaigns" };

export default async function CreatorsPage() {
  const blocked = await creatorsGate();
  if (blocked) return blocked;
  const actor = await campaignActor();
  const [campaigns, limits] = await Promise.all([listCampaigns(actor), campaignLimits(actor.businessId)]);
  return <CreatorsScreen campaigns={campaigns} limits={limits} />;
}
