// Admin -> Clients -> Demos: the demo calls and custom plan calls, with chips for when and status, and the actions per
// call (mark done, no-show, activate the account). Plain data in, so the page and the dev preview render the same.
import Link from "next/link";
import { CalendarCheck, CalendarDays, CalendarX2, History, Info, Video } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { ActivateAccount } from "@/components/admin/activate-account";
import { SubscriptionStatus } from "@/components/admin/subscription-status";
import { ChoiceTiles, DataList, EmptyState, ExpandCard, FilterChips, PageHeader, StatusPill, type PillTone, type SearchParamsLike } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { Button, Field, Textarea } from "@/components/ui";
import type { SubscriptionSummary } from "@/lib/admin/subscription-summary";
import { Notices, subStatus } from "./shared";

export type DemoRow = {
  id: string;
  businessId: string;
  userId: string;
  kind: "demo" | "custom_plan";
  requestId: string | null;
  planKey: string;
  status: string;
  notes: string | null;
  meetingLink: string | null;
  googleSyncPending: boolean;
  googleSyncError: string | null;
  businessName: string;
  country: string | null;
  region: string | null;
  contactName: string | null;
  email: string;
  when: string;
  subscriptionStatus: string | null;
};

export const DEMO_STATUS: Record<string, { label: string; tone: PillTone }> = {
  booked: { label: "Booked", tone: "info" },
  done: { label: "Done", tone: "good" },
  no_show: { label: "No-show", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export function DemosView({
  demos,
  when,
  status,
  sp,
  trialDays,
  meetingLinkSet,
  googleNeedsReconnect,
  account,
  here,
  demoStatusAction,
  retryDemoCalendarAction,
}: {
  demos: DemoRow[];
  when: "upcoming" | "past" | "all";
  status: string;
  sp: SearchParamsLike;
  trialDays: number;
  meetingLinkSet: boolean;
  googleNeedsReconnect: boolean;
  /** Where each company's account stands now (by the demo's user id): its status and a summary with links. */
  account: (userId: string) => { status: string | null; summary: SubscriptionSummary | null };
  here: string;
  demoStatusAction: (f: FormData) => Promise<void>;
  retryDemoCalendarAction: (f: FormData) => Promise<void>;
}) {
  const base = "/admin/demos";
  return (
    <>
      <PageHeader icon={CalendarCheck} tone="blue" title="Demos" description="Demo calls new clients booked, and custom plan calls after a request. Times are Kigali time." />
      <Notices sp={sp} />
      {googleNeedsReconnect && (
        <p role="alert" className={notice.bad}>
          <strong>Reconnect Google Calendar.</strong> Google no longer accepts the saved login, so new bookings use the meeting link and .ics invites and calendar changes wait.{" "}
          <Link href="/admin/settings#google-calendar" className="underline">Reconnect Google Calendar</Link>
        </p>
      )}
      {!meetingLinkSet && (
        <p role="status" className={notice.warn}>
          <strong>No meeting link yet.</strong> Add your reusable Google Meet link in <Link href="/admin/settings" className="underline">Settings</Link> so invites carry it.
        </p>
      )}
      <ExpandCard icon={Info} tone="slate" title="How demos work" summary="After a demo, Activate account: a trial or an invoice.">
        <p className="text-[14px] leading-relaxed">
          After a demo, tap <strong>Activate account</strong>: start the trial ({trialDays} {trialDays === 1 ? "day" : "days"} by default, set in Settings) or send an invoice. After a custom plan call, open the request and tap <strong>Customise plan</strong>.
        </p>
      </ExpandCard>
      <ChoiceTiles
        label="When"
        param="when"
        base={base}
        params={sp}
        current={when}
        allValue="upcoming"
        options={[
          { value: "upcoming", label: "Upcoming", hint: "Calls still to come", icon: CalendarDays, tone: "blue" },
          { value: "past", label: "Past", hint: "Calls that ended", icon: History, tone: "slate" },
          { value: "all", label: "All", hint: "Everything booked", icon: CalendarX2, tone: "violet" },
        ]}
      />
      <FilterChips label="Demo status" param="status" base={base} params={sp} current={status} options={[{ value: "", label: "Any status" }, ...Object.entries(DEMO_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]} />
      <p className="px-1 text-[13px] text-muted">
        {demos.length} {when === "upcoming" ? "upcoming" : when === "past" ? "past" : ""} {demos.length === 1 ? "demo" : "demos"}
      </p>
      <DataList<DemoRow>
        caption="Demo bookings"
        rows={demos}
        rowKey={(d) => d.id}
        columns={[
          {
            key: "company",
            header: "Company",
            primary: true,
            className: "max-w-[15rem]",
            cell: (d) => (
              <>
                <Link href={`/admin/companies/${d.businessId}`} className="block truncate font-semibold text-text underline-offset-2 hover:underline">{d.businessName}</Link>
                <span className="block text-xs font-normal text-muted">{[d.country, d.region].filter(Boolean).join(" · ")}</span>
                {d.kind === "custom_plan" && (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 font-normal">
                    <StatusPill tone="new">Custom plan call</StatusPill>
                    {d.requestId && <Link href={`/admin/requests?open=${d.requestId}#request-${d.requestId}`} className="text-xs underline">Request</Link>}
                  </span>
                )}
              </>
            ),
          },
          {
            key: "when",
            header: "When",
            cell: (d) => (
              <span className="flex flex-col gap-1">
                <span className="whitespace-nowrap font-medium">{d.when}</span>
                {d.meetingLink && d.status === "booked" && (
                  <a href={d.meetingLink} target="_blank" rel="noreferrer noopener" className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">
                    <Video aria-hidden className="size-3.5" /> Join
                  </a>
                )}
              </span>
            ),
          },
          { key: "contact", header: "Contact", cell: (d) => <span className="block max-w-[14rem]"><span className="block truncate">{d.contactName ?? "-"}</span><span className="block truncate text-xs text-muted">{d.email}</span></span>, hideOnPhone: true },
          { key: "plan", header: "Plan", cell: (d) => d.planKey, hideOnPhone: true },
          {
            key: "demo",
            header: "Demo",
            cell: (d) => {
              const s = DEMO_STATUS[d.status] ?? { label: d.status, tone: "muted" as PillTone };
              return (
                <>
                  <StatusPill tone={s.tone} dot>{s.label}</StatusPill>
                  {d.notes && <span className="mt-1 block max-w-[16rem] truncate text-xs text-muted" title={d.notes}>{d.notes}</span>}
                  {d.googleSyncPending && (
                    <form action={retryDemoCalendarAction} className="mt-1 flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="back" value={here} />
                      <span className="text-xs font-medium text-danger" title={d.googleSyncError ?? undefined}>Calendar not updated</span>
                      <Button type="submit" size="sm" variant="outline">Retry</Button>
                    </form>
                  )}
                </>
              );
            },
          },
          {
            key: "account",
            header: "Account",
            cell: (d) => {
              const a = account(d.userId);
              const sub = subStatus(a.status ?? d.subscriptionStatus);
              return (
                <span className="flex flex-col gap-1">
                  {sub && <StatusPill tone={sub.tone} dot>{sub.label}</StatusPill>}
                  {a.summary && <SubscriptionStatus summary={a.summary} businessId={d.businessId} />}
                </span>
              );
            },
          },
          {
            key: "actions",
            header: "Actions",
            cell: (d) => {
              const subNow = account(d.userId).status ?? d.subscriptionStatus;
              if (d.status !== "booked" && subNow !== "PENDING_DEMO") return null;
              return (
                <div className="flex flex-wrap gap-1.5">
                  {d.status === "booked" && (
                    <>
                      <ConfirmButton action={demoStatusAction} fields={{ id: d.id, status: "done", back: here }} label="Mark done" title="Mark this demo as done?" description={`${d.businessName}, ${d.when}. Written to the audit log.`} confirmLabel="Mark done">
                        <Field label="Notes" hint="What you learned, what they need. Optional."><Textarea name="notes" rows={2} maxLength={1000} /></Field>
                      </ConfirmButton>
                      <ConfirmButton action={demoStatusAction} fields={{ id: d.id, status: "no_show", back: here }} label="No-show" title="Mark as a no-show?" description={`${d.businessName} did not join on ${d.when}. The client can book a new time from their dashboard.`} confirmLabel="Mark no-show">
                        <Field label="Notes" hint="Optional."><Textarea name="notes" rows={2} maxLength={1000} /></Field>
                      </ConfirmButton>
                    </>
                  )}
                  {subNow === "PENDING_DEMO" && <ActivateAccount businessId={d.businessId} back={here} businessName={d.businessName} planName={d.planKey} trialDays={trialDays} interval="MONTH" />}
                </div>
              );
            },
          },
        ]}
        empty={<EmptyState icon={CalendarCheck} title={when === "upcoming" ? "No demos booked." : "Nothing here."} hint={when === "upcoming" ? "New clients book one after sign-up." : "Pick another filter above."} />}
      />
    </>
  );
}
