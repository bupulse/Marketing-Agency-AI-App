import Link from "next/link";
import { BellRing, CalendarDays, Clock3, PhoneCall, Plus } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { DataList, EmptyState, ExpandCard, StatusPill } from "@/components/admin/kit";
import { RadioChips } from "@/components/admin/kit/form-choices";
import { Panel, notice } from "@/components/admin/ui";
import { Button, buttonClasses, Field, Input, Textarea } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { GoogleCalendarStatus } from "@/lib/google-calendar/calendar";
import type { TelegramStatus } from "@/lib/lead-alerts/telegram-settings";
import {
  addAvailabilityAction,
  connectTelegramAction,
  disconnectGoogleCalendarAction,
  disconnectTelegramAction,
  googleCalendarIdAction,
  removeAvailabilityAction,
  saveSettingsAction,
  testGoogleCalendarAction,
  testTelegramAction,
} from "@/app/admin/(console)/(system)/settings/actions";
import { AreaFrame, HowItWorks } from "./area-frame";
import { SETTINGS_TITLE } from "../settings-areas";

type Msg = { ok?: string; bad?: string };

/** One numbered step of a set-up, ticked when it is done. */
function Step({ n, done, children }: { n: number; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className={done ? "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-success-bg text-[13px] font-bold text-success" : "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-soft text-[13px] font-bold text-muted"}>
        {done ? "✓" : n}
      </span>
      <span className="min-w-0 pt-0.5 text-[14px] leading-snug">
        {children}
        {done && <span className="sr-only"> (done)</span>}
      </span>
    </li>
  );
}

/** /admin/settings/lead-alerts: quote requests and website chats sent to the owner's Telegram. */
export function LeadAlertsArea({ telegram, ok, bad }: Msg & { telegram: TelegramStatus }) {
  const connected = Boolean(telegram.chat && telegram.hasToken);
  return (
    <AreaFrame icon={BellRing} tone="orange" title={SETTINGS_TITLE["lead-alerts"]} description="The moment someone asks for a free quote, sends a form or starts a chat on bupulse.com, you get it on Telegram, free. The alert emails to the admin addresses always go too." ok={ok} bad={bad}>
      <Panel
        id="lead-alerts"
        icon={BellRing}
        tone="orange"
        title={!telegram.enabled ? "Telegram is switched off" : connected ? "Alerts reach your Telegram" : "Not connected yet"}
        description={telegram.chat ? `Alerts go to ${telegram.chat.name || "your Telegram chat"}${telegram.chat.connectedAt ? ` since ${dateTime(telegram.chat.connectedAt)}` : ""}.` : "No chat connected yet: alerts go by email only."}
        action={!telegram.enabled ? <StatusPill tone="muted" dot>Switched off</StatusPill> : connected ? <StatusPill tone="good" dot>Connected</StatusPill> : <StatusPill tone="warn" dot>Not connected</StatusPill>}
      >
        {telegram.chat && !telegram.hasToken && <p role="alert" className={notice.bad}>The bot token is missing in Services, so nothing is sent until it is back.</p>}
        <ol className="flex flex-col gap-3">
          <Step n={1} done={telegram.hasToken}>
            In Telegram, open <strong>@BotFather</strong>, send <code>/newbot</code> and name the bot (for example &quot;BuPulse alerts&quot;). It answers with a token like <code>123456789:AA…</code>.
          </Step>
          <Step n={2} done={telegram.hasToken}>
            Paste the token on the <Link href="/admin/services/telegram" className="font-semibold underline">Telegram service</Link> page (TELEGRAM_BOT_TOKEN), then press Test now there.
          </Step>
          <Step n={3} done={Boolean(telegram.chat)}>Open your new bot in Telegram and send it <code>/start</code> from the phone that should get the alerts.</Step>
          <Step n={4} done={Boolean(telegram.chat)}>Come back here within a few minutes and press Connect. Only a private chat is used, never a group.</Step>
        </ol>
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <form action={connectTelegramAction}>
            <Button type="submit" size="sm" disabled={!telegram.hasToken}>
              {telegram.chat ? "Connect again" : "Connect"}
            </Button>
          </form>
          {telegram.chat && (
            <>
              <form action={testTelegramAction}>
                <Button type="submit" size="sm" variant="outline" disabled={!telegram.hasToken}>
                  Send test alert
                </Button>
              </form>
              <ConfirmButton action={disconnectTelegramAction} fields={{}} label="Disconnect" title="Disconnect Telegram?" description="Lead alerts stop going to this Telegram chat; the alert emails carry on. Written to the audit log." confirmLabel="Disconnect" />
            </>
          )}
        </div>
      </Panel>
      <ExpandCard title="What an alert says" summary="Name, a tap-to-call number, WhatsApp and what they wrote.">
        <HowItWorks items={["The person's name, a tap-to-call number and a WhatsApp link.", "Their company and what they wrote.", "Telegram also pings you when a website chat is waiting for a person."]} />
      </ExpandCard>
    </AreaFrame>
  );
}

