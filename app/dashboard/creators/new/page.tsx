import { PageHeader } from "@/components/app/page-header";
import { CampaignForm } from "@/components/creators/company/campaign-form";
import { campaignActor, creatorsGate } from "@/components/creators/company/campaign-page";
import { addDaysYmd } from "@/lib/demo/slots";
import { defaultCurrency } from "@/lib/creators/campaigns";
import { dayIn } from "@/lib/creators/periods";
import { getAppContext } from "@/components/app/context";

export const metadata = { title: "New creator campaign" };

export default async function NewCampaignPage() {
  const blocked = await creatorsGate();
  if (blocked) return blocked;
  const actor = await campaignActor();
  const { business } = await getAppContext();
  // A month from tomorrow: one pay period.
  const first = addDaysYmd(dayIn(new Date(), business.timezone), 1);
  const currency = await defaultCurrency(actor.businessId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New creator campaign" description="Saved as a draft: add its tasks, then go live and share its link with creators." />
      <CampaignForm
        mode="create"
        initial={{ name: "", brief: "", rules: null, platforms: ["instagram", "tiktok"], startsOn: first, endsOn: addDaysYmd(first, 29), mentions: [], currency, payRules: {}, viewTargetPerCreator: null, viewTargetCampaign: null, budget: null, questions: [] }}
      />
    </div>
  );
}
