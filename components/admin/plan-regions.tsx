"use client";

import { Globe } from "lucide-react";
import { Badge, Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { minorDigits } from "@/lib/region-format";
import { formatVatRate, priceWithVat, vatSentence } from "@/lib/billing/vat";
import type { PlanRegionOption } from "@/lib/admin/regions-service";

// The plan form's "Where it is shown": a tick per region (coming-soon ones shown but disabled), the price before VAT in
// the region's currency for every ticked region except Rest of the world (whose price is the plan's own), and a live
// line per ticked region with VAT: "Rwanda: 50,000 + 9,000 VAT = 59,000 RWF". Controlled by the plan form, so nothing
// is lost when the form action finishes. The server checks the same rules (lib/admin/regions-service.ts checkPlanRegions).

export type RegionPick = { on: boolean; monthly: string; yearly: string };
export type RegionPicks = Record<string, RegionPick>;

/** Minor units -> what the admin types: 50000 RWF -> "50000", 2500 USD cents -> "25". */
export function majorOf(minor: number, currency: string): string {
  if (!minor) return "";
  return String(minor / 10 ** minorDigits(currency));
}

/** What the admin typed -> minor units, or null. */
export function minorOf(raw: string, currency: string): number | null {
  const clean = raw.replace(/[\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  return Math.round(Number(clean) * 10 ** minorDigits(currency));
}

export function initialPicks(regions: PlanRegionOption[]): RegionPicks {
  return Object.fromEntries(regions.map((r) => [r.key, { on: r.selected !== null, monthly: r.selected && !r.catchAll ? majorOf(r.selected.monthlyMinor, r.currency) : "", yearly: r.selected && !r.catchAll ? majorOf(r.selected.yearlyMinor, r.currency) : "" }]));
}

export function PlanRegionPicker({ regions, picks, onChange, planMonthlyMinor, planCurrency }: { regions: PlanRegionOption[]; picks: RegionPicks; onChange: (next: RegionPicks) => void; planMonthlyMinor: number; planCurrency: string }) {
  const set = (key: string, patch: Partial<RegionPick>) => onChange({ ...picks, [key]: { ...picks[key], ...patch } });
  const chosen = regions.filter((r) => picks[r.key]?.on);
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <input type="hidden" name="regionsForm" value="1" />
      <legend className="sr-only">Regions where the plan is shown</legend>
      <p className="text-[13px] text-muted">The plan is on the pricing page, sign-up and Billing only for visitors and companies in the ticked regions. Prices are before VAT; a region with VAT adds it on top.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {regions.map((r) => {
          const pick = picks[r.key] ?? { on: false, monthly: "", yearly: "" };
          const soon = r.status === "COMING_SOON";
          // A coming-soon region the plan is already in stays (it cannot be newly ticked); a disabled box is not posted.
          const locked = soon;
          return (
            <li key={r.key} className={cn("rounded-2xl border-2 p-3", pick.on ? "border-pulse-blue/60 bg-pulse-blue/[0.04]" : "border-line", soon && !pick.on && "opacity-70")}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
                <input type="checkbox" name={`region_${r.key}`} checked={pick.on} disabled={locked} onChange={(e) => set(r.key, { on: e.target.checked })} className="size-5" aria-describedby={`region_${r.key}_hint`} />
                {locked && pick.on && <input type="hidden" name={`region_${r.key}`} value="on" />}
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <strong>{r.name}</strong>
                  {soon && <Badge tone="violet">{pick.on ? "Coming soon: kept" : "Coming soon"}</Badge>}
                  {r.vatRateBps > 0 && <Badge tone="neutral">{r.vatLabel} {formatVatRate(r.vatRateBps)}</Badge>}
                  <span id={`region_${r.key}_hint`} className="text-[12.5px] text-muted">
                    {r.catchAll ? "Every country no live region lists. Uses the price above." : `${r.countryCount} ${r.countryCount === 1 ? "country" : "countries"} · ${r.currency}`}
                  </span>
                </span>
              </label>
              {pick.on && !r.catchAll && (
                <div className="mt-2 grid gap-3 pl-7 sm:grid-cols-2">
                  <Field label={`Per month, before ${r.vatLabel} (${r.currency})`} required>
                    <Input name={`regionMonthly_${r.key}`} inputMode="decimal" value={pick.monthly} onChange={(e) => set(r.key, { monthly: e.target.value })} readOnly={locked} required placeholder={r.currency === "RWF" ? "50000" : "25"} />
                  </Field>
                  <Field label={`Per year, before ${r.vatLabel} (${r.currency})`} required>
                    <Input name={`regionYearly_${r.key}`} inputMode="decimal" value={pick.yearly} onChange={(e) => set(r.key, { yearly: e.target.value })} readOnly={locked} required placeholder={r.currency === "RWF" ? "500000" : "250"} />
                  </Field>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {chosen.length === 0 ? (
        <p role="alert" className="rounded-2xl bg-danger-bg px-3 py-2.5 text-[13px] font-medium text-danger">Tick at least one region, or nobody sees this plan.</p>
      ) : (
        <div className="rounded-2xl bg-soft/70 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted"><Globe aria-hidden className="size-3.5" /> What clients pay a month</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
            {chosen.map((r) => {
              const currency = r.catchAll ? planCurrency : r.currency;
              const net = r.catchAll ? planMonthlyMinor : minorOf(picks[r.key]?.monthly ?? "", r.currency);
              // VAT is never added to USD prices (card, Paddle adds tax itself): lib/billing/vat.ts.
              const vat = r.vatRateBps > 0 && currency.toUpperCase() !== "USD" ? { rateBps: r.vatRateBps, label: r.vatLabel } : null;
              return (
                <li key={r.key}>
                  <strong>{r.name}:</strong> {net && net > 0 ? vatSentence(priceWithVat(net, vat, currency), currency) : <span className="text-muted">enter a price</span>}
                  {vat && net && net > 0 ? <span className="text-muted"> ({formatVatRate(vat.rateBps)})</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
