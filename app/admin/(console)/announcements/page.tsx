import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui";
import { LocalTime, TimezoneField } from "@/components/admin/local-time";
import { nowMs, param } from "@/lib/admin/format";
import { listAnnouncements } from "@/lib/admin/service";
import { createAnnouncementAction, endAnnouncementAction } from "../actions";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage({ searchParams }: PageProps<"/admin/announcements">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const rows = await listAnnouncements();
  const now = nowMs();
  const state = (a: (typeof rows)[number]) =>
    a.startsAt.getTime() > now ? "scheduled" : a.endsAt && a.endsAt.getTime() <= now ? "ended" : "live";

  return (
    <>
      <PageHeader title="Announcements" description="A banner at the top of the customer dashboard. Customers can dismiss it on their device." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <Panel title="New announcement" description="Leave Start empty to show it now. Times are in your own timezone.">
        <form action={createAnnouncementAction} className="flex flex-col gap-4">
          <TimezoneField />
          <Field label="Title" required><Input name="title" maxLength={120} required /></Field>
          <Field label="Message" required hint="Up to 2000 characters, plain text."><Textarea name="body" rows={3} maxLength={2000} required /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start"><Input name="startsAt" type="datetime-local" /></Field>
            <Field label="End (optional)"><Input name="endsAt" type="datetime-local" /></Field>
          </div>
          <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <legend className="mb-1 text-sm font-medium">Show to (none ticked means everyone)</legend>
            {[["TRIAL", "Trial"], ["STANDARD", "Standard"], ["PRO", "Pro"]].map(([v, l]) => (
              <label key={v} className="inline-flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" name="plans" value={v} className="size-5" /> {l}</label>
            ))}
          </fieldset>
          <label className="inline-flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" name="dismissible" defaultChecked className="size-5" /> Customers can dismiss it</label>
          <Button type="submit" className="self-start">Save announcement</Button>
        </form>
      </Panel>

      <Panel title="All announcements">
        {rows.length === 0 ? (<Empty>No announcements yet.</Empty>) : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((a) => {
              const s = state(a);
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-semibold">{a.title} <Badge tone={s === "live" ? "success" : s === "scheduled" ? "violet" : "neutral"}>{s}</Badge></p>
                    <p className="text-[14px] break-words">{a.body}</p>
                    <p className="text-[13px] text-muted"><LocalTime iso={a.startsAt.toISOString()} />{a.endsAt ? <> to <LocalTime iso={a.endsAt.toISOString()} /></> : ", no end"} · {a.audience === "plan" ? a.plans.join(", ").toLowerCase() : "everyone"}</p>
                  </div>
                  {s !== "ended" && (
                    <ConfirmButton action={endAnnouncementAction} fields={{ id: a.id }} label={s === "live" ? "End now" : "Cancel"} title={s === "live" ? "End this announcement?" : "Cancel this announcement?"} description="Customers stop seeing it straight away." confirmLabel="Yes, end it" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