/** /admin/settings/google-calendar: the calendar demos are taken in (busy times, events with Meet links). */
export function GoogleCalendarArea({ google, redirectUri, ok, bad }: Msg & { google: GoogleCalendarStatus; redirectUri: string }) {
  const pill = google.needsReconnect ? <StatusPill tone="bad" dot>Reconnect needed</StatusPill> : google.connected ? <StatusPill tone="good" dot>Connected</StatusPill> : <StatusPill tone="muted" dot>Not connected</StatusPill>;
  return (
    <AreaFrame icon={CalendarDays} tone="orange" title={SETTINGS_TITLE["google-calendar"]} description="Connect the calendar you take calls in: busy times there come off the booking page, and every booking becomes an event with its own Google Meet link." ok={ok} bad={bad}>
      <Panel id="google-calendar" icon={CalendarDays} tone="orange" title={!google.configured ? "Not set up yet" : google.connected ? `Connected as ${google.email ?? "an unknown account"}` : "Ready to connect"} description={google.connected && google.connectedAt ? `Since ${dateTime(google.connectedAt)}.` : "Without it, bookings use the meeting link from Demo calls and .ics invites."} action={pill}>
        {!google.configured ? (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] font-medium">Once, in Google Cloud and Cloudflare (full steps in docs/GOOGLE_CALENDAR.md):</p>
            <ol className="flex flex-col gap-3">
              <Step n={1}>Google Cloud project bupulse-511410: enable the Google Calendar API.</Step>
              <Step n={2}>OAuth consent screen: Internal (the bupulse.com Workspace).</Step>
              <Step n={3}>Credentials: create an OAuth client of type Web application with the redirect address below.</Step>
              <Step n={4}>Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET on the Worker, deploy, then come back here and connect.</Step>
            </ol>
            <p className="rounded-2xl bg-soft px-4 py-3 text-[13px] text-muted">
              Redirect address: <code className="break-all text-text">{redirectUri}</code>
            </p>
          </div>
        ) : !google.connected ? (
          <div className="flex flex-col gap-2">
            <div>
              <a href="/api/admin/google-calendar/connect" className={buttonClasses({})}>
                Connect Google Calendar
              </a>
            </div>
            <p className="text-[13px] text-muted">Sign in with the bupulse.com account whose calendar you use for calls, and allow both calendar permissions.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {google.needsReconnect && (
              <div role="alert" className={`${notice.bad} flex flex-wrap items-center gap-3`}>
                <span>Google no longer accepts the saved login (access revoked or expired). Until you reconnect, slots use your availability, bookings use the meeting link and .ics invites, and calendar changes wait (Demos shows them).</span>
                <a href="/api/admin/google-calendar/connect" className={buttonClasses({ size: "sm" })}>
                  Reconnect Google Calendar
                </a>
              </div>
            )}
            {google.lastError && !google.needsReconnect && (
              <p role="alert" className={notice.bad}>
                Last problem{google.lastErrorAt ? ` (${dateTime(google.lastErrorAt)})` : ""}: {google.lastError} Bookings fall back to the meeting link and .ics invites until it works again; Test shows whether it does.
              </p>
            )}
            <form action={googleCalendarIdAction} className="flex flex-wrap items-end gap-3">
              <Field label="Calendar" hint={`"primary" is the account's main calendar; or paste a calendar id from Google Calendar → Settings → Integrate calendar.`} className="min-w-0 flex-1">
                <Input name="calendarId" defaultValue={google.calendarId} required className="max-w-sm" />
              </Field>
              <Button type="submit" variant="outline">Save</Button>
            </form>
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <form action={testGoogleCalendarAction}>
                <Button type="submit" size="sm">Test</Button>
              </form>
              <a href="/api/admin/google-calendar/connect" className={buttonClasses({ variant: "outline", size: "sm" })}>
                Reconnect
              </a>
              <ConfirmButton
                action={disconnectGoogleCalendarAction}
                fields={{}}
                label="Disconnect"
                title="Disconnect Google Calendar?"
                description="BuPulse revokes its access at Google and forgets the login. Events already made stay in the calendar; new bookings use the meeting link and .ics invites, and reschedules or cancels no longer update the Google events. Written to the audit log."
                confirmLabel="Disconnect"
              />
            </div>
          </div>
        )}
      </Panel>
    </AreaFrame>
  );
}

