import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { OfferEditor } from "@/components/admin/offer-editor";
import { Panel, notice } from "@/components/admin/ui";
import { OfferCard } from "@/components/billing/offer-card";
import { Badge, Field, Input } from "@/components/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/types";
import { clientViewOf, getOffer, offerEditorContext } from "@/lib/offers/service";
import { OFFER_STATUS_LABEL } from "@/lib/offers/shared";
import { formatMinor } from "@/lib/region-format";
import { OFFER_TONE } from "@/components/admin/offer-tone";
import { withdrawOfferAction } from "../actions";

export const metadata = { title: "Offer" };
export const dynamic = "force-dynamic";

export default async function OfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  let offer;
  try {
    offer = await getOffer(id);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  const editing = offer.status === "draft";
  const ctx = editing ? await offerEditorContext({ businessId: offer.businessId, offerId: offer.id }) : null;
  const facts: [string, string | null][] = [
    ["Created", `${dateTime(offer.createdAt)} by ${offer.createdBy}`],
    ["Sent", offer.sentAt ? dateTime(offer.sentAt) : null],
    ["Open until", offer.validUntil ? dateTime(offer.validUntil) : null],
    ["Accepted", offer.acceptedAt ? `${dateTime(offer.acceptedAt)}${offer.payMethod ? `, paying by ${offer.payMethod === "momo" ? "Mobile Money" : "invoice"}` : ""}` : null],
    ["Paid", offer.paidAt ? dateTime(offer.paidAt) : null],
    ["Withdrawn", offer.withdrawnAt ? `${dateTime(offer.withdrawnAt)}: ${offer.withdrawReason ?? ""}` : null],
    ["Price", `${formatMinor(offer.adjustedMinor, offer.currency)}${offer.adjustedMinor !== offer.computedMinor ? ` (computed ${formatMinor(offer.computedMinor, offer.currency)}: ${offer.adjustReason ?? ""})` : ""}`],
    ["Custom plan", offer.customPlanKey],
  ];

  return (
    <>
      <PageHeader
        title={`Offer for ${offer.company}`}
        description={editing ? "A draft: the client does not see it yet." : "What the client sees is on the right."}
        action={<Badge tone={OFFER_TONE[offer.status] ?? "neutral"}>{OFFER_STATUS_LABEL[offer.status]}</Badge>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <p className="flex flex-wrap gap-4 px-1 text-sm">
        <Link href={`/admin/companies/${offer.businessId}`} className="underline">Company page</Link>
        <Link href={`/admin/offers?businessId=${offer.businessId}`} className="underline">All offers of this company</Link>
        {offer.invoiceId && !offer.invoiceId.startsWith("claim:") && <Link href={`/admin/invoices/${offer.invoiceId}`} className="underline">Its invoice</Link>}
        {offer.requestId && <Link href={`/admin/requests?open=${offer.requestId}`} className="underline">The request</Link>}
      </p>

      {editing && ctx ? (
        <OfferEditor businessId={offer.businessId} offerId={offer.id} region={ctx.region} bases={ctx.bases} prices={ctx.prices} initial={ctx.initial} addition={ctx.addition} additionUnavailable={ctx.additionUnavailable} ownerEmail={ctx.business.ownerEmail} now={new Date().toISOString()} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="Details">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-[15px]">
              {facts.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
              ))}
            </dl>
            <ul className="flex flex-col gap-1 border-t border-line pt-3 text-[15px]">
              {offer.lines.map((l) => (
                <li key={l.key} className="flex justify-between gap-3"><span>{l.label}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span><span className="tabular-nums">{formatMinor(l.totalMinor, offer.currency)}</span></li>
              ))}
            </ul>
          </Panel>
          <OfferCard offer={clientViewOf(offer)} preview />
        </div>
      )}

      {(offer.status === "draft" || offer.status === "sent" || offer.status === "accepted") && (
        <div>
          <ConfirmButton
            action={withdrawOfferAction}
            fields={{ id: offer.id }}
            label="Withdraw offer"
            title="Withdraw this offer?"
            description={offer.status === "accepted" ? "The client accepted it. Their open Mobile Money payment is closed and the invoice made from it is voided. A payment they have already reported must be decided in Payments first." : "The client no longer sees it. You can make a new one at any time."}
            confirmLabel="Withdraw"
          >
            <Field label="Reason (kept in the audit log)">
              <Input name="reason" required minLength={3} maxLength={300} />
            </Field>
          </ConfirmButton>
        </div>
      )}
    </>
  );
}
