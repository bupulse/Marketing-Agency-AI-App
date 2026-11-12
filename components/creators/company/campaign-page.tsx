import { Megaphone } from "lucide-react";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { featureGate, pageGate } from "@/components/app/no-access";
import { Badge, Button, type BadgeTone } from "@/components/ui";
import { CAMPAIGN_STATUS_LABEL, type CampaignStatus } from "@/lib/creators/company-forms";
import { CreatorCampaignError, getCampaign, type CampaignActor, type CampaignView } from "@/lib/creators/campaigns";
import { continueHref, detailedSetupHref } from "@/lib/creators/quick";
import { STEP_COUNT } from "@/lib/creators/wizard";
import { CampaignControls, PublicLink } from "./campaign-controls";
import { CampaignTabs, type CampaignTab } from "./campaign-tabs";

export const STATUS_TONE: Record<string, BadgeTone> = { DRAFT: "blue", LIVE: "success", PAUSED: "neutral", ENDED: "neutral" };

/** The `creators` permission and feature, for every creators page: the friendly page in place when either is missing. */
export async function creatorsGate() {
  return (await featureGate("creators")) ?? (await pageGate("creators"));
}

/** The person acting, for lib/creators/campaigns.ts. */
export async function campaignActor(): Promise<CampaignActor> {
  const { business, role, actorId } = await getAppContext();
  return { actorId, businessId: business.id, role };
}

/** A campaign page: the gate, then the campaign of this company (404 for anything else). */
export async function openCampaign(id: string): Promise<{ ok: false; blocked: React.ReactNode } | { ok: true; actor: CampaignActor; campaign: CampaignView }> {
  const blocked = await creatorsGate();
  if (blocked) return { ok: false, blocked };
  const actor = await campaignActor();
  try {
    return { ok: true, actor, campaign: await getCampaign(actor, id) };
  } catch (error) {
    if (error instanceof CreatorCampaignError && error.code === "not_found") notFound();
    throw error;
  }
}

/** The top of every campaign page: back link, name, status, public link, controls and the sections. */
export function CampaignHeader({ campaign, tab }: { campaign: CampaignView; tab: CampaignTab }) {
  return (
    <div className="flex flex-col gap-4">
      <KitStyles />
      <PageHeader
        icon={Megaphone}
        back={{ href: "/dashboard/creators", label: "All creator campaigns" }}
        title={campaign.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[campaign.status] ?? "neutral"}>{CAMPAIGN_STATUS_LABEL[campaign.status as CampaignStatus] ?? campaign.status}</Badge>
            {campaign.status === "LIVE" && !campaign.acceptingApplications && <Badge tone="neutral">Applications closed</Badge>}
            {campaign.hiddenAt && <Badge tone="danger">Hidden by BuPulse</Badge>}
          </span>
        }
        actions={<CampaignControls campaignId={campaign.id} status={campaign.status} problems={campaign.problems} />}
      />
      <div className="px-1">
        <PublicLink slug={campaign.slug} live={campaign.status === "LIVE"} />
      </div>
      {campaign.status === "DRAFT" && campaign.setupStep !== null && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ok-bg px-4 py-3">
          <p className="text-[15px] font-medium text-ok">
            Draft · step {campaign.setupStep} of {STEP_COUNT}. Finish setting it up to go live.
          </p>
          <span className="flex items-center gap-1">
            <Link href={detailedSetupHref(campaign.id, campaign.setupStep)} className="inline-flex min-h-11 items-center px-2 text-[13px] font-medium text-muted underline underline-offset-2 hover:text-text">
              Detailed setup
            </Link>
            <Button href={continueHref(campaign.id, campaign.setupStep)} size="sm">
              Continue
            </Button>
          </span>
        </div>
      )}
      <CampaignTabs campaignId={campaign.id} current={tab} applied={campaign.applied} />
    </div>
  );
}
