import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/app/empty-state";
import { FilterChips, KitStyles, PageHeader } from "@/components/admin/kit";
import { campaignActor, creatorsGate } from "@/components/creators/company/campaign-page";
import { CreatorFinder } from "@/components/creators/company/finder";
import { Button, GlassCard, Input } from "@/components/ui";
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
  const sp = Object.fromEntries(Object.entries({ platform: filters.platform ?? "", min: filters.minFollowers ? String(filters.minFollowers) : "", max: filters.maxFollowers ? String(filters.maxFollowers) : "", location: filters.location, verified: filters.verified ? "1" : "" }).filter(([, v]) => v));
  const base = "/dashboard/creators/find";
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader icon={Search} title="Find creators" description="Creators who chose to be found on BuPulse. Invite one to a campaign: they accept or decline in their creator account." back={{ href: "/dashboard/creators", label: "All campaigns" }} />
      <GlassCard className="flex flex-col gap-4 p-4 sm:p-5">
        <FilterRow label="Posts on">
          <FilterChips label="Platform" param="platform" base={base} params={sp} current={filters.platform ?? ""} options={[{ value: "", label: "Any platform" }, ...PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))]} />
        </FilterRow>
        <FilterRow label="At least">
          <FilterChips label="Followers from" param="min" base={base} params={sp} current={filters.minFollowers ? String(filters.minFollowers) : ""} options={[{ value: "", label: "Any" }, ...FOLLOWER_STEPS.map((n) => ({ value: String(n), label: `${formatCompact(n)} followers` }))]} />
        </FilterRow>
        <FilterRow label="At most">
          <FilterChips label="Followers up to" param="max" base={base} params={sp} current={filters.maxFollowers ? String(filters.maxFollowers) : ""} options={[{ value: "", label: "Any" }, ...FOLLOWER_STEPS.map((n) => ({ value: String(n), label: `${formatCompact(n)} followers` }))]} />
        </FilterRow>
        <FilterRow label="Accounts">
          <FilterChips label="Verified" param="verified" base={base} params={sp} current={filters.verified ? "1" : ""} options={[{ value: "", label: "All creators" }, { value: "1", label: "Verified only" }]} />
        </FilterRow>
        <form role="search" className="flex flex-wrap items-end gap-2">
          {Object.entries(sp)
            .filter(([k]) => k !== "location")
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm font-medium">
            Location
            <Input name="location" defaultValue={filters.location} placeholder="Kigali, Musanze…" maxLength={60} />
          </label>
          <Button type="submit" variant="outline" leading={<Search aria-hidden className="size-4" />}>
            Search
          </Button>
        </form>
        <p className="text-[13px] text-muted">Verified: the creator connected that account to BuPulse, so its views are real readings. Records count every BuPulse campaign, without other companies&apos; names or pay.</p>
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

/** One filter: a short name on the left (above on a phone) and its chips. */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-24 shrink-0 text-[13px] font-semibold text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
