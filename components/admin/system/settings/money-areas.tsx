import Link from "next/link";
import { ArrowLeftRight, CreditCard, FlaskConical, Percent, Rocket, Smartphone, Target } from "lucide-react";
import { adminVatPreview, type VatSettings } from "@/lib/billing/vat";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { ExpandCard, StatusPill } from "@/components/admin/kit";
import { RadioChips, SwitchRow } from "@/components/admin/kit/form-choices";
import { Panel, notice } from "@/components/admin/ui";
import { PaddleSetUp } from "@/components/admin/paddle-setup";
import { Button, Field, Input } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { MomoSettings } from "@/lib/billing/momo-shared";
import { PADDLE_SECRETS, SECRET_LABEL } from "@/lib/billing/paddle-config";
import type { PaddleStatus } from "@/lib/billing/paddle-setup";
import { DISPLAY_CURRENCIES } from "@/lib/money/display";
import { formatMinor } from "@/lib/region-format";
import { savePaymentSettingsAction } from "@/app/admin/(console)/(money)/payments/actions";
import { clearPaddleSettingsAction, recomputeCardPricesAction, refreshEurRateAction, savePaddleSettingsAction, saveSettingsAction, testPaddleAction } from "@/app/admin/(console)/(system)/settings/actions";
import { AreaFrame } from "./area-frame";
import { SETTINGS_TITLE } from "../settings-areas";

type Msg = { ok?: string; bad?: string };