/** /admin/settings/calls: what clients see when they book a call. */
export function CallsArea({ s, timeZone, ok, bad }: Msg & { s: { meetingLink: string; organizerEmail: string; slotMinutes: number; bufferMinutes: number; demoDailyCap: number; blockedDates: string[] }; timeZone: string }) {
  return (
    <AreaFrame icon={PhoneCall} tone="orange" title={SETTINGS_TITLE.calls} description={`What clients see when they book a call with you (custom plan calls, and demos still on the books). Times are ${timeZone}.`} ok={ok} bad={bad}>
      <form action={saveSettingsAction} className="flex flex-col gap-5">
        <Panel title="The invite" description="What every calendar invite carries.">
          <Field label="Meeting link" hint="Your reusable Google Meet (or other) link, used while Google Calendar is not connected, or if it fails. Optional until you have one.">
            <Input name="meetingLink" type="url" placeholder="https://meet.google.com/abc-defg-hij" defaultValue={s.meetingLink} />
          </Field>
          <Field label="Invite organizer email" required hint="The organizer on the invites clients receive. The admin addresses are never shown to clients.">
            <Input name="organizerEmail" type="email" defaultValue={s.organizerEmail} required className="max-w-sm" />
          </Field>
        </Panel>
        <Panel title="Length and limits" description="How long a call is, the gap you keep between calls, and how many new bookings a day.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Call length (minutes)" required>
              <Input name="slotMinutes" type="number" min={15} max={120} step={5} defaultValue={s.slotMinutes} required />
            </Field>
            <Field label="Gap between calls (minutes)" required>
              <Input name="bufferMinutes" type="number" min={0} max={120} defaultValue={s.bufferMinutes} required />
            </Field>
            <Field label="New bookings per day" required hint="All companies together. Reschedules do not count.">
              <Input name="demoDailyCap" type="number" min={1} max={200} defaultValue={s.demoDailyCap} required />
            </Field>
          </div>
        </Panel>
        <Panel title="Days off" description="Holidays, travel: no slots are offered on these days.">
          <Field label="Blocked dates" hint="One per line, YYYY-MM-DD.">
            <Textarea name="blockedDates" rows={3} defaultValue={s.blockedDates.join("\n")} placeholder="2026-12-25" />
          </Field>
        </Panel>
        <div>
          <Button type="submit">Save</Button>
        </div>
      </form>
      <p className="px-1 text-[13px] text-muted">
        Your weekly hours are on <Link href="/admin/settings/availability" className="underline">When clients can book you</Link>.
      </p>
    </AreaFrame>
  );
}

type Window = { id: string; weekday: number; weekdayName: string; start: string; end: string };

/** /admin/settings/availability: the weekly windows booking slots are cut from. */
export function AvailabilityArea({ windows, weekdays, timeZone, ok, bad }: Msg & { windows: Window[]; weekdays: readonly string[]; timeZone: string }) {
  return (
    <AreaFrame icon={Clock3} tone="orange" title={SETTINGS_TITLE.availability} description={`Your hours, week after week (${timeZone}). The booking page cuts call slots from these windows.`} ok={ok} bad={bad}>
      <Panel id="availability" title="Your weekly hours" description={windows.length === 0 ? "None yet." : `${windows.length} ${windows.length === 1 ? "window" : "windows"} a week.`}>
        <DataList<Window>
          caption="Weekly availability"
          rows={windows}
          rowKey={(w) => w.id}
          columns={[
            { key: "day", header: "Day", cell: (w) => w.weekdayName, primary: true },
            { key: "hours", header: "Hours", cell: (w) => `${w.start} to ${w.end}` },
            {
              key: "remove",
              header: <span className="sr-only">Remove</span>,
              align: "right",
              cell: (w) => (
                <form action={removeAvailabilityAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <Button type="submit" size="sm" variant="outline" aria-label={`Remove ${w.weekdayName} ${w.start} to ${w.end}`}>
                    Remove
                  </Button>
                </form>
              ),
            },
          ]}
          empty={<EmptyState icon={Clock3} title="Nobody can book a call." hint="Add at least one window below." />}
        />
      </Panel>
      <Panel icon={Plus} tone="orange" title="Add a window" description="Windows on the same day must not overlap.">
        <form action={addAvailabilityAction} className="flex flex-col gap-4">
          <RadioChips name="weekday" legend="Day" required defaultValue="1" options={weekdays.map((name, i) => ({ value: String(i), label: name }))} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From" required>
              <Input name="start" type="time" defaultValue="09:00" required className="w-36" />
            </Field>
            <Field label="To" required>
              <Input name="end" type="time" defaultValue="17:00" required className="w-36" />
            </Field>
            <Button type="submit">Add window</Button>
          </div>
        </form>
      </Panel>
    </AreaFrame>
  );
}
