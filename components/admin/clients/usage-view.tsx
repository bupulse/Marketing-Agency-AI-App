import { NO_RWF, sumRwf } from "@/lib/money/revenue-shared";
import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import { AlertTriangle, BarChart3, Coins, Sparkles, Users } from "lucide-react";
import { DataList, EmptyState, FilterChips, StatGrid, StatTile } from "@/components/admin/kit";
import type { ClientRow } from "@/lib/admin/client-health";
import { num } from "@/lib/admin/format";
import type { UsageMetric } from "@/lib/plans";
import { HowCalculated, Panel } from "../ui";

const used = (r: ClientRow, m: UsageMetric) => (
  <>
    {num(r.used[m])}
    {r.limits[m] > 0 && <span className="block text-xs text-muted">of {num(r.limits[m])}</span>}
  </>
);

const SORTS = [
  { value: "cost", label: "Highest AI cost" },
  { value: "margin", label: "Lowest margin" },
  { value: "name", label: "Name" },
];

/** What each client used this period, what that cost in AI this month and what they pay: the margin per client. */
export function UsageView({ rows, sort, fx = BOOKS_FMT, base = "/admin/usage" }: { rows: ClientRow[]; sort: "cost" | "margin" | "name"; fx?: MoneyFmt; base?: string }) {
  const list = rows.filter((r) => r.status && r.status !== "CANCELED" && r.status !== "EXPIRED");
  const sorted = [...list].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "margin" ? a.mrrCents - a.aiCostMonthCents - (b.mrrCents - b.aiCostMonthCents) : b.aiCostMonthCents - a.aiCostMonthCents));
  const ai = list.reduce((s, r) => s + r.aiCostMonthCents, 0);
  const mrr = list.reduce((s, r) => s + r.mrrCents, 0);
  const mrrRwf = sumRwf(list.map((r) => r.mrrRwf ?? NO_RWF));
  const losing = list.filter((r) => r.mrrCents > 0 && r.aiCostMonthCents > r.mrrCents).length;
  const trialCost = list.filter((r) => r.mrrCents === 0).reduce((s, r) => s + r.aiCostMonthCents, 0);
  return (
    <>
      <StatGrid cols={4} className="grid-cols-1 sm:grid-cols-2">
        <StatTile icon={Sparkles} tone="violet" label="AI cost this month" value={fx.text(Math.round(ai))} title={fx.title(Math.round(ai))} hint="What every current client's AI cost us." href="/admin/ai" />
        <StatTile icon={Coins} tone="green" label="They pay (MRR)" value={fx.amount(mrr, mrrRwf)} title={fx.amountTitle(mrr, mrrRwf)} hint="What they pay us each month." href="/admin/revenue#mrr" />
        <StatTile icon={Users} tone="blue" label="AI cost of non-paying clients" value={fx.text(Math.round(trialCost))} title={fx.title(Math.round(trialCost))} hint="Trials and demos: the price of winning them." />
        <StatTile icon={AlertTriangle} tone="blue" label="Clients costing more than they pay" value={num(losing)} alert={losing > 0} hint="This month's AI alone is more than their plan." />
      </StatGrid>
      <Panel icon={BarChart3} tone="blue" title="Usage this period" description="Texts, images, videos, voice characters and chat replies since each client's period started, against their plan.">
        <FilterChips label="Sort clients" param="sort" base={base} current={sort} allValue="cost" options={SORTS} />
        <DataList<ClientRow>
          caption="Usage and margin per client"
          rows={sorted}
          rowKey={(r) => r.businessId}
          rowHref={(r) => `/admin/companies/${r.businessId}`}
          columns={[
            { key: "name", header: "Company", primary: true, cell: (r) => <span className="block max-w-[12rem] truncate">{r.name}</span> },
            { key: "plan", header: "Plan", cell: (r) => r.plan ?? "none", hideOnPhone: true },
            { key: "text", header: "Texts", align: "right", cell: (r) => used(r, "text"), hideOnPhone: true },
            { key: "image", header: "Images", align: "right", cell: (r) => used(r, "image"), hideOnPhone: true },
            { key: "videos", header: "Video s", align: "right", cell: (r) => used(r, "videos"), hideOnPhone: true },
            { key: "voice", header: "Voice chars", align: "right", cell: (r) => used(r, "voiceCharacters"), hideOnPhone: true },
            { key: "chat", header: "Chat", align: "right", cell: (r) => used(r, "chat"), hideOnPhone: true },
            { key: "ai", header: "AI cost", align: "right", cell: (r) => fx.el(Math.round(r.aiCostMonthCents)) },
            { key: "pays", header: "Pays / month", align: "right", cell: (r) => (r.mrrCents ? fx.amountEl(r.mrrCents, r.mrrRwf) : <span className="text-muted">0</span>) },
            {
              key: "margin",
              header: "Margin",
              align: "right",
              cell: (r) => {
                const margin = r.mrrCents - r.aiCostMonthCents;
                return (
                  <span className={margin < 0 ? "font-semibold text-danger" : "font-semibold"}>
                    {fx.amountEl(Math.round(margin), r.mrrRwf)}
                    {r.mrrCents > 0 && <span className="block text-xs font-normal text-muted">{Math.round((margin / r.mrrCents) * 100)}%</span>}
                  </span>
                );
              },
            },
          ]}
          empty={<EmptyState icon={BarChart3} title="No current clients yet." />}
        />
      </Panel>
      <HowCalculated>
        <ul>
          <li>Usage is the client&apos;s counters for the current period (monthly from their period start; yearly plans reset monthly too), against their plan&apos;s limits.</li>
          <li>AI cost is the ledger&apos;s estimate of the company&apos;s AI calls this calendar month (Kigali time), voice and images included; website chat replies count too.</li>
          <li>Pays per month is their share of MRR: their plan&apos;s price, or what they last paid by Mobile Money, a yearly price divided by 12.</li>
          <li>Margin leaves out shared costs (hosting, the domain): see Revenue and profit for the whole picture.</li>
        </ul>
      </HowCalculated>
    </>
  );
}
