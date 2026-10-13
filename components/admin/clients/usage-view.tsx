import Link from "next/link";
import type { ClientRow } from "@/lib/admin/client-health";
import { money, num } from "@/lib/admin/format";
import type { UsageMetric } from "@/lib/plans";
import { Empty, HowCalculated, Panel, Stat, TableWrap, Td, Th } from "../ui";

const used = (r: ClientRow, m: UsageMetric) => (
  <>
    {num(r.used[m])}
    {r.limits[m] > 0 && <span className="block text-xs text-muted">of {num(r.limits[m])}</span>}
  </>
);

/** What each client used this period, what that cost in AI this month and what they pay: the margin per client. */
export function UsageView({ rows, sort }: { rows: ClientRow[]; sort: "cost" | "margin" | "name" }) {
  const list = rows.filter((r) => r.status && r.status !== "CANCELED" && r.status !== "EXPIRED");
  const sorted = [...list].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "margin" ? a.mrrCents - a.aiCostMonthCents - (b.mrrCents - b.aiCostMonthCents) : b.aiCostMonthCents - a.aiCostMonthCents));
  const ai = list.reduce((s, r) => s + r.aiCostMonthCents, 0);
  const mrr = list.reduce((s, r) => s + r.mrrCents, 0);
  const losing = list.filter((r) => r.mrrCents > 0 && r.aiCostMonthCents > r.mrrCents).length;
  const trialCost = list.filter((r) => r.mrrCents === 0).reduce((s, r) => s + r.aiCostMonthCents, 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="AI cost this month" value={money(Math.round(ai))} source="All current clients" href="/admin/ai" />
        <Stat label="They pay (MRR)" value={money(mrr)} source="Per month" href="/admin/revenue#mrr" />
        <Stat label="AI cost of non-paying clients" value={money(Math.round(trialCost))} source="Trials and demos" />
        <Stat label="Clients costing more than they pay" value={num(losing)} tone={losing ? "danger" : undefined} source="This month's AI alone" />
      </div>
      <Panel
        title="Usage this period"
        description="Texts, images, video seconds, voice characters and chat replies since each client's period started, against their plan."
        action={
          <nav aria-label="Sort" className="flex gap-2 text-sm">
            {(["cost", "margin", "name"] as const).map((s) => (
              <Link key={s} href={`/admin/usage?sort=${s}`} aria-current={sort === s ? "page" : undefined} className={sort === s ? "font-semibold" : "text-muted underline"}>
                {s === "cost" ? "Highest cost" : s === "margin" ? "Lowest margin" : "Name"}
              </Link>
            ))}
          </nav>
        }
      >
        {sorted.length === 0 ? (
          <Empty>No current clients yet.</Empty>
        ) : (
          <TableWrap caption="Usage and margin per client" tall>
            <thead>
              <tr><Th>Company</Th><Th>Plan</Th><Th right>Texts</Th><Th right>Images</Th><Th right>Video s</Th><Th right>Voice chars</Th><Th right>Chat</Th><Th right>AI cost</Th><Th right>Pays / month</Th><Th right>Margin</Th></tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const margin = r.mrrCents - r.aiCostMonthCents;
                return (
                  <tr key={r.businessId}>
                    <Td className="max-w-[12rem]"><Link href={`/admin/companies/${r.businessId}`} className="block truncate font-medium underline">{r.name}</Link></Td>
                    <Td>{r.plan ?? "none"}</Td>
                    <Td right>{used(r, "text")}</Td>
                    <Td right>{used(r, "image")}</Td>
                    <Td right>{used(r, "videoSeconds")}</Td>
                    <Td right>{used(r, "voiceCharacters")}</Td>
                    <Td right>{used(r, "chat")}</Td>
                    <Td right>{money(Math.round(r.aiCostMonthCents))}</Td>
                    <Td right>{r.mrrCents ? money(r.mrrCents) : <span className="text-muted">0</span>}</Td>
                    <Td right className={margin < 0 ? "font-semibold text-danger" : "font-semibold"}>
                      {money(Math.round(margin))}
                      {r.mrrCents > 0 && <span className="block text-xs font-normal text-muted">{Math.round((margin / r.mrrCents) * 100)}%</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>
      <HowCalculated>
        <ul>
          <li>Usage is the client&apos;s counters for the current period (monthly from their period start; yearly plans reset monthly too), against their plan&apos;s limits.</li>
          <li>AI cost is the ledger&apos;s estimate of the company&apos;s AI calls this calendar month (UTC), voice and images included; website chat replies count too.</li>
          <li>Pays per month is their share of MRR: their plan&apos;s price, or what they last paid by Mobile Money, a yearly price divided by 12.</li>
          <li>Margin leaves out shared costs (hosting, the domain): see Revenue and profit for the whole picture.</li>
        </ul>
      </HowCalculated>
    </>
  );
}
