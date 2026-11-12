import Link from "next/link";
import { Globe, Pencil, Plus } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { DataList, EmptyState, ExpandCard, PageHeader, StatusPill } from "@/components/admin/kit";
import { RadioChips } from "@/components/admin/kit/form-choices";
import { Panel, notice } from "@/components/admin/ui";
import { Button, Field, Input } from "@/components/ui";
import type { listRegionsAdmin } from "@/lib/admin/regions-service";
import { formatMinor, PAYMENT_METHODS, paymentMethodLabel } from "@/lib/region-format";
import { removeRegionPriceAction, saveRegionAction, setRegionPriceAction } from "@/app/admin/(console)/(system)/settings/regions/actions";
import { Notices } from "./notices";
import type { VatSettings } from "@/lib/billing/vat";
import { VatHint } from "@/components/admin/vat-hint";
import { VatPriceField } from "@/components/admin/vat-price-field";

type Data = Awaited<ReturnType<typeof listRegionsAdmin>>;
type Region = Data["regions"][number];
type Price = Region["prices"][number];

function MethodBoxes({ checked, active }: { checked: readonly string[]; active: boolean }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="mb-2 text-[14px] font-semibold">How clients pay</legend>
      {PAYMENT_METHODS.map((m) => (
        <label key={m} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-line px-3.5 text-[14px] font-semibold has-[:checked]:border-pulse-blue has-[:checked]:bg-pulse-blue/[0.07] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-pulse-blue/30">
          <input type="checkbox" name="paymentMethods" value={m} defaultChecked={checked.includes(m)} className="size-4 accent-[#2f6bff]" /> {paymentMethodLabel(m)}
        </label>
      ))}
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-line px-3.5 text-[14px] font-semibold has-[:checked]:border-pulse-blue has-[:checked]:bg-pulse-blue/[0.07] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-pulse-blue/30">
        <input type="checkbox" name="active" defaultChecked={active} className="size-4 accent-[#2f6bff]" /> Active
      </label>
    </fieldset>
  );
}

function RegionCard({ r, plans, vat }: { r: Region; plans: Data["plans"]; vat: VatSettings }) {
  const isGlobal = r.countries.length === 0;
  return (
    <Panel
      icon={Globe}
      tone="green"
      title={`${r.name} (${r.key})`}
      description={`${r.currency} · ${isGlobal ? "every country the other regions do not list" : r.countries.join(", ")} · ${r.paymentMethods.map(paymentMethodLabel).join(" and ")}`}
      action={r.active ? <StatusPill tone="good" dot>Active</StatusPill> : <StatusPill tone="muted" dot>Off</StatusPill>}
    >
      <DataList<Price>
        caption={`Prices in ${r.name}`}
        rows={r.prices}
        rowKey={(p) => p.planKey}
        rowHref={(p) => `/admin/plans/${encodeURIComponent(p.planKey)}`}
        columns={[
          { key: "plan", header: "Plan", primary: true, cell: (p) => <>{p.planName}{p.planStatus !== "active" ? <span className="ml-1 text-[12px] font-normal text-muted">({p.planStatus})</span> : null}</> },
          { key: "month", header: "A month", align: "right", cell: (p) => <>{formatMinor(p.monthlyMinor, p.currency)}{p.fromPlan ? null : <VatHint minor={p.monthlyMinor} currency={p.currency} vat={vat} />}</> },
          { key: "year", header: "A year", align: "right", cell: (p) => <>{formatMinor(p.yearlyMinor, p.currency)}{p.fromPlan ? null : <VatHint minor={p.yearlyMinor} currency={p.currency} vat={vat} />}</> },
          { key: "card", header: "By card", align: "right", cell: (p) => (p.cardMonthlyUsdCents != null ? `${formatMinor(p.cardMonthlyUsdCents, "USD")} / ${p.cardYearlyUsdCents != null ? formatMinor(p.cardYearlyUsdCents, "USD") : "-"}` : "-"), hideOnPhone: true },
          { key: "paddle", header: "Paddle", cell: (p) => (p.paddleMonthlyPriceId && p.paddleYearlyPriceId ? <StatusPill tone="good" dot>Ready</StatusPill> : <StatusPill tone="muted" dot>Not in Paddle</StatusPill>) },
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            align: "right",
            cell: (p) =>
              p.fromPlan ? (
                <span className="text-xs text-muted">From the plan builder</span>
              ) : (
                <ConfirmButton action={removeRegionPriceAction} fields={{ planKey: p.planKey, regionKey: r.key }} label="Remove" title={`Stop offering ${p.planName} in ${r.name}?`} description="New clients in this region will not see the plan. Clients already on it keep it. Written to the audit log." confirmLabel="Remove" />
              ),
          },
        ]}
        empty={<EmptyState title="No plan is offered here yet." hint={isGlobal ? undefined : "Add a price below."} />}
      />
      {isGlobal && (
        <p className="text-[13px] text-muted">
          Prices here are the plans&apos; own: change them in <Link href="/admin/plans" className="underline">Plans</Link> (price changes go through Paddle with notice). A plan priced in another region is only offered here once it has a row here too.
        </p>
      )}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {!isGlobal && (
          <ExpandCard icon={Plus} tone="green" title="Add or change a price" summary={`A plan's price in ${r.currency}.`}>
            <form action={setRegionPriceAction} className="flex flex-col gap-3">
              <input type="hidden" name="regionKey" value={r.key} />
              <input type="hidden" name="currency" value={r.currency} />
              <RadioChips name="planKey" legend="Plan" required defaultValue={plans[0]?.key} options={plans.map((p) => ({ value: p.key, label: p.name }))} />
              <div className="flex flex-wrap items-end gap-3">
                <VatPriceField label={`A month (${r.currency})`} name="monthly" currency={r.currency} vat={vat} required className="w-32" placeholder={r.currency === "RWF" ? "15000" : "25"} />
                <VatPriceField label={`A year (${r.currency})`} name="yearly" currency={r.currency} vat={vat} required className="w-32" placeholder={r.currency === "RWF" ? "150000" : "250"} />
                <Button type="submit" size="sm">Set price</Button>
              </div>
              <p className="text-xs text-muted">{r.currency === "USD" ? "The card price is the price." : `Type the price before VAT.${vat.enabled && r.currency === "RWF" ? ` Clients paying by Mobile Money pay it with ${vat.ratePercent}% VAT, rounded to 100 RWF.` : ""} The card price is computed from the price before VAT, the rate and margin (Paddle adds tax itself).`}</p>
            </form>
          </ExpandCard>
        )}
        <ExpandCard icon={Pencil} tone="slate" title="Edit region" summary="Name, currency, countries and how clients pay.">
          <form action={saveRegionAction} className="flex flex-col gap-3">
            <input type="hidden" name="key" value={r.key} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required>
                <Input name="name" defaultValue={r.name} required maxLength={60} />
              </Field>
              <Field label="Currency" required>
                <Input name="currency" defaultValue={r.currency} required maxLength={3} className="uppercase" />
              </Field>
              <Field label="Countries" hint="ISO codes, comma-separated. Empty = everywhere else.">
                <Input name="countries" defaultValue={r.countries.join(", ")} />
              </Field>
              <Field label="Order">
                <Input name="sortOrder" type="number" defaultValue={r.sortOrder} />
              </Field>
            </div>
            <MethodBoxes checked={r.paymentMethods} active={r.active} />
            <div>
              <Button type="submit" size="sm">Save region</Button>
            </div>
          </form>
        </ExpandCard>
      </div>
    </Panel>
  );
}

