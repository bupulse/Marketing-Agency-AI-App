import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { Repeat } from "lucide-react";
import { PageHeader, chosen } from "@/components/admin/kit";
import { CostRecurring, CostsHow } from "@/components/admin/business/money-costs";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { requirePermission } from "@/lib/admin/auth";
import { getMonthCosts, listRecurringCosts } from "@/lib/money/costs";
import { addMonths, COST_PRESETS } from "@/lib/money/costs-shared";
import { kigaliMonthOf } from "@/lib/time/kigali";

export const metadata = { title: "Recurring costs" };

/** Recurring costs (it was the #recurring section of /admin/costs; ?preset= fills the form). Same permission. */
export default async function CostRecurringPage({ searchParams }: PageProps<"/admin/costs/recurring">) {
  await requirePermission("money.costs"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const sp = await searchParams;
  const thisMonth = kigaliMonthOf(new Date());
  const presetKey = chosen(sp, "preset", COST_PRESETS.map((p) => p.key), "");
  const [{ rwfPerUsd }, recurring] = await Promise.all([getMonthCosts(thisMonth, thisMonth), listRecurringCosts()]);
  return (
    <>
      <PageHeader icon={Repeat} tone="green" title="Recurring costs" description="Hosting, the domain and subscriptions: costs paid every month or year." back={{ href: "/admin/costs", label: "Costs" }} />
      <MoneyNotices sp={sp} />
      <CostRecurring fx={fx} recurring={recurring} thisMonth={thisMonth} lastMonth={addMonths(thisMonth, -1)} rwfPerUsd={rwfPerUsd} presetKey={presetKey} sp={sp} />
      <CostsHow rwfPerUsd={rwfPerUsd} />
    </>
  );
}
