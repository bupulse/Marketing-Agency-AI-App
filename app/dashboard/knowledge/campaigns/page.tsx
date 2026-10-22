import Link from "next/link";
import { CalendarRange, ImageIcon, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { Badge, Button, GlassCard } from "@/components/ui";
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
      <BackLink />
      <PageHeader title="Campaigns" description="Events, offers, promotions and launches. Give them dates and link the products they are about." action={all.length > 0 ? newButton : undefined} />
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
              {campaigns.map((c) => {
                const startsOn = dayString(c.startsAt);
                const endsOn = dayString(c.endsAt);
                const phase = campaignPhase({ startsOn, endsOn }, today);
                return (
                  <li key={c.id}>
                    <Link href={`${BASE}/${c.id}`} className="block h-full no-underline">
                      <GlassCard interactive padding="none" className="flex h-full flex-col overflow-hidden">
                        <div className="relative aspect-[16/9] bg-soft">
                          {c.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element -- private signed URL
                            <img src={c.thumb} alt="" loading="lazy" className="size-full object-cover" />
                          ) : (
                            <span aria-hidden className="flex size-full items-center justify-center bg-brand-gradient text-white/80">
                              <ImageIcon className="size-8" />
                            </span>
                          )}
                          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                            <Badge tone="blue" className="bg-glass-strong">
                              {CAMPAIGN_TYPE_LABEL[c.type]}
                            </Badge>
                            <Badge tone={phase === "running" ? "success" : "neutral"} className="bg-glass-strong">
                              {c.status === "ACTIVE" ? PHASE_LABEL[phase] : STATUS_LABEL[c.status]}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex flex-1 flex-col gap-1.5 p-4">
                          <strong className="line-clamp-2 text-[16px] leading-snug">{c.name}</strong>
                          <span className="truncate text-[14px] text-muted">{formatDateRange(startsOn, endsOn) || "No dates"}{c.priceInfo ? ` · ${c.priceInfo}` : ""}</span>
                          <div className="mt-auto flex flex-wrap gap-x-3 pt-2 text-[13px] text-muted">
                            <span>{c._count.products} {c._count.products === 1 ? "product" : "products"}</span>
                            <span>{c._count.contents} {c._count.contents === 1 ? "text" : "texts"}</span>
                          </div>
                        </div>
                      </GlassCard>
                    </Link>
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
