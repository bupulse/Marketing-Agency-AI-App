import Link from "next/link";
import { Panel } from "@/components/admin/ui";
import { OFFER_TONE } from "@/components/admin/offer-tone";
import { Badge, Button } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { listOffers } from "@/lib/offers/service";
import { listPlanRequests } from "@/lib/offers/requests";
import { acceptedAgoText, OFFER_STATUS_LABEL, REQUEST_STATUS_LABEL } from "@/lib/offers/shared";
import { formatMinor } from "@/lib/region-format";

/** Client 360 → "Custom plan": Customise plan, the company's latest offers and its open requests (docs/OFFERS.md). */
export async function CompanyOffers({ businessId }: { businessId: string }) {
  const [offers, requests] = await Promise.all([listOffers({ businessId, limit: 5 }).catch(() => []), listPlanRequests({ businessId, limit: 5 }).catch(() => [])]);
  const now = new Date();
  const openRequest = requests.find((r) => r.status === "new" || r.status === "contacted");
  return (
    <Panel
      title="Custom plan"
      description="A private plan for this company, priced from its region's add-on prices. The client accepts and pays it on Billing."
      action={<Button href={`/admin/offers/new?businessId=${businessId}${openRequest ? `&request=${openRequest.id}` : ""}`} size="sm">Customise plan</Button>}
    >
      {offers.length === 0 && requests.length === 0 ? (
        <p className="text-sm text-muted">No offers or requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-[15px]">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/admin/requests?open=${r.id}`} className="underline">Request of {dateTime(r.createdAt)}</Link>
              <span className="flex flex-wrap items-center gap-2">
                {r.call?.status === "booked" && <span className="text-[13px] text-muted">Call {r.call.when}</span>}
                <Badge tone={r.status === "new" ? "violet" : "neutral"}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
              </span>
            </li>
          ))}
          {offers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/admin/offers/${o.id}`} className="underline">
                {o.removed.length > 0 ? `Removed ${o.removed.join(", ")} from the card plan` : `Offer ${formatMinor(o.adjustedMinor, o.currency)} / ${o.interval === "YEAR" ? "year" : "month"}`}, {dateTime(o.createdAt)}
              </Link>
              <span className="flex flex-wrap items-center gap-2">
                {o.status === "accepted" && o.acceptedAt && <span className="text-[13px] text-muted">{acceptedAgoText(o.acceptedAt, now)}</span>}
                <Badge tone={OFFER_TONE[o.status] ?? "neutral"}>{OFFER_STATUS_LABEL[o.status]}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
