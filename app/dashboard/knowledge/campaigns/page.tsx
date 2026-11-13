import Link from "next/link";
import { CalendarRange, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { SectionHeader } from "@/components/knowledge/section-header";
import { Button, GlassCard } from "@/components/ui";
import { CampaignCard } from "@/components/media-cards";
import { cn } from "@/lib/cn";
import { localDateISO, safeZone } from "@/lib/autopilot/timezone";
import { CAMPAIGN_TYPE_LABEL, campaignPhase, dayString, formatDateRange, PHASE_LABEL } from "@/lib/knowledge/campaigns";
import { STATUS_LABEL, type ItemStatusValue } from "@/lib/knowledge/products";
import { listCampaigns } from "@/lib/knowledge/service";

export const metadata = { title: "Campaigns" };

const BASE = "/dashboard/knowledge/campaigns";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const { status: raw } = await searchParams;
  const status = ["ACTIVE", "DRAFT", "ARCHIVED"].includes(raw ?? "") ? (raw as ItemStatusValue) : undefined;
  const [campaigns, all] = await Promise.all([listCampaigns(business.id, { status }), listCampaigns(business.id, { status: "all" })]);
  const today = localDateISO(new Date(), safeZone(business.timezone));
  const newButton = (
    <Button href={`${BASE}/new`} leading={<Plus aria-hidden className="size-[18px]" />}>
      New campaign
    </Button>
  );
  const chip = (active: boolean) => cn("inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium no-underline", active ? "bg-brand-gradient text-white" : "glass text-text");

  return (
    <>
      <SectionHeader section="campaigns" title="Campaigns" description="Events, offers, promotions and launches. Give them dates and link the products they are about." action={all.length > 0 ? newButton : undefined} />
      {all.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Add your first campaign"
          text="An open day, a month-end offer, a new branch or a product launch. BuPulse writes the posts for it from your details."
          points={["Dates, price or discount and highlights", "Linked products bring their details and photos", "Autopilot stops posting about it after it ends"]}
          action={newButton}
        />
      ) : (
        <>
          <nav aria-label="Filter by status" className="flex flex-wrap gap-2 px-1">
            {[["", "Active and drafts"], ["ACTIVE", "Active"], ["DRAFT", "Drafts"], ["ARCHIVED", "Archived"]].map(([value, label]) => (
              <Link key={value} href={value ? `${BASE}?status=${value}` : BASE} aria-current={(status ?? "") === value ? "page" : undefined} className={chip((status ?? "") === value)}>
                {label}
              </Link>
            ))}
          </nav>
          {campaigns.length === 0 ? (
            <GlassCard className="px-4 py-10 text-center text-[15px] text-muted">Nothing here.</GlassCard>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {campaigns.map((c, i) => {
                const startsOn = dayString(c.startsAt);
                const endsOn = dayString(c.endsAt);
                const phase = campaignPhase({ startsOn, endsOn }, today);
                const key = c.status !== "ACTIVE" ? (c.status === "DRAFT" ? "draft" : "ended") : phase === "running" ? "live" : phase === "upcoming" ? "scheduled" : phase === "ended" ? "ended" : "draft";
                return (
                  <li key={c.id} className="flex">
                    <CampaignCard
                      index={i}
                      className="w-full"
                      href={`${BASE}/${c.id}`}
                      name={c.name}
                      coverUrl={c.thumb}
                      kindLabel={CAMPAIGN_TYPE_LABEL[c.type]}
                      status={key}
                      statusLabel={c.status === "ACTIVE" ? PHASE_LABEL[phase] : STATUS_LABEL[c.status]}
                      line={c.priceInfo}
                      dateText={formatDateRange(startsOn, endsOn) || "No dates"}
                      facts={[`${c._count.products} ${c._count.products === 1 ? "product" : "products"}`, `${c._count.contents} ${c._count.contents === 1 ? "text" : "texts"}`]}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
