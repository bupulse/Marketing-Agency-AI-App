import Link from "next/link";
import { ArrowDown, ArrowUp, Globe, Plus, Receipt, Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { DataList, EmptyState, ExpandCard, PageHeader, StatusPill } from "@/components/admin/kit";
import { RadioChips } from "@/components/admin/kit/form-choices";
import { Panel, notice } from "@/components/admin/ui";
import { Button, buttonClasses, Field, Input } from "@/components/ui";
import type { listRegionsAdmin } from "@/lib/admin/regions-service";
import { formatMinor, PAYMENT_METHODS, paymentMethodLabel, regionStatusLabel } from "@/lib/region-format";
import { formatVatRate } from "@/lib/vat";
import { deleteRegionAction, moveRegionAction, removeRegionPriceAction, saveRegionAction, setRegionPriceAction } from "@/app/admin/(console)/(system)/settings/regions/actions";
import { CountryPicker } from "./country-picker";
import { Notices } from "./notices";

// Admin -> Money -> Regions: the list (status, countries, plans, VAT, order) and one region's editor (name, status,
// currency, payment methods, VAT, countries with a searchable picker, its prices, delete). Plain data in.

type Data = Awaited<ReturnType<typeof listRegionsAdmin>>;
type Region = Data["regions"][number];
type Price = Region["prices"][number];

const BACK = "/admin/settings/regions";
const hrefOf = (key: string) => `${BACK}/${encodeURIComponent(key)}`;

function StatusOf({ r }: { r: Pick<Region, "active" | "countries"> }) {
  if (r.countries.length === 0) return <StatusPill tone="good" dot>Live, always</StatusPill>;
  return r.active ? <StatusPill tone="good" dot>{regionStatusLabel("LIVE")}</StatusPill> : <StatusPill tone="muted" dot>{regionStatusLabel("COMING_SOON")}</StatusPill>;
}

function MoveButtons({ r, first, last }: { r: Region; first: boolean; last: boolean }) {
  return (
    <span className="inline-flex gap-1">
      {(["up", "down"] as const).map((direction) => (
        <form key={direction} action={moveRegionAction}>
          <input type="hidden" name="key" value={r.key} />
          <input type="hidden" name="direction" value={direction} />
          <button
            type="submit"
            disabled={direction === "up" ? first : last}
            aria-label={`Move ${r.name} ${direction}`}
            className="inline-flex size-9 items-center justify-center rounded-full border border-line text-muted hover:bg-soft hover:text-text focus-visible:ring-4 focus-visible:ring-pulse-blue/30 focus-visible:outline-none disabled:opacity-35"
          >
            {direction === "up" ? <ArrowUp aria-hidden className="size-4" /> : <ArrowDown aria-hidden className="size-4" />}
          </button>
        </form>
      ))}
    </span>
  );
}

/** Admin -> Regions: every region with its status, countries, plans and VAT; open one to edit it. */
export function RegionsView({ d, ok, bad }: { d: Data; ok?: string; bad?: string }) {
  const live = d.regions.filter((r) => r.active).length;
  return (
    <>
      <PageHeader
        icon={Globe}
        tone="green"
        title="Regions"
        description="Where a visitor is decides the plans and prices they see. Live regions get their own plans; a coming-soon region is listed with its countries, and its visitors see Rest of the world until it goes live."
        back={{ href: "/admin/plans", label: "Plans and prices" }}
        actions={
          <Link href={`${BACK}/new`} className={buttonClasses({ size: "md" })}>
            <Plus aria-hidden className="size-4" /> New region
          </Link>
        }
      />
      <Notices ok={ok} bad={bad} />
      <p className={notice.info}>
        {live} live, {d.regions.length - live} coming soon. A country belongs to one region. A visitor&apos;s country (the &quot;Use my location&quot; answer, else the IP country) picks their region; a country in a coming-soon region, or in none, gets <strong>{d.regions.find((r) => r.countries.length === 0)?.name ?? "the catch-all"}</strong>. Billing uses the company&apos;s own region, set from its sign-up country.
      </p>
      <DataList<Region>
        caption="Regions"
        rows={d.regions}
        rowKey={(r) => r.key}
        rowHref={(r) => hrefOf(r.key)}
        columns={[
          { key: "name", header: "Region", primary: true, cell: (r) => <>{r.name} <span className="ml-1 font-mono text-[12px] font-normal text-muted">{r.key}</span></> },
          { key: "status", header: "Status", cell: (r) => <StatusOf r={r} /> },
          { key: "countries", header: "Countries", align: "right", cell: (r) => (r.countries.length === 0 ? <span className="text-muted">All others</span> : r.countries.length) },
          { key: "plans", header: "Plans", align: "right", cell: (r) => r.prices.length, hideOnPhone: true },
          { key: "vat", header: "VAT", align: "right", cell: (r) => (r.vatRateBps > 0 ? <StatusPill tone="warn" dot>{formatVatRate(r.vatRateBps)} on top</StatusPill> : <span className="text-muted">0% (off)</span>) },
          { key: "currency", header: "Currency", cell: (r) => r.currency, hideOnPhone: true },
          { key: "companies", header: "Companies", align: "right", cell: (r) => r.companies, hideOnPhone: true },
          { key: "order", header: <span className="sr-only">Order</span>, align: "right", cell: (r) => <MoveButtons r={r} first={r.key === d.regions[0]?.key} last={r.key === d.regions.at(-1)?.key} /> },
        ]}
        empty={<EmptyState title="No regions yet." />}
      />
    </>
  );
}

/** The region form, for a new region (`r` null) and an existing one. */
function RegionForm({ r, taken }: { r: Region | null; taken: Record<string, string> }) {
  const catchAll = r !== null && r.countries.length === 0;
  return (
    <form action={saveRegionAction} className="flex flex-col gap-4">
      {r ? <input type="hidden" name="key" value={r.key} /> : <input type="hidden" name="isNew" value="1" />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input name="name" defaultValue={r?.name ?? ""} required maxLength={60} placeholder="West Africa" />
        </Field>
        {!r && (
          <Field label="Key" hint="Optional: made from the name (WEST_AFRICA). It cannot change later.">
            <Input name="key" maxLength={16} className="uppercase" placeholder="WEST_AFRICA" />
          </Field>
        )}
        <Field label="Currency" required hint="The currency of its prices, e.g. RWF or USD.">
          <Input name="currency" defaultValue={r?.currency ?? "USD"} required maxLength={3} className="uppercase" />
        </Field>
        <Field label="VAT %" hint="0 = off: clients pay the plan prices as they are. Type 18 to add 18% VAT on top of this region's prices.">
          <Input name="vatPercent" inputMode="decimal" defaultValue={r ? String((r.vatRateBps ?? 0) / 100) : "0"} className="w-28" />
        </Field>
        <p className="rounded-2xl bg-new-bg px-3 py-2.5 text-[13px] sm:col-span-2">
          <strong>Only charge VAT once BuPulse is VAT-registered.</strong> Payments and invoices already made keep the rate they were made with.
        </p>
        <Field label="Tax name" hint="Shown on prices, invoices and receipts.">
          <Input name="vatLabel" defaultValue={r?.vatLabel ?? "VAT"} maxLength={20} className="w-28" />
        </Field>
      </div>
      {catchAll ? (
        <p className="rounded-2xl bg-soft px-3 py-2.5 text-[13px] text-muted">Always live. It has no country list: it takes every visitor no live region lists, including the countries of coming-soon regions.</p>
      ) : (
        <RadioChips
          name="status"
          legend="Status"
          defaultValue={r?.active === false ? "COMING_SOON" : r ? "LIVE" : "COMING_SOON"}
          options={[
            { value: "LIVE", label: "Live", hint: "Its visitors and sign-ups get its plans and prices." },
            { value: "COMING_SOON", label: "Coming soon", hint: "Listed, but its visitors see Rest of the world. Plans cannot be offered here yet." },
          ]}
          tiles
        />
      )}
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-2 text-[14px] font-semibold">How clients pay</legend>
        {PAYMENT_METHODS.map((m) => (
          <label key={m} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-line px-3.5 text-[14px] font-semibold has-[:checked]:border-pulse-blue has-[:checked]:bg-pulse-blue/[0.07] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-pulse-blue/30">
            <input type="checkbox" name="paymentMethods" value={m} defaultChecked={(r?.paymentMethods ?? ["card"]).includes(m)} className="size-4 accent-[#2f6bff]" /> {paymentMethodLabel(m)}
          </label>
        ))}
      </fieldset>
      {!catchAll && <CountryPicker initial={r?.countries ?? []} taken={taken} regionName={r?.name ?? "this region"} />}
      <div>
        <Button type="submit">{r ? "Save region" : "Create region"}</Button>
      </div>
    </form>
  );
}

/** Which region lists each country, except `self`: the picker says "In West Africa" and moves it on save. */
function takenBy(d: Data, self: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of d.regions) if (r.key !== self) for (const c of r.countries) out[c] = r.name;
  return out;
}

export function NewRegionView({ d, bad }: { d: Data; bad?: string }) {
  return (
    <>
      <PageHeader icon={Globe} tone="green" title="New region" description="Name it, choose its countries, then make it live when its plans and prices are ready." back={{ href: BACK, label: "Regions" }} />
      <Notices bad={bad} />
      <Panel icon={Globe} tone="green" title="Region">
        <RegionForm r={null} taken={takenBy(d, null)} />
      </Panel>
    </>
  );
}

/** One region: its settings and countries, the plans offered there with their prices, and delete. */
export function RegionEditor({ d, r, ok, bad }: { d: Data; r: Region; ok?: string; bad?: string }) {
  const catchAll = r.countries.length === 0;
  return (
    <>
      <PageHeader
        icon={Globe}
        tone="green"
        title={r.name}
        description={`${r.key} · ${catchAll ? "every country no live region lists" : `${r.countries.length} ${r.countries.length === 1 ? "country" : "countries"}`} · ${r.currency} · ${r.vatLabel} ${r.vatRateBps > 0 ? formatVatRate(r.vatRateBps) : "0% (off)"} · ${r.companies} ${r.companies === 1 ? "company" : "companies"} billed here`}
        back={{ href: BACK, label: "Regions" }}
        actions={<StatusOf r={r} />}
      />
      <Notices ok={ok} bad={bad} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel icon={Globe} tone="green" title="Region" description="Every change is written to the audit log.">
          <RegionForm r={r} taken={takenBy(d, r.key)} />
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          <RegionPrices r={r} plans={d.plans} />
          {!catchAll && (
            <ExpandCard icon={Trash2} tone="red" title="Delete region" summary="Only when no company is billed here and no plan is offered only here.">
              <ConfirmButton
                action={deleteRegionAction}
                fields={{ key: r.key }}
                label={`Delete ${r.name}`}
                title={`Delete ${r.name}?`}
                description="Its countries then see Rest of the world, and its prices are removed (plans offered elsewhere stay there). Written to the audit log."
                confirmLabel="Delete"
              />
            </ExpandCard>
          )}
        </div>
      </div>
    </>
  );
}

/** The plans offered in a region, before VAT, with the card price and Paddle state; add or change one. */
function RegionPrices({ r, plans }: { r: Region; plans: Data["plans"] }) {
  const catchAll = r.countries.length === 0;
  return (
    <Panel icon={Receipt} tone="green" title="Plans offered here" description={`Prices before ${r.vatLabel}.${r.vatRateBps > 0 ? ` Clients pay ${formatVatRate(r.vatRateBps)} ${r.vatLabel} on top.` : ""} Which regions a plan is in is also set on the plan itself.`}>
      <DataList<Price>
        caption={`Prices in ${r.name}`}
        rows={r.prices}
        rowKey={(p) => p.planKey}
        rowHref={(p) => `/admin/plans/${encodeURIComponent(p.planKey)}`}
        columns={[
          { key: "plan", header: "Plan", primary: true, cell: (p) => <>{p.planName}{p.planStatus !== "active" ? <span className="ml-1 text-[12px] font-normal text-muted">({p.planStatus})</span> : null}</> },
          { key: "month", header: "A month", align: "right", cell: (p) => formatMinor(p.monthlyMinor, p.currency) },
          { key: "year", header: "A year", align: "right", cell: (p) => formatMinor(p.yearlyMinor, p.currency), hideOnPhone: true },
          { key: "paddle", header: "Card", cell: (p) => (p.paddleMonthlyPriceId && p.paddleYearlyPriceId ? <StatusPill tone="good" dot>In Paddle</StatusPill> : <StatusPill tone="muted" dot>Not in Paddle</StatusPill>), hideOnPhone: true },
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            align: "right",
            cell: (p) =>
              p.fromPlan ? (
                <span className="text-xs text-muted">The plan&apos;s own price</span>
              ) : (
                <ConfirmButton action={removeRegionPriceAction} fields={{ planKey: p.planKey, regionKey: r.key }} label="Remove" title={`Stop offering ${p.planName} in ${r.name}?`} description="New clients in this region will not see the plan. Clients already on it keep it. Written to the audit log." confirmLabel="Remove" />
              ),
          },
        ]}
        empty={<EmptyState title="No plan is offered here yet." hint={r.active ? "Add a price below, or tick this region on a plan." : "Plans can be offered here once it is live."} />}
      />
      {catchAll && (
        <p className="text-[13px] text-muted">
          Prices here are the plans&apos; own: change them in <Link href="/admin/plans" className="underline">Plans</Link>.
        </p>
      )}
      {!catchAll && r.active && (
        <ExpandCard icon={Plus} tone="green" title="Add or change a price" summary={`A plan's price in ${r.currency}, before ${r.vatLabel}.`}>
          <form action={setRegionPriceAction} className="flex flex-col gap-3">
            <input type="hidden" name="regionKey" value={r.key} />
            <input type="hidden" name="currency" value={r.currency} />
            <RadioChips name="planKey" legend="Plan" required defaultValue={plans[0]?.key} options={plans.map((p) => ({ value: p.key, label: p.name }))} />
            <div className="flex flex-wrap items-end gap-3">
              <Field label={`A month (${r.currency})`} required>
                <Input name="monthly" inputMode="decimal" required className="w-32" placeholder={r.currency === "RWF" ? "15000" : "25"} />
              </Field>
              <Field label={`A year (${r.currency})`} required>
                <Input name="yearly" inputMode="decimal" required className="w-32" placeholder={r.currency === "RWF" ? "150000" : "250"} />
              </Field>
              <Button type="submit" size="sm">Set price</Button>
            </div>
          </form>
        </ExpandCard>
      )}
    </Panel>
  );
}
