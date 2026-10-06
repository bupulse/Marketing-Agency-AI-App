import { Check, Minus } from "lucide-react";
import { PLANS } from "@/lib/plans";

const t = PLANS.TRIAL.limits;
const s = PLANS.STANDARD.limits;
const p = PLANS.PRO.limits;

type Cell = string | boolean;
// Numbers come from lib/plans.ts so the table never drifts from the real limits.
const rows: { label: string; trial: Cell; standard: Cell; pro: Cell }[] = [
  { label: "Price", trial: "Free for 7 days", standard: `$${PLANS.STANDARD.priceUsdMonthly}/month`, pro: `$${PLANS.PRO.priceUsdMonthly}/month` },
  { label: "AI text generations", trial: `${t.text} total`, standard: `${s.text} / month`, pro: `${p.text} / month` },
  { label: "Brand designs", trial: `${t.image} total`, standard: `${s.image} / month`, pro: `${p.image} / month` },
  { label: "Brand voice and business knowledge", trial: true, standard: true, pro: true },
  { label: "Post to Instagram, Facebook, TikTok, LinkedIn, YouTube", trial: true, standard: true, pro: true },
  { label: "Content calendar and scheduling", trial: true, standard: true, pro: true },
  { label: "Lead-capturing website chat widget", trial: true, standard: true, pro: true },
  { label: "App connectors and API access", trial: false, standard: false, pro: true },
  { label: "Use your own Composio account", trial: false, standard: false, pro: true },
  { label: "Video and voiceover (when released)", trial: false, standard: false, pro: true },
];

function Value({ value }: { value: Cell }) {
  if (value === true) return <Check aria-label="Included" className="mx-auto size-5 text-success" />;
  if (value === false) return <Minus aria-label="Not included" className="mx-auto size-5 text-muted" />;
  return <span>{value}</span>;
}

/** Plan comparison. Scrolls sideways inside its own box on narrow screens. */
export function PlanComparison() {
  return (
    <div className="glass-strong overflow-x-auto rounded-card" tabIndex={0} role="region" aria-label="Plan comparison table">
      <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
        <caption className="sr-only">Compare the free trial, Standard and Pro plans</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-5 py-4 font-semibold">Feature</th>
            <th scope="col" className="px-5 py-4 text-center font-semibold">Free trial</th>
            <th scope="col" className="px-5 py-4 text-center font-semibold">Standard</th>
            <th scope="col" className="px-5 py-4 text-center font-semibold text-gradient">Pro</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line last:border-0">
              <th scope="row" className="px-5 py-3.5 font-medium">{row.label}</th>
              <td className="px-5 py-3.5 text-center text-muted"><Value value={row.trial} /></td>
              <td className="px-5 py-3.5 text-center"><Value value={row.standard} /></td>
              <td className="px-5 py-3.5 text-center"><Value value={row.pro} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