/** /admin/settings/momo: where clients pay by MTN MoMo or Airtel Money. */
export function MomoArea({ momo, dial, ready, ok, bad }: Msg & { momo: MomoSettings; dial: string | null; ready: boolean }) {
  return (
    <AreaFrame icon={Smartphone} tone="green" title={SETTINGS_TITLE.momo} description="Where clients pay you by MTN MoMo or Airtel Money. They see it on the pay screen, the invoices and the reminder emails." ok={ok} bad={bad}>
      <Panel
        id="momo"
        title="Your Mobile Money details"
        description="Fill in at least the MoMo Pay code or a number. Every change is audited and every admin address is told."
        action={ready ? <StatusPill tone="good" dot>Offered to clients</StatusPill> : <StatusPill tone="warn" dot>Not set up</StatusPill>}
      >
        <form action={savePaymentSettingsAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="MTN MoMo Pay merchant code" hint={dial ? <>Clients dial <span className="font-mono font-semibold">{dial}</span> on their MTN line.</> : "From MTN, for example 002450."}>
              <Input name="merchantCode" defaultValue={momo.merchantCode} maxLength={20} inputMode="numeric" placeholder="002450" />
            </Field>
            <Field label="MTN MoMo number" hint="Optional, shown beside the code.">
              <Input name="momoNumber" defaultValue={momo.momoNumber} maxLength={30} inputMode="tel" />
            </Field>
            <Field label="Account name" hint="The name clients see on their phone when they pay.">
              <Input name="accountName" defaultValue={momo.accountName} maxLength={80} />
            </Field>
            <Field label="Airtel Money number" hint="Clients on Airtel get the steps for this number.">
              <Input name="airtelNumber" defaultValue={momo.airtelNumber} maxLength={30} inputMode="tel" />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Save Mobile Money details</Button>
            <Link href="/admin/payments" className="text-sm font-semibold underline">Payments to check</Link>
          </div>
        </form>
      </Panel>
    </AreaFrame>
  );
}

/** /admin/settings/paddle: connect Paddle (card payments) without editing environment variables. */
export function PaddleArea({ paddle, webhookUrl, ok, bad }: Msg & { paddle: Pick<PaddleStatus, "ready" | "line" | "environment" | "config" | "regions">; webhookUrl: string }) {
  const live = paddle.environment === "production";
  return (
    <AreaFrame icon={CreditCard} tone="green" title={SETTINGS_TITLE.paddle} description="Connect Paddle so clients can pay by card. Card is offered to clients by itself once this is ready." ok={ok} bad={bad}>
      <Panel id="paddle" title={paddle.ready ? "Card payments are ready" : "Card payments are not ready yet"} description={paddle.line} action={paddle.ready ? <StatusPill tone="good" dot>Ready</StatusPill> : <StatusPill tone="warn" dot>Not set up</StatusPill>}>
        <ul className="grid gap-2 text-[14px] sm:grid-cols-2">
          <li className="rounded-2xl bg-soft px-4 py-3">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Account</span>
            <strong>{live ? "Live" : "Sandbox (testing)"}</strong> <span className="text-muted">({paddle.config.source.environment === "settings" ? "saved here" : "from the environment"})</span>
          </li>
          {PADDLE_SECRETS.map((n) => (
            <li key={n} className="rounded-2xl bg-soft px-4 py-3">
              <span className="block text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{SECRET_LABEL[n]}</span>
              {paddle.config.last4[n] ? (
                <>
                  <span className="font-mono">…{paddle.config.last4[n]}</span> <span className="text-muted">({paddle.config.source[n] === "settings" ? "saved here" : "environment variable"})</span>
                </>
              ) : (
                <span className="text-muted">Not set</span>
              )}
            </li>
          ))}
          {paddle.regions.map((r) => (
            <li key={r.key} className="rounded-2xl bg-soft px-4 py-3">
              <span className="block text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{r.name}</span>
              {r.priced} of {r.total} {r.total === 1 ? "plan has" : "plans have"} a card price
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Keys" description="Saved encrypted and never shown again (only the last 4 characters). A key saved here wins over the PADDLE_* environment variable.">
        <form action={savePaddleSettingsAction} className="flex flex-col gap-4">
          <RadioChips
            name="environment"
            legend="Which Paddle account"
            tiles
            defaultValue={paddle.environment}
            options={[
              { value: "sandbox", label: "Sandbox", hint: "For testing: no real money moves.", icon: FlaskConical, tone: "violet" },
              { value: "production", label: "Live", hint: "Real card payments from clients.", icon: Rocket, tone: "green" },
            ]}
            hint="Sandbox and live are separate Paddle accounts with their own keys."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            {PADDLE_SECRETS.map((n) => (
              <Field key={n} label={SECRET_LABEL[n]} hint={paddle.config.last4[n] ? `Leave empty to keep the one ending ${paddle.config.last4[n]}.` : n === "webhookSecret" ? "Set up prices fills this in for you." : n === "apiKey" ? "Paddle > Developer tools > Authentication (pdl_…)." : "Paddle > Developer tools > Authentication (test_… or live_…)."}>
                <Input name={n} type="password" autoComplete="off" spellCheck={false} maxLength={300} />
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Save</Button>
            <Button type="submit" variant="outline" formAction={testPaddleAction} formNoValidate>
              Test connection
            </Button>
          </div>
          <p className="text-[13px] text-muted">Test connection uses the API key typed above (with the account chosen), or the saved one. It only reads from Paddle.</p>
        </form>
      </Panel>

      <Panel title="Set up prices" description={`Creates in Paddle ${live ? "live" : "sandbox"} whatever is missing, in short steps. Running it again reuses what exists.`}>
        <div className="flex flex-wrap items-center gap-3">
          <PaddleSetUp description={`Creates in Paddle ${live ? "live" : "sandbox"} what is missing: a product and monthly and yearly prices for every plan, the card prices of Rwanda and the other regions, and the notification destination ${webhookUrl} with every event BuPulse handles (its secret is saved here). It runs in short steps; running it again reuses what exists.`} />
          <ConfirmButton action={clearPaddleSettingsAction} fields={{}} label="Remove saved values" title="Remove the saved Paddle values?" description="Card payments then use the PADDLE_* environment variables, if they are set; otherwise card shows as coming soon to clients." confirmLabel="Remove" />
        </div>
      </Panel>
    </AreaFrame>
  );
}

/** /admin/settings/currency: card prices (RWF rate and margin) and the admin's display currency. */
export function CurrencyArea({
  s,
  exampleCents,
  eur,
  ok,
  bad,
}: Msg & {
  s: { usdToRwf: number; cardMarginPercent: number; displayCurrency: string; usdToEur: number; eurRateAuto: boolean };
  exampleCents: number;
  eur: { rate: number; source: "ecb" | "settings"; fetchedAt: string | null };
}) {
  return (
    <AreaFrame icon={ArrowLeftRight} tone="green" title={SETTINGS_TITLE.currency} description="Plans priced in RWF are charged in US dollars by card. Set the rate and margin here, and the currency the admin shows money in." ok={ok} bad={bad}>
      <Panel id="card-prices" title="Card prices" description="Card price = RWF ÷ rate + margin, rounded up to whole dollars.">
        <form action={saveSettingsAction} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="RWF per US dollar" required>
              <Input name="usdToRwf" type="number" min={100} max={100000} step="0.01" defaultValue={s.usdToRwf} required className="w-36" />
            </Field>
            <Field label="Card margin (%)" required hint="Covers Paddle's fee and rate changes.">
              <Input name="cardMarginPercent" type="number" min={0} max={100} step="0.1" defaultValue={s.cardMarginPercent} required className="w-28" />
            </Field>
            <Button type="submit">Save</Button>
          </div>
          <p className="rounded-2xl bg-soft px-4 py-3 text-[14px]">
            Example: <strong>15,000 RWF</strong> → <strong>{formatMinor(exampleCents, "USD")}</strong> by card.
          </p>
        </form>
        <ExpandCard title="Saved a new rate? Update the card prices" summary="Saving does not change the card prices plans already have.">
          <div className="flex flex-col gap-3 text-[14px]">
            <p className="text-muted">
              This gives every RWF (or other local-currency) plan a new card price from the rate and margin above. Then review them in <Link href="/admin/settings/regions" className="underline">Regions and prices</Link>.
            </p>
            <div>
              <ConfirmButton
                action={recomputeCardPricesAction}
                fields={{}}
                label="Update card prices"
                title="Recompute every card price?"
                description="Every RWF (or other local-currency) plan gets a new card price from the rate and margin above. Paddle prices are not created or changed here yet (docs/REGIONS.md), so card checkout for those plans waits for the sync. Written to the audit log."
                confirmLabel="Update card prices"
              />
            </div>
          </div>
        </ExpandCard>
      </Panel>

      <Panel id="admin-currency" title="Admin currency" description="Every money figure in the admin shows in this currency, unless you pick another with the RWF | USD | EUR switch at the top (remembered per browser).">
        <form action={saveSettingsAction} className="flex flex-col gap-4">
          <input type="hidden" name="currencyPanel" value="1" />
          <RadioChips name="displayCurrency" legend="Show money in" required defaultValue={s.displayCurrency} options={DISPLAY_CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <Field label="EUR per US dollar" required hint={`RWF per US dollar is the card prices rate (${s.usdToRwf}).`}>
            <Input name="usdToEur" type="number" min={0.1} max={10} step="0.0001" defaultValue={s.usdToEur} required className="w-36" />
          </Field>
          <SwitchRow name="eurRateAuto" defaultChecked={s.eurRateAuto} label="Refresh the EUR rate every day" hint="From the European Central Bank, free. When it fails, the rate above stays in use." />
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[13px] text-muted">
            In use now: <strong className="text-text">1 USD = {eur.rate} EUR</strong> ({eur.source === "ecb" ? `ECB rate fetched ${eur.fetchedAt ? dateTime(new Date(eur.fetchedAt)) : ""}` : "the rate above"}). Payments and bills keep the rate stored with them.
          </p>
          <form action={refreshEurRateAction}>
            <Button type="submit" size="sm" variant="outline">Refresh EUR rate now</Button>
          </form>
        </div>
      </Panel>
    </AreaFrame>
  );
}

/** /admin/settings/vat: VAT on Rwandan (RWF) prices: on or off, the rate, and BuPulse's TIN. */
export function VatArea({ vat, ok, bad }: Msg & { vat: VatSettings }) {
  const examples = [15_000, 50_000, 80_000];
  return (
    <AreaFrame icon={Percent} tone="green" title={SETTINGS_TITLE.vat} description="VAT is added to prices in RWF only (Rwanda, paid by Mobile Money or invoice). Card prices in US dollars never get it: Paddle adds tax itself." ok={ok} bad={bad}>
      {!vat.tin && (
        <p className={notice.warn} role="status">
          <strong>Your TIN is missing.</strong> Receipts and invoices still work, but they cannot show BuPulse&apos;s TIN until you add it below.
        </p>
      )}
      <Panel id="vat" title="VAT on RWF prices" description="The prices you type in the admin are before VAT. Clients see and pay the price with VAT, rounded to the nearest 100 RWF." action={vat.enabled ? <StatusPill tone="good" dot>Added to RWF prices</StatusPill> : <StatusPill tone="warn" dot>Off</StatusPill>}>
        <form action={saveSettingsAction} className="flex flex-col gap-4">
          <input type="hidden" name="vatPanel" value="1" />
          <SwitchRow name="vatEnabled" defaultChecked={vat.enabled} label="Add VAT to RWF prices" hint="Off: clients pay the prices you typed, with no VAT. Use it only if BuPulse stops being VAT-registered." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="VAT rate (%)" required hint="18 in Rwanda.">
              <Input name="vatRatePercent" type="number" min={0.1} max={100} step="0.1" defaultValue={vat.ratePercent} required className="w-28" />
            </Field>
            <Field label="BuPulse TIN (from RRA)" hint="Printed on every receipt and invoice. Leave empty until you have it.">
              <Input name="vatTin" defaultValue={vat.tin} maxLength={40} placeholder="e.g. 123456789" />
            </Field>
          </div>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
        <ul className="grid gap-2 text-[14px] sm:grid-cols-3">
          {examples.map((net) => {
            const p = adminVatPreview(net, "RWF", vat);
            return (
              <li key={net} className="rounded-2xl bg-soft px-4 py-3">
                <span className="block text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">You type {formatMinor(net, "RWF")}</span>
                {p ? (
                  <>
                    Client pays <strong>{formatMinor(p.grossMinor, "RWF")}</strong> <span className="text-muted">(VAT {formatMinor(p.vatMinor, "RWF")})</span>
                  </>
                ) : (
                  <>Client pays <strong>{formatMinor(net, "RWF")}</strong> <span className="text-muted">(no VAT)</span></>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-[13px] text-muted">Receipts show the total paid, the VAT inside it and the amount before VAT. A payment already made keeps the amount it was made with.</p>
      </Panel>
    </AreaFrame>
  );
}

/** /admin/settings/goal: the monthly revenue goal and the launch month. */
export function GoalArea({ revenueGoalRwf, goalStartMonth, ok, bad }: Msg & { revenueGoalRwf: number; goalStartMonth: string }) {
  return (
    <AreaFrame icon={Target} tone="green" title={SETTINGS_TITLE.goal} description="The monthly income the goal tracker on Revenue and profit measures against." ok={ok} bad={bad}>
      <Panel id="goal" title="Your goal" description="The tracker counts months from the launch month (month 1).">
        <form action={saveSettingsAction} className="flex flex-wrap items-end gap-3">
          <Field label="Goal, RWF a month" required>
            <Input name="revenueGoalRwf" type="number" min={0} step={100000} defaultValue={revenueGoalRwf} required className="w-44" />
          </Field>
          <Field label="Launch month (month 1)" required hint="Year and month, for example 2026-11.">
            <Input name="goalStartMonth" pattern={"\\d{4}-\\d{2}"} defaultValue={goalStartMonth} required className="w-32" />
          </Field>
          <Button type="submit">Save</Button>
        </form>
        <p className={notice.info}>
          Now: <strong>{revenueGoalRwf.toLocaleString("en-US")} RWF a month</strong>, counting from {goalStartMonth}. See it on <Link href="/admin/revenue" className="underline">Revenue and profit</Link>.
        </p>
      </Panel>
    </AreaFrame>
  );
}
