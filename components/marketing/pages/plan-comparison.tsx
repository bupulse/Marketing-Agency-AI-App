import { Check, Minus } from "lucide-react";
import { formatCents } from "@/components/billing/helpers";
import type { PublicPlan } from "@/lib/plan-catalog";

type Cell = string | boolean;

function rowsFor(plans: PublicPlan[]): { label: string; cells: Cell[] }[] {
  const each = (f: (p: PublicPlan) => Cell) => plans.map(f);
  const total = (p: PublicPlan, n: number) => (p.isTrial ? `${n} total` : `${n} / month`);
  const rows: { label: string; cells: Cell[] }[] = [
    { label: "Price", cells: each((p) => (p.isTrial ? `Free for ${p.trialDays ?? 7} days` : `${formatCents(p.monthlyPriceCents)}/month`)) },
    { label: "AI text generations", cells: each((p) => total(p, p.limits.text)) },
    { label: "Brand designs", cells: each((p) => total(p, p.limits.image)) },
    { label: "Brand voice and business knowledge", cells: each(() => true) },
    { label: "Post to Instagram, Facebook, TikTok, LinkedIn, YouTube", cells: each(() => true) },
    { label: "Content calendar and scheduling", cells: each(() => true) },
    { label: "Lead-capturing website chat widget", cells: each(() => true) },
    { label: "App connectors and API access", cells: each((p) => p.capabilities.apiAccess) },
    { label: "Use your own Composio account", cells: each((p) => p.capabilities.ownComposio) },
    { label: "Video and voiceover (when released)", cells: each((p) => p.limits.videoSeconds > 0 || p.limits.voiceCharacters > 0) },
  ];
  return rows;
}

function Value({ value }: { value: Cell }) {
  if (value === true) return <Check aria-label="Included" className="mx-auto size-5 text-success" />;
  if (value === false) return <Minus aria-label="Not included" className="mx-auto size-5 text-muted" />;
  return <span>{value}</span>;
}

/** Plan comparison. The columns and numbers come from the plans in the database. Scrolls sideways inside its own box on narrow screens. */
export function PlanComparison({ plans }: { plans: PublicPlan[] }) {
  const rows = rowsFor(plans);
  return (
    <div className="glass-strong overflow-x-auto rounded-card" tabIndex={0} role="region" aria-label="Plan comparison table">
      <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
        <caption className="sr-only">Compare {plans.map((p) => p.name).join(", ")}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-5 py-4 font-semibold">Feature</th>
            {plans.map((p) => (
              <th key={p.key} scope="col" className={`px-5 py-4 text-center font-semibold ${p.highlight ? "text-gradient" : ""}`}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line last:border-0">
              <th scope="row" className="px-5 py-3.5 font-medium">{row.label}</th>
              {row.cells.map((cell, i) => (
                <td key={plans[i].key} className={`px-5 py-3.5 text-center ${plans[i].isTrial ? "text-muted" : ""}`}><Value value={cell} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
