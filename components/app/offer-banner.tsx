import Link from "next/link";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { formatMinor } from "@/lib/region-format";
import { checkingText } from "@/lib/billing/momo-shared";
import type { ClientOfferView } from "@/lib/offers/shared";

/**
 * Across the dashboard while an offer waits for the owner (docs/OFFERS.md): "Your custom plan is ready", or for
 * features added to the running plan, the one prorated amount to pay now. Once the owner has reported a Mobile Money
 * payment of it (`checkingReference`), only "we're checking your payment": no Pay now, so nobody pays twice.
 */
export function OfferBanner({ offer, checkingReference = null }: { offer: ClientOfferView; checkingReference?: string | null }) {
  if (checkingReference) {
    return (
      <GlassCard role="status" className="flex flex-wrap items-center justify-between gap-3 border border-pulse-blue/30 p-4">
        <p className="flex items-start gap-2.5 text-[15px]">
          <Loader2 aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin text-pulse-blue motion-reduce:animate-none" />
          <span>
            <strong>{checkingText(checkingReference)}</strong>{" "}
            <span className="text-muted">{offer.addition ? "The added features switch on" : "Your custom plan switches on"} as soon as it is confirmed.</span>
          </span>
        </p>
        <Link href="/dashboard/billing#offer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold no-underline">
          See Billing
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </GlassCard>
    );
  }
  const per = offer.interval === "YEAR" ? "year" : "month";
  const addition = offer.addition;
  const title = addition
    ? offer.status === "accepted"
      ? "Your added features are waiting for payment."
      : "Features for your plan are ready."
    : offer.status === "accepted"
      ? "Your custom plan is waiting for payment."
      : "Your custom plan is ready.";
  // Added features are paid once now, prorated for the days left; the plan's own price changes only at the renewal.
  const detail = addition
    ? `${formatMinor(offer.totalMinor, offer.currency)} paid once, for the ${addition.daysLeft} ${addition.daysLeft === 1 ? "day" : "days"} left of your ${per}. Then ${formatMinor(addition.nextRenewalMinor, offer.currency)} / ${per} from your next renewal.`
    : `${formatMinor(offer.totalMinor, offer.currency)} / ${per}, made for your business.`;
  return (
    <GlassCard role="status" className="flex flex-wrap items-center justify-between gap-3 border border-pulse-violet/40 p-4">
      <p className="flex items-start gap-2.5 text-[15px]">
        <Sparkles aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-violet" />
        <span>
          <strong>{title}</strong> <span className="text-muted">{detail}</span>
        </span>
      </p>
      <Link href="/dashboard/billing#offer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold no-underline">
        {offer.status === "accepted" ? "Pay now" : "See the offer"}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </GlassCard>
  );
}
