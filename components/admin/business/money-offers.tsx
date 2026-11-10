import { Sparkles } from "lucide-react";
import { DataList, EmptyState, FilterChips, StatusPill, type PillTone, type SearchParamsLike } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { dateTime } from "@/lib/admin/format";
import type { AdminOfferView } from "@/lib/offers/service";
import { acceptedAgoText, OFFER_STATUS_LABEL } from "@/lib/offers/shared";
import { formatMinor } from "@/lib/region-format";

// Admin -> Money -> Offers: custom plans offered to one company. Plain data in: the page loads it, the dev preview
// passes made-up rows.

export const OFFER_FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Waiting for payment" },
  { value: "paid", label: "Paid" },
  { value: "expired", label: "Expired" },
  { value: "withdrawn", label: "Withdrawn" },
];

const PILL: Record<string, PillTone> = { draft: "muted", sent: "info", accepted: "warn", paid: "good", expired: "muted", withdrawn: "muted" };

/** An offer's state in words. */
export function OfferStatus({ status }: { status: AdminOfferView["status"] }) {
  return <StatusPill tone={PILL[status] ?? "muted"} dot>{OFFER_STATUS_LABEL[status]}</StatusPill>;
}

/** What the offer adds (or removes) to the base plan, in one line. */
export function offerSummary(o: Pick<AdminOfferView, "removed" | "added" | "basePlanName">): string {
  return o.removed.length > 0 ? `${o.basePlanName ?? "Plan"} − ${o.removed.map(String).join(", ")} (removed from the card plan)` : [o.basePlanName, ...o.added.map(String)].filter(Boolean).join(" + ") || "—";
}

export function OffersList({ offers, status, businessId, sp, now }: { offers: AdminOfferView[]; status: string; businessId: string; sp: SearchParamsLike; now: Date }) {
  return (
    <>
      <FilterChips label="Show offers" param="status" base="/admin/offers" params={sp} current={status} options={OFFER_FILTERS} />
      <Panel icon={Sparkles} tone="green" title={`${offers.length} ${offers.length === 1 ? "offer" : "offers"}${businessId ? " for this company" : ""}`} description="Newest first. Waiting for payment: the client accepted and has not paid yet.">
        <DataList<AdminOfferView>
          caption="Offers"
          rows={offers}
          rowKey={(o) => o.id}
          rowHref={(o) => `/admin/offers/${o.id}`}
          columns={[
            { key: "company", header: "Company", cell: (o) => o.company, primary: true },
            { key: "price", header: "Price", cell: (o) => <span className="whitespace-nowrap font-semibold">{formatMinor(o.adjustedMinor, o.currency)} / {o.interval === "YEAR" ? "yr" : "mo"}</span>, align: "right" },
            { key: "status", header: "Status", cell: (o) => <OfferStatus status={o.status} /> },
            { key: "adds", header: "Adds", cell: (o) => <span className="line-clamp-2 max-w-[18rem] text-muted">{offerSummary(o)}</span> },
            { key: "until", header: "Open until / waiting", cell: (o) => <span className="whitespace-nowrap">{o.status === "accepted" && o.acceptedAt ? acceptedAgoText(o.acceptedAt, now) : o.validUntil && (o.status === "sent" || o.status === "expired") ? dateTime(o.validUntil) : "—"}</span>, hideOnPhone: true },
            { key: "created", header: "Created", cell: (o) => <span className="whitespace-nowrap">{dateTime(o.createdAt)}</span>, hideOnPhone: true },
          ]}
          empty={<EmptyState icon={Sparkles} title="No offers here" hint="Open a company and choose Customise plan, or answer a plan request." />}
        />
      </Panel>
    </>
  );
}
