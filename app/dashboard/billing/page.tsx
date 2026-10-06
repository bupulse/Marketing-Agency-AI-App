import { Check } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, Button, GlassCard } from "@/components/ui";
import { PLANS } from "@/lib/plans";

export const metadata = { title: "Billing" };

const upgradePlans = ["STANDARD", "PRO"] as const;

function features(plan: (typeof PLANS)[keyof typeof PLANS]) {
  const { text, image, videoSeconds, voiceCharacters } = plan.limits;
  return [
    `${text} text generations per month`,
    `${image} images per month`,
    ...(videoSeconds > 0 ? [`${videoSeconds} seconds of video`] : []),
    ...(voiceCharacters > 0 ? [`${voiceCharacters.toLocaleString("en-US")} voice characters`] : []),
  ];
}

export default async function BillingPage() {
  const { usage, isTrial, trialDaysLeft } = await getAppContext();
  const { subscription, plan } = usage;
  const trialEnd = subscription.trialEndsAt?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <>
      <PageHeader title="Billing" description="Your plan, your trial and your upgrade options." />

      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">Current plan</span>
          <strong className="text-2xl tracking-[-0.02em]">{plan.name}</strong>
          {isTrial && trialEnd && (
            <span className="text-sm text-muted">
              Trial ends {trialEnd}
              {trialDaysLeft !== null && ` (${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left)`}
            </span>
          )}
        </div>
        <Badge tone={subscription.status === "ACTIVE" || subscription.status === "TRIALING" ? "success" : "danger"} className="capitalize">
          {subscription.status.toLowerCase().replace("_", " ")}
        </Badge>
      </GlassCard>

      <section aria-label="Plans" className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
        {upgradePlans.map((key) => {
          const p = PLANS[key];
          const current = subscription.plan === key;
          return (
            <GlassCard key={key} className="flex flex-col gap-5 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {key === "PRO" && <Badge tone="violet">Most complete</Badge>}
              </div>
              <p>
                <span className="text-4xl font-semibold tracking-[-0.03em]">${p.priceUsdMonthly}</span>
                <span className="text-muted"> / month</span>
              </p>
              <ul className="flex flex-1 flex-col gap-2 text-[15px]">
                {features(p).map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-blue" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2">
                <Button disabled aria-disabled="true" className="w-full">
                  {current ? "Current plan" : `Upgrade to ${p.name}`}
                </Button>
                <span className="text-center text-xs text-muted">Online upgrades are coming soon.</span>
              </div>
            </GlassCard>
          );
        })}
      </section>
    </>
  );
}
