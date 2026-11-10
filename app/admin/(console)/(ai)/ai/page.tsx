import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { requirePermission } from "@/lib/admin/auth";
import { AiUsageView } from "@/components/admin/content-ai/ai-usage-view";
import { param } from "@/lib/admin/format";
import { getAiUsage } from "@/lib/admin/ai-usage";

export const metadata = { title: "AI usage" };

/** This month in Kigali (UTC+2, like the ledger's days), as "YYYY-MM". */
const kigaliMonth = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 7);

export default async function AiPage({ searchParams }: PageProps<"/admin/ai">) {
  await requirePermission("ai"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  // AI costs are kept in dollars; shown in the admin's currency.
  const usd = (n: number) => fx.text(n * 100);
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param(sp.month)) ? param(sp.month) : undefined;
  const u = await getAiUsage({ month });
  return <AiUsageView u={u} usd={usd} currency={fx.display.currency} thisMonth={month ? kigaliMonth() : u.month} params={sp} message={{ notice: param(sp.notice) || undefined, error: param(sp.error) || undefined }} />;
}
