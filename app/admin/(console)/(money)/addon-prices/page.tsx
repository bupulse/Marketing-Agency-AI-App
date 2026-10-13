import { PageHeader } from "@/components/app";
import { Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Input } from "@/components/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { moneyInput } from "@/lib/invoices/shared";
import { addonPriceTable } from "@/lib/offers/addon-prices";
import { ADDONS, YEARLY_MONTHS } from "@/lib/offers/shared";
import { saveAddonPricesAction } from "./actions";

export const metadata = { title: "Add-on prices" };
export const dynamic = "force-dynamic";

const kindText = (a: (typeof ADDONS)[number]) =>
  a.kind === "block" ? "Block of a limit" : a.kind === "seat" ? "Per extra user" : a.includes ? `Feature, includes ${a.includes.amount} ${a.includes.metric === "image" ? "designs" : a.includes.metric === "chat" ? "chat replies" : "texts"}` : "Feature";

export default async function AddonPricesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const table = await addonPriceTable();

  return (
    <>
      <PageHeader
        title="Add-on prices"
        description={`What each feature, block of a limit and extra user costs per month in each region, in the region's currency. Custom plan offers add these up on top of the base plan's regional price (yearly = ${YEARLY_MONTHS} months). Leave a field empty for "no price here": the offer editor then warns and prices it at 0. Every change is audited.`}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      {table.map(({ region, prices }) => {
        const price = (key: string) => prices.find((p) => p.addonKey === key && p.currency === region.currency);
        return (
          <Panel key={region.key} title={`${region.name} (${region.key})`} description={`${region.currency} a month · ${prices.length} of ${ADDONS.length} add-ons priced`}>
            <form action={saveAddonPricesAction} id={`region-${region.key}`} className="flex flex-col gap-4">
              <input type="hidden" name="regionKey" value={region.key} />
              <TableWrap caption={`Add-on prices in ${region.name}`}>
                <thead>
                  <tr><Th>Add-on</Th><Th>Kind</Th><Th right>{region.currency} / month</Th></tr>
                </thead>
                <tbody>
                  {ADDONS.map((a) => {
                    const p = price(a.key);
                    const value = p ? moneyInput(p.monthlyMinor, region.currency) : "";
                    return (
                      <tr key={a.key}>
                        <Td>
                          <span className="font-medium">{a.label}</span>
                          <span className="block font-mono text-[12px] text-muted">{a.key}</span>
                        </Td>
                        <Td className="text-muted">{kindText(a)}</Td>
                        <Td right>
                          <input type="hidden" name={`before_${a.key}`} value={value} />
                          <div className="flex items-center justify-end gap-2">
                            {!p && <Badge tone="neutral">No price</Badge>}
                            <Input name={`price_${a.key}`} defaultValue={value} inputMode="decimal" aria-label={`${a.label} in ${region.currency} a month`} className="w-32 text-right" maxLength={14} />
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
              <div>
                <Button type="submit">Save {region.name} prices</Button>
              </div>
            </form>
          </Panel>
        );
      })}
    </>
  );
}
