import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { formatMinor } from "@/lib/region-format";
import type { ClientOfferView } from "@/lib/offers/shared";

/** "Your custom plan is ready" across the dashboard while an offer waits for the owner (docs/OFFERS.md). */
export function OfferBanner({ offer }: { offer: ClientOfferView }) {
  const price = `${formatMinor(offer.totalMinor, offer.currency)} / ${offer.interval === "YEAR" ? "year" : "month"}`;
  return (
    <GlassCard role="status" className="flex flex-wrap items-center justify-between gap-3 border border-pulse-violet/40 p-4">
      <p className="flex items-start gap-2.5 text-[15px]">
        <Sparkles aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-violet" />
        <span>
          <strong>{offer.status === "accepted" ? "Your custom plan is waiting for payment." : "Your custom plan is ready."}</strong>{" "}
          <span className="text-muted">{price}, made for your business.</span>
        </span>
      </p>
      <Link href="/dashboard/billing#offer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold no-underline">
        {offer.status === "accepted" ? "Pay now" : "See the offer"}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </GlassCard>
  );
}
