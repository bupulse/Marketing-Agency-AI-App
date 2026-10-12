import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { listAvailability } from "@/lib/admin/availability";
import { param } from "@/lib/admin/format";
import { getSettings } from "@/lib/admin/settings";
import { cardUsdCents, formatMinor } from "@/lib/region-format";
import { DEMO_TIME_ZONE, WEEKDAY_NAMES } from "@/lib/demo/slots";
import { addAvailabilityAction, recomputeCardPricesAction, removeAvailabilityAction, saveSettingsAction } from "./actions";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [s, windows] = await Promise.all([getSettings(), listAvailability()]);
  const example = cardUsdCents(15000, "RWF", s.usdToRwf, s.cardMarginPercent);

  return (
    <>
      <PageHeader title="Settings" description="The trial, card prices, and the demo calls new clients book. Every change is written to the audit log." />
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

      <Panel title="Demo calls" description={`What clients see when they book: the meeting link in every invite, the call length, the gap kept between calls, and days with no calls. Times are ${DEMO_TIME_ZONE.replace("_", " ")}.`}>
        <form action={saveSettingsAction} className="flex flex-col gap-4">
          <Field label="Meeting link" hint="Your reusable Google Meet (or other) link, sent with every invite. Optional until you have one.">
            <Input name="meetingLink" type="url" placeholder="https://meet.google.com/abc-defg-hij" defaultValue={s.meetingLink} />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Call length (minutes)" required>
              <Input name="slotMinutes" type="number" min={15} max={120} step={5} defaultValue={s.slotMinutes} required className="w-28" />
            </Field>
            <Field label="Buffer between calls (minutes)" required>
              <Input name="bufferMinutes" type="number" min={0} max={120} defaultValue={s.bufferMinutes} required className="w-28" />
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
