import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { campaignActor, creatorsGate } from "@/components/creators/company/campaign-page";
import { CreatorFinder } from "@/components/creators/company/finder";
import { Button, GlassCard, Input, Select } from "@/components/ui";
import { formatCompact } from "@/components/analytics/format";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/creators/company-forms";
import { findCreators, FOLLOWER_STEPS, readFinderFilters, type FinderFilters } from "@/lib/creators/finder";
import { offerCampaigns } from "@/lib/creators/offers";

export const metadata = { title: "Find creators" };

/** The page's link with these filters (and page), so a filtered list can be shared. */
function hrefOf(f: FinderFilters, page: number) {
  const q = new URLSearchParams();
  if (f.platform) q.set("platform", f.platform);
  if (f.minFollowers) q.set("min", String(f.minFollowers));
  if (f.maxFollowers) q.set("max", String(f.maxFollowers));
  if (f.location) q.set("location", f.location);
  if (f.verified) q.set("verified", "1");
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return `/dashboard/creators/find${s ? `?${s}` : ""}`;
}

export default async function FindCreatorsPage({ searchParams }: PageProps<"/dashboard/creators/find">) {
  const blocked = await creatorsGate();
  if (blocked) return blocked;
  const actor = await campaignActor();
  const filters = readFinderFilters(await searchParams);
  const [{ creators, hasMore }, campaigns] = await Promise.all([findCreators(actor, filters), offerCampaigns(actor)]);
  const filtered = Boolean(filters.platform || filters.minFollowers || filters.maxFollowers || filters.location || filters.verified);
  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/creators" className="inline-flex min-h-11 items-center gap-1.5 self-start px-1 text-[15px] font-medium text-muted no-underline hover:text-text">
        <ArrowLeft aria-hidden className="size-4" /> All campaigns
      </Link>
      <PageHeader title="Find creators" description="Creators who chose to be found by companies on BuPulse. Invite one to a live or draft campaign: they accept or decline in their creator account." />
      <GlassCard className="p-4 sm:p-5">
        <form role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.3fr_auto_auto] lg:items-end">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Platform
            <Select name="platform" defaultValue={filters.platform ?? ""}>
              <option value="">Any platform</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Followers from
            <Select name="min" defaultValue={filters.minFollowers ? String(filters.minFollowers) : ""}>
              <option value="">Any</option>
              {FOLLOWER_STEPS.map((n) => (
                <option key={n} value={n}>{formatCompact(n)}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Followers up to
            <Select name="max" defaultValue={filters.maxFollowers ? String(filters.maxFollowers) : ""}>
              <option value="">Any</option>
              {FOLLOWER_STEPS.map((n) => (
                <option key={n} value={n}>{formatCompact(n)}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Location
            <Input name="location" defaultValue={filters.location} placeholder="Kigali, Musanze…" maxLength={60} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[15px]">
            <input type="checkbox" name="verified" value="1" defaultChecked={filters.verified} className="size-5" />
            Verified only
          </label>
          <Button type="submit" leading={<Search aria-hidden className="size-4" />}>
            Show
          </Button>
        </form>
        <p className="mt-3 text-[13px] text-muted">Verified: the creator connected that account to BuPulse, so its views are real readings. Records count every BuPulse campaign, without other companies&apos; names or pay.</p>
      </GlassCard>
      {creators.length === 0 ? (
        <EmptyState
          icon={Search}
          title={filtered ? "No creators match" : "No creators to show yet"}
          text={filtered ? "Try fewer filters." : "Creators appear here once they make a BuPulse creator profile and switch on “Let companies find me”. Meanwhile, share your campaign's link: anyone can apply on it."}
          action={filtered ? <Button href="/dashboard/creators/find" variant="outline">Clear filters</Button> : undefined}
        />
      ) : (
        <CreatorFinder creators={creators} campaigns={campaigns} />
      )}
      {(filters.page > 1 || hasMore) && (
        <nav aria-label="Pages" className="flex flex-wrap gap-2">
          {filters.page > 1 && <Button href={hrefOf(filters, filters.page - 1)} variant="outline">Previous</Button>}
          {hasMore && <Button href={hrefOf(filters, filters.page + 1)} variant="outline">Next</Button>}
        </nav>
      )}
    </div>
  );
}
