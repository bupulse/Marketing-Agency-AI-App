import { Globe, Tags } from "lucide-react";
import { ChoiceTiles, EmptyState, HashRedirect, StatusPill, type SearchParamsLike } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { Button, Input } from "@/components/ui";
import { moneyInput } from "@/lib/invoices/shared";
import type { addonPriceTable } from "@/lib/offers/addon-prices";
import { ADDONS } from "@/lib/offers/shared";
import { saveAddonPricesAction } from "@/app/admin/(console)/(money)/addon-prices/actions";
import { vatApplies, type VatSettings } from "@/lib/billing/vat";
import { VatHint } from "@/components/admin/vat-hint";

export type AddonTable = Awaited<ReturnType<typeof addonPriceTable>>;

const kindText = (a: (typeof ADDONS)[number]) =>
  a.kind === "block" ? "Block of a limit" : a.kind === "seat" ? "Per extra user" : a.includes ? `Feature, includes ${a.includes.amount} ${a.includes.metric === "image" ? "designs" : a.includes.metric === "chat" ? "chat replies" : "texts"}` : "Feature";

/**
 * Add-on prices: pick a region (a tile each, with how many add-ons are priced there), then its prices as one form.
 * Only one region shows at a time; old #region-XX links open that region.
 */
export function AddonPricesView({ table, regionKey, sp, vat = null }: { table: AddonTable; regionKey: string; sp: SearchParamsLike; /** The VAT settings: RWF prices are typed before VAT; each shows what the client pays. */ vat?: VatSettings | null }) {
  const current = table.find((t) => t.region.key === regionKey) ?? table[0];
  if (!current) return <EmptyState icon={Globe} title="No active price regions." hint="Add or switch on a region in Money, Regions first." />;
  const { region, prices } = current;
  const price = (key: string) => prices.find((p) => p.addonKey === key && p.currency === region.currency);
  const priced = (t: AddonTable[number]) => t.prices.filter((p) => p.currency === t.region.currency).length;
  return (
    <>
      <HashRedirect to={Object.fromEntries(table.map((t) => [`region-${t.region.key}`, `/admin/addon-prices?region=${encodeURIComponent(t.region.key)}#region-${t.region.key}`]))} />
      <ChoiceTiles
        label="Region"
        param="region"
        base="/admin/addon-prices"
        params={sp}
        current={region.key}
        allValue={table[0].region.key}
        options={table.map((t) => ({ value: t.region.key, label: `${t.region.name}`, hint: `${t.region.currency} · ${priced(t)} of ${ADDONS.length} priced`, icon: Globe, tone: priced(t) < ADDONS.length ? "orange" : "green" }))}
      />
      <Panel icon={Tags} tone="green" title={`${region.name} (${region.key})`} description={`Prices in ${region.currency} a month${vat && vatApplies(region.currency, vat) ? `, before VAT (clients pay them with ${vat.ratePercent}% VAT)` : ""}. Leave a field empty for "no price here": the offer editor then warns and prices it at 0.`} id={`prices-${region.key}`}>
        <form action={saveAddonPricesAction} id={`region-${region.key}`} className="flex scroll-mt-24 flex-col gap-4">
          <input type="hidden" name="regionKey" value={region.key} />
          <ul aria-label={`Add-on prices in ${region.name}`} className="flex flex-col divide-y divide-line">
            {ADDONS.map((a) => {
              const p = price(a.key);
              const value = p ? moneyInput(p.monthlyMinor, region.currency) : "";
              return (
                <li key={a.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0">
                  <span className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold">
                      {a.label}
                      {!p && <StatusPill tone="warn">No price</StatusPill>}
                    </span>
                    <span className="text-[12.5px] text-muted">{kindText(a)} · <span className="font-mono">{a.key}</span></span>
                    {p && vat ? <VatHint minor={p.monthlyMinor} currency={region.currency} vat={vat} /> : null}
                  </span>
                  <input type="hidden" name={`before_${a.key}`} value={value} />
                  <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                    <Input name={`price_${a.key}`} defaultValue={value} inputMode="decimal" aria-label={`${a.label} in ${region.currency} a month`} className="w-32 text-right" maxLength={14} placeholder="No price" />
                    <span aria-hidden>{region.currency}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 p-2.5 pl-4 shadow-[0_12px_30px_-18px_rgba(17,24,39,0.45)] backdrop-blur max-md:bottom-24 dark:bg-[#15161a]/95">
            <span className="text-[13px] text-muted">Changes in {region.name} are saved together. Every change is audited.</span>
            <Button type="submit">Save {region.name} prices</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
