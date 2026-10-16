import Link from "next/link";
import type { SubscriptionSummary } from "@/lib/admin/subscription-summary";

const LABEL = { extend_trial: "Extend trial", change_plan: "Change plan" } as const;

/**
 * Where a company that is past its demo stands ("On trial until 15 Oct", "Active – Business, MoMo"), with links to the
 * company page's actions (Client 360: Extend trial, Change plan) instead of activation buttons that would be refused.
 */
export function SubscriptionStatus({ summary, businessId }: { summary: SubscriptionSummary; businessId: string }) {
  return (
    <span className="flex flex-col gap-0.5 text-[13px]">
      <span>{summary.text}</span>
      <span className="flex flex-wrap gap-x-3">
        {summary.links.map((l) => (
          <Link key={l} href={`/admin/companies/${encodeURIComponent(businessId)}?tab=billing#actions`} className="font-medium underline">
            {LABEL[l]}
          </Link>
        ))}
      </span>
    </span>
  );
}
