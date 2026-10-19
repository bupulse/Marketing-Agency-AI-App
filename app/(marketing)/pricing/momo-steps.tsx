import { Smartphone } from "lucide-react";
import { formatPrice } from "@/components/billing/helpers";
import { GlassCard } from "@/components/ui";
import type { RegionalPlan } from "@/lib/region-prices";

/**
 * How paying by Mobile Money works, for regions that take it (docs/MOMO.md, "The flow"). The amounts are the region's
 * plans (the cards above); the MoMo Pay code and the reference are shown only inside the app, on the pay screen, so
 * nobody pays without a reference.
 */
export function MomoSteps({ plans, paymentMethods }: { plans: RegionalPlan[]; paymentMethods: readonly string[] }) {
  if (!paymentMethods.includes("momo") || plans.length === 0) return null;
  const card = paymentMethods.includes("card");
  const examples = plans.filter((p) => !p.isTrial).slice(0, 3);
  return (
    <GlassCard as="section" padding="lg" className="flex flex-col gap-4" aria-labelledby="momo-steps-title">
      <h2 id="momo-steps-title" className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Smartphone aria-hidden className="size-6 text-pulse-violet" />
        Pay with MTN MoMo or Airtel Money
      </h2>
      <ol className="flex flex-col gap-2 text-muted">
        <li><strong className="text-text">1. Sign up and choose your plan.</strong> {examples.map((p) => `${p.name}: ${formatPrice(p.monthlyPriceCents, p.currency)} a month`).join(" · ")}.</li>
        <li><strong className="text-text">2. Choose &ldquo;Mobile Money (MTN / Airtel)&rdquo;.</strong> You see the amount and your own reference, such as BP-7K3Q.</li>
        <li><strong className="text-text">3. Pay from your phone.</strong> MTN: tap &ldquo;Tap to dial&rdquo; (or dial the MoMo Pay code shown) and confirm with your PIN. Airtel: send the amount to the number shown with your reference.</li>
        <li><strong className="text-text">4. Tap &ldquo;I have paid&rdquo;.</strong> Type the transaction id from the SMS and add a screenshot of it.</li>
        <li><strong className="text-text">5. Done.</strong> We check it, usually within a few minutes, and your plan starts at once. You get an email, and a reminder 5 days before the next payment.</li>
      </ol>
      <p className="text-sm text-muted">
        Pay monthly or yearly (switch to Yearly above to see those prices). Nothing renews by itself with Mobile Money: you pay again when you choose.
        {card ? " Prefer a card? Choose Card at step 2: it is charged in US dollars and renews automatically." : ""}
      </p>
    </GlassCard>
  );
}
