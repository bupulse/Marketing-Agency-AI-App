import type { ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";
import { Badge, GlassCard } from "@/components/ui";
import { formatMinor } from "@/lib/region-format";
import { MANAGED_TIER_LABEL, METRIC_LABEL, OFFER_STATUS_LABEL, type ClientOfferView } from "@/lib/offers/shared";

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kigali" });

/**
 * A custom plan offer as the client sees it (Billing, and the admin editor's preview): the price, what is added on
 * top of the base plan, the limits, the team's note and until when it is open. `actions` are the Accept / pay buttons.
 */
export function OfferCard({ offer, actions, preview = false }: { offer: ClientOfferView; actions?: ReactNode; preview?: boolean }) {
  const added = offer.features.filter((f) => f.added);
  const kept = offer.features.filter((f) => !f.added);
  const addition = offer.addition;
  const per = offer.interval === "YEAR" ? "year" : "month";
  return (
    <GlassCard as="section" id="offer" strong aria-labelledby={`offer-${offer.id}-heading`} className="flex flex-col gap-5 p-5 ring-2 ring-pulse-violet/50 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <Sparkles aria-hidden className="size-4 text-pulse-violet" />
            {preview ? "Preview: what the client sees" : addition ? (addition.selfServe ? "Features you are adding" : "Features added to your plan") : "A custom plan made for you"}
          </span>
          <strong id={`offer-${offer.id}-heading`} className="text-2xl tracking-[-0.02em]">
            {formatMinor(offer.totalMinor, offer.currency)}
            <span className="text-base font-medium text-muted">{addition ? " to pay now" : ` / ${per}`}</span>
          </strong>
          {addition && (
            <span className="text-sm text-muted">
              Only the added features, for the {addition.daysLeft} {addition.daysLeft === 1 ? "day" : "days"} left of your {per} ({formatMinor(addition.addonMinor, offer.currency)} / {per} prorated). Your plan still renews on {longDate(addition.renewsOn)}, then at{" "}
              <strong className="text-text">{formatMinor(addition.nextRenewalMinor, offer.currency)} / {per}</strong> ({addition.currentPlanName} plus the added features).
            </span>
          )}
          <span className="text-sm text-muted">
            {offer.adjustment && offer.computedMinor > offer.totalMinor ? (
              <>
                <s>{formatMinor(offer.computedMinor, offer.currency)}</s> {offer.adjustment}.{" "}
              </>
            ) : null}
            {addition ? "" : offer.basePlanName ? `${offer.basePlanName} plan plus what you asked for.` : "Only what you asked for."}
            {offer.validUntil && offer.status === "sent" ? ` Open until ${longDate(offer.validUntil)}.` : ""}
          </span>
        </div>
        {offer.status !== "sent" && <Badge tone={offer.status === "accepted" ? "blue" : offer.status === "paid" ? "success" : "neutral"}>{OFFER_STATUS_LABEL[offer.status]}</Badge>}
      </div>

      {offer.note && <p className="rounded-2xl bg-soft px-4 py-3 text-[15px] whitespace-pre-line">{offer.note}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{offer.basePlanName ? "Added to your plan" : "Included"}</h3>
          <ul className="flex flex-col gap-2">
            {(added.length ? added : kept).map((f) => (
              <li key={f.key} className="flex items-start gap-2.5 text-[15px]">
                <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                <span>
                  <strong className="font-medium">{f.label}</strong>
                  {f.key === "managed" && offer.managedTier ? <span className="block text-[13px] text-muted">{MANAGED_TIER_LABEL[offer.managedTier]}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {added.length > 0 && kept.length > 0 && <p className="text-[13px] text-muted">Plus everything in {offer.basePlanName}: {kept.map((f) => f.label).join(", ")}.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Limits</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[15px]">
            {(["text", "image", "chat", "seats"] as const)
              .filter((m) => m === "seats" || offer.limits[m] > 0)
              .map((m) => (
                <div key={m} className="contents">
                  <dt className="text-muted">{METRIC_LABEL[m]}</dt>
                  <dd className="text-right font-medium tabular-nums">{offer.limits[m].toLocaleString("en-US")}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>

      {offer.status === "accepted" && !preview && (
        <p className="text-sm text-muted">
          {offer.payMethod === "invoice" ? "Your invoice is below. " : "Pay by Mobile Money below. "}
          {addition ? "The added features switch on as soon as the payment is confirmed; your period end does not change." : "Your custom plan switches on as soon as the payment is confirmed. Until then your current plan stays as it is."}
        </p>
      )}
      {actions}
    </GlassCard>
  );
}