/** Admin -> Settings -> Regions and prices: one card per region with its prices; adding and editing fold away. */
export function RegionsView({ d, ok, bad, vat }: { d: Data; ok?: string; bad?: string; vat: VatSettings }) {
  return (
    <>
      <PageHeader icon={Globe} tone="green" title="Regions and prices" description="Where a business is decides the plans it sees, their prices and currency, and how it can pay. Billing uses the company's own region, never the visitor's location." back={{ href: "/admin/settings", label: "Settings" }} />
      <Notices ok={ok} bad={bad} />
      <p className={notice.info}>
        Card prices of local-currency plans use <strong>{d.settings.usdToRwf} RWF per USD</strong> and a <strong>{d.settings.cardMarginPercent}% margin</strong>, rounded up to whole dollars (<Link href="/admin/settings/currency" className="underline">change them</Link>). Creating those card prices in Paddle is still to do: until then card checkout in those regions says so and Mobile Money is the way (docs/REGIONS.md).
      </p>
      {d.regions.map((r) => (
        <RegionCard key={r.key} r={r} plans={d.plans} vat={vat} />
      ))}
      <ExpandCard icon={Plus} tone="green" title="New region" summary="A country with its own currency or way to pay. A country belongs to one active region.">
        <form action={saveRegionAction} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Key" required hint="Capitals, for example KE.">
              <Input name="key" required maxLength={16} className="uppercase" />
            </Field>
            <Field label="Name" required>
              <Input name="name" required maxLength={60} />
            </Field>
            <Field label="Currency" required>
              <Input name="currency" required maxLength={3} placeholder="USD" className="uppercase" />
            </Field>
            <Field label="Countries" required hint="ISO codes, comma-separated.">
              <Input name="countries" placeholder="KE, UG" />
            </Field>
            <Field label="Order">
              <Input name="sortOrder" type="number" defaultValue={50} />
            </Field>
          </div>
          <MethodBoxes checked={["card"]} active />
          <div>
            <Button type="submit">Create region</Button>
          </div>
        </form>
      </ExpandCard>
    </>
  );
}
