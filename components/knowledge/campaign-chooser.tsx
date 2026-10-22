import { ArrowRight, Lock, Megaphone, Store } from "lucide-react";
import Link from "next/link";
import { Badge, GlassCard } from "@/components/ui";

export type CreatorsAccess = "ok" | "upgrade" | "not_in_plan" | "role";

/**
 * Business info → Campaigns → New campaign asks first who posts it (docs/CREATOR_CAMPAIGN_WIZARD.md): the business on
 * its own pages (the Event / Offer / Promotion / Launch form) or content creators (the creator campaign wizard).
 */
export function CampaignChooser({ ownHref, creatorsHref, creators }: { ownHref: string; creatorsHref: string; creators: CreatorsAccess }) {
  const card = "flex h-full flex-col gap-4 p-5 sm:p-6";
  const open = creators === "ok";
  const creatorsBody = (
    <GlassCard interactive={open} className={card}>
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white">
          <Megaphone aria-hidden className="size-6" />
        </span>
        {creators === "upgrade" && <Badge tone="violet">Add to your plan</Badge>}
        {creators === "not_in_plan" && <Badge tone="neutral">Not in your plan</Badge>}
        {creators === "role" && (
          <Badge tone="neutral">
            <Lock aria-hidden className="mr-1 inline size-3" /> Owners and admins
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Content creators</h2>
        <p className="text-[15px] text-muted">Creators post about you on their own Instagram, Facebook or TikTok. You write one line, the AI drafts the rest; you pay for the views by Mobile Money.</p>
      </div>
      <span className="mt-auto inline-flex items-center gap-1.5 text-[15px] font-semibold text-pulse-blue">
        {open ? "Make a creator campaign" : creators === "upgrade" ? "See how to add it" : creators === "role" ? "Ask your company owner" : "Ask BuPulse about it"}
        {creators !== "role" && <ArrowRight aria-hidden className="size-4" />}
      </span>
    </GlassCard>
  );
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      <li>
        <Link href={ownHref} className="block h-full no-underline">
          <GlassCard interactive className={card}>
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-soft text-text">
              <Store aria-hidden className="size-6" />
            </span>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">My business, on my pages</h2>
              <p className="text-[15px] text-muted">An event, offer, promotion or launch. BuPulse writes the posts for your own pages from its details.</p>
            </div>
            <span className="mt-auto inline-flex items-center gap-1.5 text-[15px] font-semibold text-pulse-blue">
              Add a campaign <ArrowRight aria-hidden className="size-4" />
            </span>
          </GlassCard>
        </Link>
      </li>
      <li>
        {creators === "role" ? (
          <div aria-disabled className="h-full opacity-80">
            {creatorsBody}
          </div>
        ) : (
          <Link href={open ? creatorsHref : "/dashboard/upgrade?feature=creators"} className="block h-full no-underline">
            {creatorsBody}
          </Link>
        )}
      </li>
    </ul>
  );
}
