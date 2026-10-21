import { MessageCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { formatCompact } from "@/components/analytics/format";
import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { PostsList } from "@/components/creators/company/posts-list";
import { Badge, Button, GlassCard } from "@/components/ui";
import { creatorDetail } from "@/lib/creators/analytics";
import { CreatorCampaignError } from "@/lib/creators/campaigns";
import { CREATOR_STATUS_LABEL, formatAmount, PLATFORM_LABEL, whatsappLink, type Platform } from "@/lib/creators/company-forms";

export const metadata = { title: "Campaign creator" };

export default async function CampaignCreatorPage({ params }: PageProps<"/dashboard/creators/[id]/creators/[creatorId]">) {
  const { id, creatorId } = await params;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { actor, campaign } = page;
  const c = await creatorDetail(actor, campaign.id, creatorId).catch((error) => {
    if (error instanceof CreatorCampaignError && error.code === "not_found") notFound();
    throw error;
  });
  const money = (n: number) => formatAmount(n, campaign.currency);
  const wa = whatsappLink(c.phone, `Hi ${c.name.split(/\s+/)[0]}, about "${campaign.name}": `);
  const views = c.posts.reduce((s, p) => s + (p.status === "TRACKING" || p.status === "FINAL" ? p.views : 0), 0);
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="creators" />
      <GlassCard className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
              {c.name}
              <Badge tone={c.status === "JOINED" ? "success" : "neutral"}>{CREATOR_STATUS_LABEL[c.status] ?? c.status}</Badge>
            </h2>
            <p className="text-[14px] text-muted">
              {c.email}
              {c.phone ? ` · ${c.phone}` : ""}
            </p>
          </div>
          {wa && (
            <Button href={wa} size="sm" variant="outline" target="_blank" rel="noopener noreferrer" leading={<MessageCircle aria-hidden className="size-4" />}>
              WhatsApp
            </Button>
          )}
        </div>
        {c.handles.length > 0 && (
          <p className="text-[14px]">
            {c.handles.map((h) => `${PLATFORM_LABEL[h.network as Platform] ?? h.network} ${h.handle.startsWith("@") ? h.handle : `@${h.handle}`}${h.followers !== null ? ` (${formatCompact(h.followers)})` : ""}`).join(" · ")}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Views", formatCompact(views)],
            ["This period so far", money(c.earningNow)],
            ["To pay", money(c.due)],
            ["Paid", money(c.paid)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-soft p-3">
              <dt className="text-[13px] text-muted">{label}</dt>
              <dd className="text-[18px] font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </GlassCard>
      {c.payouts.length > 0 && (
        <GlassCard className="flex flex-col gap-2 p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Payouts</h2>
          <ul className="flex flex-col divide-y divide-line text-[14px]">
            {c.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>Period {p.period}</span>
                <span className="tabular-nums">
                  {money(p.amount)}
                  {p.deductions ? ` (${money(p.deductions)} taken back)` : ""}
                </span>
                <Badge tone={p.status === "PAID" ? "success" : "violet"}>{p.status === "PAID" ? `Paid${p.reference ? ` · ${p.reference}` : ""}` : "To pay"}</Badge>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-[17px] font-semibold">Posts ({c.posts.length})</h2>
        <PostsList campaignId={campaign.id} posts={c.posts} currency={campaign.currency} showCreator={false} earning />
      </section>
    </div>
  );
}
