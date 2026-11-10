import { CalendarClock, Megaphone, Plus, Radio, Archive } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { LocalTime, TimezoneField } from "@/components/admin/local-time";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { createAnnouncementAction, endAnnouncementAction } from "@/app/admin/(console)/actions";
import { CARD, EmptyState, ExpandCard, FilterChips, PageHeader, StatGrid, StatTile, StatusPill, type PillTone, type SearchParamsLike } from "../kit";
import { FormChips, FormSwitch } from "../kit/form-chips";
import { notice } from "../ui";

export type AnnouncementRow = { id: string; title: string; body: string; startsAt: Date; endsAt: Date | null; audience: string; plans: string[] };
export type AnnouncementState = "live" | "scheduled" | "ended";
export const ANNOUNCEMENT_STATES = ["live", "scheduled", "ended"] as const;

/** Live, scheduled (starts later) or ended, at `now`. */
export const announcementState = (a: Pick<AnnouncementRow, "startsAt" | "endsAt">, now: number): AnnouncementState =>
  a.startsAt.getTime() > now ? "scheduled" : a.endsAt && a.endsAt.getTime() <= now ? "ended" : "live";

const PILL: Record<AnnouncementState, { tone: PillTone; text: string }> = { live: { tone: "good", text: "Live" }, scheduled: { tone: "new", text: "Scheduled" }, ended: { tone: "muted", text: "Ended" } };

/**
 * Announcements: how many are live, scheduled and ended (tap one to filter), "New announcement" as a card that opens,
 * and each banner as a card with End now or Cancel.
 */
export function AnnouncementsView({ rows, plans, now, show, params, message }: { rows: AnnouncementRow[]; plans: { key: string; name: string }[]; now: number; show: "" | AnnouncementState; params: SearchParamsLike; message: { notice?: string; error?: string } }) {
  const withState = rows.map((a) => ({ a, s: announcementState(a, now) }));
  const count = (s: AnnouncementState) => withState.filter((x) => x.s === s).length;
  const shown = show ? withState.filter((x) => x.s === show) : withState;
  return (
    <>
      <PageHeader icon={Megaphone} tone="pink" title="Announcements" description="A banner at the top of every client's dashboard. Clients can dismiss it on their device." />
      {message.notice && <p role="status" className={notice.ok}>{message.notice}</p>}
      {message.error && <p role="alert" className={notice.bad}>{message.error}</p>}
      <StatGrid cols={3}>
        <StatTile icon={Radio} tone="pink" label="Live now" value={String(count("live"))} hint="Clients see these today." href="/admin/announcements?show=live" />
        <StatTile icon={CalendarClock} tone="pink" label="Scheduled" value={String(count("scheduled"))} hint="They start on their own later." href="/admin/announcements?show=scheduled" />
        <StatTile icon={Archive} tone="pink" label="Ended" value={String(count("ended"))} hint="No longer shown." href="/admin/announcements?show=ended" className="max-lg:col-span-2" />
      </StatGrid>
      <ExpandCard icon={Plus} tone="pink" title="New announcement" summary="Write the banner, choose when and who sees it." defaultOpen={!!message.error || rows.length === 0}>
        <form action={createAnnouncementAction} className="flex max-w-3xl flex-col gap-4">
          <TimezoneField />
          <Field label="Title" required><Input name="title" maxLength={120} required /></Field>
          <Field label="Message" required hint="Up to 2000 characters, plain text."><Textarea name="body" rows={3} maxLength={2000} required /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start" hint="Leave empty to show it now. Your own timezone."><Input name="startsAt" type="datetime-local" /></Field>
            <Field label="End (optional)"><Input name="endsAt" type="datetime-local" /></Field>
          </div>
          <FormChips name="plans" legend="Show to" hint="Pick none to show it to everyone." options={plans.map((p) => ({ value: p.key, label: p.name }))} multiple />
          <FormSwitch name="dismissible" label="Clients can dismiss it" hint="Off: it stays until it ends." defaultChecked />
          <Button type="submit" className="self-start">Save announcement</Button>
        </form>
      </ExpandCard>
      <FilterChips label="Show announcements" param="show" base="/admin/announcements" params={params} current={show} options={[{ value: "", label: "All", count: rows.length }, { value: "live", label: "Live", count: count("live") }, { value: "scheduled", label: "Scheduled", count: count("scheduled") }, { value: "ended", label: "Ended", count: count("ended") }]} />
      {shown.length === 0 ? (
        <EmptyState icon={Megaphone} title={rows.length ? "None in this list." : "No announcements yet."} hint={rows.length ? "Pick another chip above." : "Open New announcement above to write the first banner."} />
      ) : (
        <ul className="kit-rise grid items-start gap-3 lg:grid-cols-2">
          {shown.map(({ a, s }) => (
            <li key={a.id} className={cn("flex min-w-0 flex-col gap-2.5 p-4 sm:p-5", CARD, s === "ended" && "opacity-80")}>
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-[15px] font-bold">{a.title}</p>
                <StatusPill tone={PILL[s].tone} dot>{PILL[s].text}</StatusPill>
              </div>
              <p className="break-words text-[14px]">{a.body}</p>
              <p className="text-[12.5px] text-muted">
                <LocalTime iso={a.startsAt.toISOString()} />
                {a.endsAt ? <> to <LocalTime iso={a.endsAt.toISOString()} /></> : ", no end"} · {a.audience === "plan" ? a.plans.join(", ").toLowerCase() : "everyone"}
              </p>
              {s !== "ended" && (
                <div className="flex justify-end border-t border-line pt-2.5">
                  <ConfirmButton action={endAnnouncementAction} fields={{ id: a.id }} label={s === "live" ? "End now" : "Cancel"} title={s === "live" ? "End this announcement?" : "Cancel this announcement?"} description="Clients stop seeing it straight away." confirmLabel="Yes, end it" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
