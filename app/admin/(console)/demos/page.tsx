import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Field, Select, Textarea, type BadgeTone } from "@/components/ui";
import { listDemos } from "@/lib/admin/demos";
import { param } from "@/lib/admin/format";
import { getSettings } from "@/lib/admin/settings";
import { cn } from "@/lib/cn";
import { ActivateAccount } from "@/components/admin/activate-account";
import { demoStatusAction } from "./actions";

export const metadata = { title: "Demos" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  booked: { label: "Booked", tone: "blue" },
  done: { label: "Done", tone: "success" },
  no_show: { label: "No-show", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const SUB: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING_DEMO: { label: "Waiting for demo", tone: "violet" },
  TRIALING: { label: "On trial", tone: "blue" },
  ACTIVE: { label: "Paying", tone: "success" },
  PAST_DUE: { label: "Past due", tone: "danger" },
  CANCELED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

export default async function DemosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const when = (["upcoming", "past", "all"] as const).find((w) => w === param(sp.when)) ?? "upcoming";
  const status = param(sp.status);
  const [demos, settings] = await Promise.all([listDemos({ when, status: status || undefined }), getSettings()]);
  const here = `/admin/demos?${new URLSearchParams({ when, ...(status && { status }) })}`;
  const qs = (w: string) => `/admin/demos?${new URLSearchParams({ when: w, ...(status && { status }) })}`;

  return (
    <>
      <PageHeader
        title="Demos"
        description={`Demo calls booked by new clients, in Africa/Kigali time. After the call, Activate account: start the trial (${settings.trialDays} ${settings.trialDays === 1 ? "day" : "days"} by default, set in Settings) or send an invoice.`}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {!settings.meetingLink && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">
          <strong>No meeting link yet.</strong> Add your reusable Google Meet link in <Link href="/admin/settings" className="underline">Settings</Link> so invites carry it.
        </p>
      )}

      <Panel
        title={`${demos.length} ${when === "upcoming" ? "upcoming" : when === "past" ? "past" : ""} ${demos.length === 1 ? "demo" : "demos"}`}
        action={
          <form className="flex flex-wrap items-center gap-2">
            <nav aria-label="When" className="flex gap-1 rounded-full bg-soft p-1">
              {(["upcoming", "past", "all"] as const).map((w) => (
                <Link key={w} href={qs(w)} aria-current={when === w ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium capitalize no-underline", when === w ? "bg-surface text-text shadow-glass" : "text-muted")}>
                  {w}
                </Link>
              ))}
            </nav>
            <input type="hidden" name="when" value={when} />
            <Select name="status" defaultValue={status} aria-label="Status">
              <option value="">Any status</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
            <button type="submit" className="glass inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-sm font-medium">Filter</button>
          </form>
        }
      >
        {demos.length === 0 ? (
          <Empty>{when === "upcoming" ? "No demos booked. New clients book one after sign-up." : "Nothing here."}</Empty>
        ) : (
          <TableWrap caption="Demo bookings">
            <thead>
              <tr><Th>When</Th><Th>Company</Th><Th>Contact</Th><Th>Plan</Th><Th>Demo</Th><Th>Account</Th><Th>Actions</Th></tr>
            </thead>
            <tbody>
              {demos.map((d) => {
                const s = STATUS[d.status] ?? { label: d.status, tone: "neutral" as BadgeTone };
                const sub = d.subscriptionStatus ? (SUB[d.subscriptionStatus] ?? { label: d.subscriptionStatus, tone: "neutral" as BadgeTone }) : null;
                return (
                  <tr key={d.id}>
                    <Td className="whitespace-nowrap">
                      {d.when}
                      {d.meetingLink && d.status === "booked" && (
                        <a href={d.meetingLink} target="_blank" rel="noreferrer noopener" className="block text-xs underline">Join</a>
                      )}
                    </Td>
                    <Td className="max-w-[14rem]">
                      <Link href={`/admin/companies/${d.businessId}`} className="block truncate font-medium underline">{d.businessName}</Link>
                      <span className="block text-xs text-muted">{[d.country, d.region].filter(Boolean).join(" · ")}</span>
                    </Td>
                    <Td className="max-w-[14rem]">
                      <span className="block truncate">{d.contactName ?? "-"}</span>
                      <span className="block truncate text-xs text-muted">{d.email}</span>
                    </Td>
                    <Td>{d.planKey}</Td>
                    <Td>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {d.notes && <span className="mt-1 block max-w-[16rem] truncate text-xs text-muted" title={d.notes}>{d.notes}</span>}
                    </Td>
                    <Td>{sub && <Badge tone={sub.tone}>{sub.label}</Badge>}</Td>
                    <Td>
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
                        {d.subscriptionStatus === "PENDING_DEMO" && (
                          <ActivateAccount businessId={d.businessId} back={here} businessName={d.businessName} planName={d.planKey} trialDays={settings.trialDays} interval="MONTH" />
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
