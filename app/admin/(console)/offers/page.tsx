import Link from "next/link";
import { Sparkles } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { OFFER_TONE } from "@/components/admin/offer-tone";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { formatMinor } from "@/lib/region-format";
import { listOffers } from "@/lib/offers/service";
import { acceptedAgoText, isOfferStatus, OFFER_STATUS_LABEL } from "@/lib/offers/shared";

export const metadata = { title: "Offers" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Waiting for payment" },
  { key: "paid", label: "Paid" },
  { key: "expired", label: "Expired" },
  { key: "withdrawn", label: "Withdrawn" },
];

export default async function OffersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const status = isOfferStatus(param(sp.status)) ? param(sp.status) : "";
  const businessId = param(sp.businessId).slice(0, 64);
  const offers = await listOffers({ status: status || undefined, businessId: businessId || undefined });
  const now = new Date();
  const qs = (s: string) => `/admin/offers?${new URLSearchParams({ ...(s && { status: s }), ...(businessId && { businessId }) })}`;

  return (
    <>
      <PageHeader
        title="Offers"
        description="Custom plans offered to companies. Make one from the company page (Customise plan) or from a plan request. The client accepts it on Billing and pays by Mobile Money or invoice; confirming the payment switches the custom plan on."
        action={<Link href="/admin/addon-prices" className="glass inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium no-underline">Add-on prices</Link>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <Panel
        title={`${offers.length} ${offers.length === 1 ? "offer" : "offers"}${businessId ? " for this company" : ""}`}
        action={
          <nav aria-label="Status" className="flex flex-wrap gap-1 rounded-full bg-soft p-1">
            {FILTERS.map((f) => (
              <Link key={f.key || "all"} href={qs(f.key)} aria-current={status === f.key ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium no-underline ${status === f.key ? "bg-surface text-text shadow-glass" : "text-muted"}`}>
                {f.label}
              </Link>
            ))}
          </nav>
        }
      >
        {offers.length === 0 ? (
          <EmptyState icon={Sparkles} title="No offers here" text="Open a company and choose Customise plan, or answer a plan request." />
        ) : (
          <TableWrap caption="Offers">
            <thead>
              <tr><Th>Company</Th><Th>Adds</Th><Th right>Price</Th><Th>Created</Th><Th>Open until / waiting</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <Td className="max-w-[14rem]"><Link href={`/admin/offers/${o.id}`} className="block truncate font-semibold underline">{o.company}</Link></Td>
                  <Td className="max-w-[16rem]"><span className="line-clamp-2 text-muted">{[o.basePlanName, ...o.added.map(String)].filter(Boolean).join(" + ") || "—"}</span></Td>
                  <Td right>{formatMinor(o.adjustedMinor, o.currency)} / {o.interval === "YEAR" ? "yr" : "mo"}</Td>
                  <Td className="whitespace-nowrap">{dateTime(o.createdAt)}</Td>
                  <Td className="whitespace-nowrap">{o.status === "accepted" && o.acceptedAt ? acceptedAgoText(o.acceptedAt, now) : o.validUntil && (o.status === "sent" || o.status === "expired") ? dateTime(o.validUntil) : "—"}</Td>
                  <Td><Badge tone={OFFER_TONE[o.status] ?? "neutral"}>{OFFER_STATUS_LABEL[o.status]}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
