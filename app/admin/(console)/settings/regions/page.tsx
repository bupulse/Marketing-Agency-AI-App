import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { param } from "@/lib/admin/format";
import { listRegionsAdmin } from "@/lib/admin/regions-service";
import { formatMinor, minorDigits, PAYMENT_METHODS, paymentMethodLabel } from "@/lib/region-format";
import { removeRegionPriceAction, saveRegionAction, setRegionPriceAction } from "./actions";

export const metadata = { title: "Regions and prices" };
export const dynamic = "force-dynamic";

const major = (minor: number, currency: string) => (minor / 10 ** minorDigits(currency)).toString();

export default async function RegionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const { regions, plans, settings } = await listRegionsAdmin();

  return (
    <>
      <PageHeader
        title="Regions and prices"
        description="Where a business is decides the plans it sees, the prices and currency, and how it can pay. A plan is offered in a region only when it has a price there. Billing uses the company's own region (set from its sign-up country, changeable on the company page), never the visitor's location."
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <p className="rounded-2xl bg-soft px-4 py-3 text-sm">
        Card prices of local-currency plans use <strong>{settings.usdToRwf} RWF per USD</strong> and a <strong>{settings.cardMarginPercent}% margin</strong>, rounded up to whole dollars (change them in <Link href="/admin/settings" className="underline">Settings</Link>). Creating those card prices in Paddle (and the East Africa prices) is still to do: until then card checkout in those regions says so and Mobile Money is the way. See docs/REGIONS.md.
      </p>

      {regions.map((r) => {
        const isGlobal = r.countries.length === 0;
        return (
          <Panel
            key={r.key}
            title={`${r.name} (${r.key})`}
            description={`${r.currency} · ${isGlobal ? "every country the other regions do not list" : r.countries.join(", ")} · ${r.paymentMethods.map(paymentMethodLabel).join(" and ")}`}
            action={<Badge tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Off"}</Badge>}
          >
            {r.prices.length === 0 ? (
              <Empty>No plan is offered here yet.</Empty>
            ) : (
              <TableWrap caption={`Prices in ${r.name}`}>
                <thead>
                  <tr><Th>Plan</Th><Th right>Monthly</Th><Th right>Yearly</Th><Th right>Card monthly</Th><Th right>Card yearly</Th><Th>Paddle</Th><Th>Actions</Th></tr>
                </thead>
                <tbody>
                  {r.prices.map((p) => (
                    <tr key={p.planKey}>
                      <Td>
                        <Link href={`/admin/plans/${encodeURIComponent(p.planKey)}`} className="font-semibold underline">{p.planName}</Link>
                        <span className="block text-xs text-muted">{p.planKey}{p.planStatus !== "active" ? ` · ${p.planStatus}` : ""}</span>
                      </Td>
                      <Td right>{formatMinor(p.monthlyMinor, p.currency)}</Td>
                      <Td right>{formatMinor(p.yearlyMinor, p.currency)}</Td>
                      <Td right>{p.cardMonthlyUsdCents != null ? formatMinor(p.cardMonthlyUsdCents, "USD") : "-"}</Td>
                      <Td right>{p.cardYearlyUsdCents != null ? formatMinor(p.cardYearlyUsdCents, "USD") : "-"}</Td>
                      <Td>{p.paddleMonthlyPriceId && p.paddleYearlyPriceId ? <Badge tone="success">Ready</Badge> : <Badge tone="neutral">Not in Paddle</Badge>}</Td>
                      <Td>
                        {p.fromPlan ? (
                          <span className="text-xs text-muted">From the plan builder</span>
                        ) : (
                          <ConfirmButton action={removeRegionPriceAction} fields={{ planKey: p.planKey, regionKey: r.key }} label="Remove" title={`Stop offering ${p.planName} in ${r.name}?`} description="New clients in this region will not see the plan. Clients already on it keep it. Written to the audit log." confirmLabel="Remove" />
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}

            {!isGlobal && (
              <form action={setRegionPriceAction} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
                <input type="hidden" name="regionKey" value={r.key} />
                <input type="hidden" name="currency" value={r.currency} />
                <Field label="Plan" required>
                  <Select name="planKey" aria-label="Plan">
                    {plans.map((p) => (
                      <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Monthly (${r.currency})`} required>
                  <Input name="monthly" inputMode="decimal" required className="w-32" placeholder={r.currency === "RWF" ? "15000" : "25"} />
                </Field>
                <Field label={`Yearly (${r.currency})`} required>
                  <Input name="yearly" inputMode="decimal" required className="w-32" placeholder={r.currency === "RWF" ? "150000" : "250"} />
                </Field>
                <Button type="submit" variant="outline">Set price</Button>
                <span className="text-xs text-muted">{r.currency === "USD" ? "The card price is the price." : "The card price is computed from the rate and margin."}</span>
              </form>
            )}
            {isGlobal && <p className="text-[13px] text-muted">Prices here are the plans&apos; own: change them in <Link href="/admin/plans" className="underline">Plans</Link> (price changes go through Paddle with notice). A plan priced in another region is only offered here once it has a row here too (created by the migration for today&apos;s plans).</p>}

            <details className="border-t border-line pt-4">
              <summary className="cursor-pointer text-sm font-semibold">Edit region</summary>
              <form action={saveRegionAction} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="key" value={r.key} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Name" required><Input name="name" defaultValue={r.name} required maxLength={60} /></Field>
                  <Field label="Currency" required><Input name="currency" defaultValue={r.currency} required maxLength={3} className="uppercase" /></Field>
                  <Field label="Countries" hint="ISO codes, comma-separated. Empty = everywhere else."><Input name="countries" defaultValue={r.countries.join(", ")} /></Field>
                  <Field label="Order"><Input name="sortOrder" type="number" defaultValue={r.sortOrder} /></Field>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {PAYMENT_METHODS.map((m) => (
                    <label key={m} className="flex items-center gap-2"><input type="checkbox" name="paymentMethods" value={m} defaultChecked={r.paymentMethods.includes(m)} className="size-4" /> {paymentMethodLabel(m)}</label>
                  ))}
                  <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={r.active} className="size-4" /> Active</label>
                </div>
                <div><Button type="submit" size="sm">Save region</Button></div>
              </form>
            </details>
          </Panel>
        );
      })}

      <Panel title="New region" description="For example a country with its own currency or payment method. A country belongs to exactly one active region.">
        <form action={saveRegionAction} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Key" required hint="Capitals, e.g. KE."><Input name="key" required maxLength={16} className="uppercase" /></Field>
            <Field label="Name" required><Input name="name" required maxLength={60} /></Field>
            <Field label="Currency" required><Input name="currency" required maxLength={3} placeholder="USD" className="uppercase" /></Field>
            <Field label="Countries" required hint="ISO codes, comma-separated."><Input name="countries" placeholder="KE, UG" /></Field>
            <Field label="Order"><Input name="sortOrder" type="number" defaultValue={50} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {PAYMENT_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-2"><input type="checkbox" name="paymentMethods" value={m} defaultChecked={m === "card"} className="size-4" /> {paymentMethodLabel(m)}</label>
            ))}
            <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked className="size-4" /> Active</label>
          </div>
          <div><Button type="submit">Create region</Button></div>
        </form>
      </Panel>
    </>
  );
}
