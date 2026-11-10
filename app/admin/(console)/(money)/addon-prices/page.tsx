import { Tags } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { AddonPricesView } from "@/components/admin/business/money-addons";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { addonPriceTable } from "@/lib/offers/addon-prices";
import { YEARLY_MONTHS } from "@/lib/offers/shared";

export const metadata = { title: "Add-on prices" };
export const dynamic = "force-dynamic";

/** Add-on prices, one region at a time (?region=XX; old #region-XX links open that region). Every change is audited. */
export default async function AddonPricesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("plans.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const table = await addonPriceTable();

  return (
    <>
      <PageHeader
        icon={Tags}
        tone="green"
        title="Add-on prices"
        description={`What each feature, block of a limit and extra user costs a month in each region. Custom plan offers add these on top of the base plan (yearly = ${YEARLY_MONTHS} months).`}
      />
      <MoneyNotices sp={sp} />
      <AddonPricesView table={table} regionKey={param(sp.region)} sp={sp} />
    </>
  );
}
