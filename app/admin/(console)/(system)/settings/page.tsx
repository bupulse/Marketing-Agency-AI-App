import Link from "next/link";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, buttonClasses, Field, Input, Select, Textarea } from "@/components/ui";
import { listAvailability } from "@/lib/admin/availability";
import { dateTime, param } from "@/lib/admin/format";
import { getSettings } from "@/lib/admin/settings";
import { previewCostSummary } from "@/lib/preview/first-post";
import { DISPLAY_CURRENCIES } from "@/lib/money/display";
import { effectiveUsdToEur } from "@/lib/money/display-server";
import { publicSiteUrl, siteUrl } from "@/lib/auth/site-url";
import { cardUsdCents, formatMinor } from "@/lib/region-format";
import { DEMO_TIME_ZONE, WEEKDAY_NAMES } from "@/lib/demo/slots";
import { googleCalendarStatus } from "@/lib/google-calendar/calendar";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { momoConfigured, mtnMomoPayDial } from "@/lib/billing/momo-shared";
import { PADDLE_SECRETS, SECRET_LABEL } from "@/lib/billing/paddle-config";
import { PADDLE_WEBHOOK_PATH, paddleStatus } from "@/lib/billing/paddle-setup";
import {
  addAvailabilityAction,
  clearPaddleSettingsAction,
  disconnectGoogleCalendarAction,
  googleCalendarIdAction,
  recomputeCardPricesAction,
  removeAvailabilityAction,
  savePaddleSettingsAction,
  refreshEurRateAction,
  saveSettingsAction,
  testGoogleCalendarAction,
  testPaddleAction,
} from "./actions";
import { savePaymentSettingsAction } from "@/app/admin/(console)/(money)/payments/actions";
import { PaddleSetUp } from "@/components/admin/paddle-setup";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [s, windows, google, momo, paddle, previewCost] = await Promise.all([getSettings(), listAvailability(), googleCalendarStatus(), getMomoSettings(), paddleStatus(), previewCostSummary()]);
  const eur = await effectiveUsdToEur(s);
  const dial = mtnMomoPayDial(momo.merchantCode);
  const example = cardUsdCents(15000, "RWF", s.usdToRwf, s.cardMarginPercent);

  return (
    <>
      <PageHeader title="Settings" description="The trial, payments (Mobile Money and card), card prices, and the demo calls new clients book. Every change is written to the audit log." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Trial" description="New clients get no trial at sign-up: they book a demo, and Start trial (Demos, or the company page) opens the dashboard for this long. The TRIAL plan's own length no longer drives sign-ups.">
          <form action={saveSettingsAction} className="flex flex-wrap items-end gap-3">
            <Field label="Trial length (days)" required>
              <Input name="trialDays" type="number" min={1} max={90} defaultValue={s.trialDays} required className="w-28" />
            </Field>
            <Button type="submit">Save</Button>
          </form>
        </Panel>

        <Panel title="Loading animation" description="Shown on the whole site (public pages, client dashboard and admin) while a page loads. Visitors see a change within a minute.">
          <form action={saveSettingsAction} className="flex flex-wrap items-end gap-3">
            <Field label="Animation" required>
              <Select name="pageLoader" defaultValue={s.pageLoader} className="w-72">
                <option value="bar">Bar across the top (left to right)</option>
                <option value="preloader">BuPulse preloader (logo with a spinning ring)</option>
                <option value="off">Off</option>
              </Select>
            </Field>
            <Button type="submit">Save</Button>
          </form>
        </Panel>

        <Panel title="Card prices" description="Plans priced in RWF are charged in US dollars when paid by card. Card price = RWF ÷ rate + margin, rounded up to whole dollars.">
          <form action={saveSettingsAction} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="RWF per USD" required>
                <Input name="usdToRwf" type="number" min={100} max={100000} step="0.01" defaultValue={s.usdToRwf} required className="w-32" />
              </Field>
              <Field label="Card margin (%)" required hint="Covers Paddle's fee and rate changes.">
                <Input name="cardMarginPercent" type="number" min={0} max={100} step="0.1" defaultValue={s.cardMarginPercent} required className="w-28" />
              </Field>
              <Button type="submit">Save</Button>
            </div>
            <p className="text-[13px] text-muted">
              Example: 15,000 RWF → {formatMinor(example, "USD")} by card. Saving does not change existing card prices; use the button below, then review them in{" "}
              <Link href="/admin/settings/regions" className="underline">Regions and prices</Link>.
            </p>
          </form>
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
        </Panel>
      </div>

      <div id="currency">
        <Panel title="Admin currency" description="The currency every money figure in the admin is shown in, unless you pick another with the RWF | USD | EUR switch at the top (remembered per browser). Converted figures show ≈; hover them for the original amount.">
          <form action={saveSettingsAction} className="flex flex-col gap-3">
            <input type="hidden" name="currencyPanel" value="1" />
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Default currency" required>
                <Select name="displayCurrency" defaultValue={s.displayCurrency} className="w-32">
                  {DISPLAY_CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="EUR per USD" required hint={`RWF per USD is the Card prices rate (${s.usdToRwf}).`}>
                <Input name="usdToEur" type="number" min={0.1} max={10} step="0.0001" defaultValue={s.usdToEur} required className="w-32" />
              </Field>
              <label className="flex min-h-11 items-center gap-2 text-[15px]">
                <input type="checkbox" name="eurRateAuto" defaultChecked={s.eurRateAuto} className="size-5" />
                Refresh the EUR rate daily (ECB, free)
              </label>
              <Button type="submit">Save</Button>
            </div>
            <p className="text-[13px] text-muted">
              In use: 1 USD = {eur.rate} EUR ({eur.source === "ecb" ? `ECB rate fetched ${eur.fetchedAt ? dateTime(new Date(eur.fetchedAt)) : ""}` : "the rate above"}). The daily refresh uses api.frankfurter.app; when it fails, the rate above stays in use. Payments and bills keep the rate stored with them.
            </p>
          </form>
          <form action={refreshEurRateAction}>
            <Button type="submit" variant="outline">Refresh EUR rate now</Button>
          </form>
        </Panel>
      </div>

      <div id="momo">
        <Panel
          title="Payments: Mobile Money"
          description="Where clients pay by MTN MoMo or Airtel Money. Shown on the pay screen, the invoices and the reminder emails. Every change is audited and every admin address is told. Clients' payments are checked and confirmed on the Payments page."
          action={momoConfigured(momo) ? <Badge tone="success">Offered to clients</Badge> : <Badge tone="neutral">Not set up</Badge>}
        >
          <form action={savePaymentSettingsAction} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="MTN MoMo Pay merchant code" hint={dial ? <>Clients dial <span className="font-mono font-semibold">{dial}</span> on their MTN line (tap to call on a phone).</> : "From MTN, e.g. 002450. Clients then dial *182*8*1*<code># on their MTN line."}>
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
              <Link href="/admin/payments" className="text-sm underline">Payments to check</Link>
            </div>
          </form>
        </Panel>
      </div>

      <div id="paddle">
        <Panel
          title="Card payments (Paddle)"
          description="Connect Paddle here instead of editing environment variables. Saved values are encrypted and never shown again (only their last 4 characters). A value saved here wins over the PADDLE_* environment variable; a value not saved here falls back to it. Card is offered to clients automatically once this is ready."
          action={paddle.ready ? <Badge tone="success">Ready</Badge> : <Badge tone="neutral">Not set up</Badge>}
        >
          <p role="status" className={paddle.ready ? notice.ok : notice.bad}>{paddle.line}</p>
          <ul className="flex flex-col gap-1 text-[13px] text-muted">
            <li>Environment: <strong>{paddle.environment === "production" ? "live" : "sandbox"}</strong> ({paddle.config.source.environment === "settings" ? "saved here" : "PADDLE_ENVIRONMENT or default"})</li>
            {PADDLE_SECRETS.map((n) => (
              <li key={n}>
                {SECRET_LABEL[n]}: {paddle.config.last4[n] ? <>…<span className="font-mono">{paddle.config.last4[n]}</span> ({paddle.config.source[n] === "settings" ? "saved here" : "environment variable"})</> : "not set"}
              </li>
            ))}
            {paddle.regions.map((r) => (
              <li key={r.key}>{r.name}: {r.priced} of {r.total} {r.total === 1 ? "plan" : "plans"} with a card price</li>
            ))}
          </ul>
          <form action={savePaddleSettingsAction} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Environment" hint="Sandbox and live are separate Paddle accounts with their own keys.">
                <Select name="environment" defaultValue={paddle.environment}>
                  <option value="sandbox">Sandbox (testing)</option>
                  <option value="production">Live</option>
                </Select>
              </Field>
              {PADDLE_SECRETS.map((n) => (
                <Field key={n} label={SECRET_LABEL[n]} hint={paddle.config.last4[n] ? `Leave empty to keep the one ending ${paddle.config.last4[n]}.` : n === "webhookSecret" ? "Set up prices fills this in for you." : n === "apiKey" ? "Paddle > Developer tools > Authentication (pdl_…)." : "Paddle > Developer tools > Authentication (test_… or live_…)."}>
                  <Input name={n} type="password" autoComplete="off" spellCheck={false} maxLength={300} />
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit">Save</Button>
              <Button type="submit" variant="outline" formAction={testPaddleAction} formNoValidate>Test connection</Button>
            </div>
            <p className="text-[13px] text-muted">Test connection uses the API key typed above (with the environment chosen), or the saved one; it only reads from Paddle.</p>
          </form>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <PaddleSetUp
              description={`Creates in Paddle ${paddle.environment === "production" ? "live" : "sandbox"} what is missing: a product and monthly and yearly prices for every plan, the card prices of Rwanda and the other regions, and the notification destination ${publicSiteUrl()}${PADDLE_WEBHOOK_PATH} with every event BuPulse handles (its secret is saved here). It runs in short steps; running it again reuses what exists.`}
            />
            <ConfirmButton action={clearPaddleSettingsAction} fields={{}} label="Remove saved values" title="Remove the saved Paddle values?" description="Card payments then use the PADDLE_* environment variables, if they are set; otherwise card shows as coming soon to clients." confirmLabel="Remove" />
          </div>
        </Panel>
      </div>

      <div id="goal">
        <Panel title="Revenue goal" description="The monthly income the goal tracker on Revenue and profit measures against, and the launch month it counts months from (docs/bizdev/PLAN.md).">
          <form action={saveSettingsAction} className="flex flex-wrap items-end gap-3">
            <Field label="Goal, RWF a month" required>
              <Input name="revenueGoalRwf" type="number" min={0} step={100000} defaultValue={s.revenueGoalRwf} required className="w-44" />
            </Field>
            <Field label="Launch month (month 1)" required hint="Year and month, for example 2026-11.">
              <Input name="goalStartMonth" pattern={"\\d{4}-\\d{2}"} defaultValue={s.goalStartMonth} required className="w-32" />
            </Field>
            <Button type="submit">Save</Button>
          </form>
        </Panel>
      </div>

      <div id="first-post-preview">
        <Panel
          title="Free first-post preview"
          description="While a company waits for its demo, its owner can ask BuPulse for one post about the business (caption, hashtags and a headline) on the demo screen. One per company, a failed one may be tried once more. Off until you switch it on, because every preview is a paid AI call."
          action={s.firstPostPreview ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
        >
          <form action={saveSettingsAction} className="flex flex-col gap-3">
            <input type="hidden" name="previewPanel" value="1" />
            <label className="flex min-h-11 items-center gap-2 text-[15px]">
              <input type="checkbox" name="firstPostPreview" defaultChecked={s.firstPostPreview} className="size-5" />
              Offer the free first-post preview to companies waiting for their demo
            </label>
            <p className="text-[13px] text-muted">
              Cost per sign-up that uses it: about {previewCost.estimateUsd === null ? "an unknown amount" : `$${previewCost.estimateUsd.toFixed(3)}`} (one {previewCost.model} call of about 2,500 tokens in and 900 out, at the prices in lib/ai/pricing.ts), at most twice that when a first try fails.
              {previewCost.made > 0 && previewCost.averageUsd !== null ? ` Real average so far: $${previewCost.averageUsd.toFixed(4)} over ${previewCost.made} ${previewCost.made === 1 ? "call" : "calls"}.` : " No preview made yet."}
              {" "}It counts in the AI monthly cap and the company allowance like every AI call.
            </p>
            <div>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Panel>
      </div>

      <Panel title="Demo calls" description={`What clients see when they book: the meeting link in every invite, the call length, the gap kept between calls, and days with no calls. Times are ${DEMO_TIME_ZONE.replace("_", " ")}.`}>
        <form action={saveSettingsAction} className="flex flex-col gap-4">
          <Field label="Meeting link" hint="Your reusable Google Meet (or other) link, sent with every invite while Google Calendar (below) is not connected, or if it fails. Optional until you have one.">
            <Input name="meetingLink" type="url" placeholder="https://meet.google.com/abc-defg-hij" defaultValue={s.meetingLink} />
          </Field>
          <Field label="Invite organizer email" required hint="The organizer on the calendar invites clients receive. The admin addresses are never shown to clients.">
            <Input name="organizerEmail" type="email" defaultValue={s.organizerEmail} required className="max-w-sm" />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Call length (minutes)" required>
              <Input name="slotMinutes" type="number" min={15} max={120} step={5} defaultValue={s.slotMinutes} required className="w-28" />
            </Field>
            <Field label="Buffer between calls (minutes)" required>
              <Input name="bufferMinutes" type="number" min={0} max={120} defaultValue={s.bufferMinutes} required className="w-28" />
            </Field>
            <Field label="New bookings per day" required hint="All companies together. Reschedules do not count.">
              <Input name="demoDailyCap" type="number" min={1} max={200} defaultValue={s.demoDailyCap} required className="w-28" />
            </Field>
          </div>
          <Field label="Blocked dates" hint="One per line, YYYY-MM-DD: holidays, travel. No slots are offered on these days.">
            <Textarea name="blockedDates" rows={3} defaultValue={s.blockedDates.join("\n")} placeholder="2026-12-25" />
          </Field>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Panel>

      <div id="google-calendar">
        <Panel
          title="Google Calendar"
          description="Connect the calendar you take demos in: busy times there are taken out of the slots clients see, and every booking becomes an event with its own Google Meet link and Google's invite to the client. Without it, bookings use the meeting link above and .ics invites."
          action={google.needsReconnect ? <Badge tone="danger">Reconnect needed</Badge> : google.connected ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
        >
          {!google.configured ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">Not set up yet. Once, in Google Cloud and Cloudflare (full steps in docs/GOOGLE_CALENDAR.md):</p>
              <ol className="ml-5 list-decimal space-y-1 text-muted">
                <li>Google Cloud project bupulse-511410: enable the Google Calendar API.</li>
                <li>OAuth consent screen: Internal (the bupulse.com Workspace).</li>
                <li>Credentials: create an OAuth client of type Web application with the redirect URI below.</li>
                <li>Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET on the Worker, deploy, then come back here and connect.</li>
              </ol>
              <p className="text-[13px] text-muted">
                Redirect URI: <code className="break-all">{`${siteUrl()}/api/admin/google-calendar/callback`}</code>
              </p>
            </div>
          ) : !google.connected ? (
            <div className="flex flex-col gap-2">
              <div>
                <a href="/api/admin/google-calendar/connect" className={buttonClasses({})}>
                  Connect Google Calendar
                </a>
              </div>
              <p className="text-[13px] text-muted">Sign in with the bupulse.com account whose calendar you use for demos, and allow both calendar permissions.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm">
                Connected as <strong>{google.email ?? "an unknown account"}</strong>
                {google.connectedAt ? <span className="text-muted"> since {dateTime(google.connectedAt)}</span> : null}.
              </p>
              {google.needsReconnect && (
                <div role="alert" className={`${notice.bad} flex flex-wrap items-center gap-3`}>
                  <span>Google no longer accepts the saved login (access revoked or expired). Until you reconnect, BuPulse does not call Google: slots use your availability, bookings use the meeting link and .ics invites, and calendar changes wait (Demos shows them).</span>
                  <a href="/api/admin/google-calendar/connect" className={buttonClasses({ size: "sm" })}>Reconnect Google Calendar</a>
                </div>
              )}
              {google.lastError && !google.needsReconnect && (
                <p role="alert" className={notice.bad}>
                  Last problem{google.lastErrorAt ? ` (${dateTime(google.lastErrorAt)})` : ""}: {google.lastError} Bookings fall back to the meeting link and .ics invites until it works again; Test shows whether it does.
                </p>
              )}
              <form action={googleCalendarIdAction} className="flex flex-wrap items-end gap-3">
                <Field label="Calendar" hint={`"primary" is the account's main calendar; or paste a calendar id from Google Calendar → Settings → Integrate calendar.`}>
                  <Input name="calendarId" defaultValue={google.calendarId} required className="max-w-sm" />
                </Field>
                <Button type="submit" variant="outline">Save</Button>
              </form>
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <form action={testGoogleCalendarAction}>
                  <Button type="submit" size="sm">Test</Button>
                </form>
                <a href="/api/admin/google-calendar/connect" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                  Reconnect
                </a>
                <ConfirmButton
                  action={disconnectGoogleCalendarAction}
                  fields={{}}
                  label="Disconnect"
                  title="Disconnect Google Calendar?"
                  description="BuPulse revokes its access at Google and forgets the login. Events already made stay in the calendar; new bookings use the meeting link above and .ics invites, and reschedules or cancels no longer update the Google events. Written to the audit log."
                  confirmLabel="Disconnect"
                />
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div id="availability">
        <Panel title="Availability" description={`When clients can book you, week after week (${DEMO_TIME_ZONE.replace("_", " ")}). Slots are cut from these windows.`}>
          {windows.length === 0 ? (
            <Empty>No windows: nobody can book a demo. Add at least one below.</Empty>
          ) : (
            <TableWrap caption="Weekly availability">
              <thead><tr><Th>Day</Th><Th>From</Th><Th>To</Th><Th>Actions</Th></tr></thead>
              <tbody>
                {windows.map((w) => (
                  <tr key={w.id}>
                    <Td>{w.weekdayName}</Td>
                    <Td>{w.start}</Td>
                    <Td>{w.end}</Td>
                    <Td>
                      <form action={removeAvailabilityAction}>
                        <input type="hidden" name="id" value={w.id} />
                        <Button type="submit" size="sm" variant="outline">Remove</Button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <form action={addAvailabilityAction} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <Field label="Day" required>
              <Select name="weekday" defaultValue="1" aria-label="Day">
                {WEEKDAY_NAMES.map((name, i) => (
                  <option key={name} value={i}>{name}</option>
                ))}
              </Select>
            </Field>
            <Field label="From" required>
              <Input name="start" type="time" defaultValue="09:00" required className="w-32" />
            </Field>
            <Field label="To" required>
              <Input name="end" type="time" defaultValue="17:00" required className="w-32" />
            </Field>
            <Button type="submit" variant="outline">Add window</Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
