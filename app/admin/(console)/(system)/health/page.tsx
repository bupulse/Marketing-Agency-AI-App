import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { Bars } from "@/components/admin/charts";
import { Empty, Panel, Stat, TableWrap, Td, Th } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { dateTime, num } from "@/lib/admin/format";
import { getSystemHealth, type HealthStatus } from "@/lib/admin/health";
import { getServicesAttention } from "@/lib/admin/services";
import Link from "next/link";

export const metadata = { title: "System health" };

const STATUS: Record<HealthStatus, { label: string; tone: "success" | "violet" | "danger"; text: string }> = {
  ok: { label: "All good", tone: "success", text: "Every job is on time and nothing is stuck." },
  warning: { label: "Warning", tone: "violet", text: "Something needs a look, but customers are most likely fine." },
  problem: { label: "Problem", tone: "danger", text: "Something is broken or badly late. Check the items below." },
};

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB`);

export default async function HealthPage() {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const [h, services] = await Promise.all([getSystemHealth(), getServicesAttention().catch(() => ({ failing: [], off: [] }))]);
  const s = STATUS[h.status];
  const q = h.queues;
  const hooks = q.webhookTotal24h ? Math.round((q.webhookFailed24h / q.webhookTotal24h) * 100) : 0;
  const maxHour = Math.max(1, ...h.errors.perHour.map((x) => x.count));

  return (
    <>
      <PageHeader title="System health" description={`Checked ${dateTime(h.generatedAt)}. Jobs report themselves when they finish, so a job that stops shows up as overdue.`} action={<Badge tone={s.tone} className="px-4 py-2 text-sm">{s.label}</Badge>} />
      <Panel title={s.label} description={s.text}>
        {h.issues.length === 0 ? (
          <Empty>No issues found.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {h.issues.map((i) => (
              <li key={i.key} className="flex items-start gap-3 text-[15px]">
                <Badge tone={i.level === "problem" ? "danger" : "violet"}>{i.level}</Badge>
                <Link href={i.href} className="underline">{i.text}</Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {(services.off.length > 0 || services.failing.length > 0) && (
        <Panel title="Services" description="Outside services that are switched off or failing." action={<Link href="/admin/services" className="text-sm font-medium underline">Open Services</Link>}>
          <ul className="flex flex-col gap-2 text-[15px]">
            {services.off.map((o) => (<li key={o.key} className="flex items-start gap-3"><Badge tone="violet">Off</Badge><span>{o.label}: {o.reason}</span></li>))}
            {services.failing.map((f) => (<li key={f.key} className="flex items-start gap-3"><Badge tone="danger">Failing</Badge><span>{f.label}: {f.reason}</span></li>))}
          </ul>
        </Panel>
      )}

      <Panel title="Scheduled jobs" description="The last run of each job, when it should run next, and failures in the last 24 hours.">
        <TableWrap caption="Scheduled jobs">
          <thead><tr><Th>Job</Th><Th>Status</Th><Th>Last run</Th><Th>Next expected</Th><Th right>Failed / runs, 24 h</Th></tr></thead>
          <tbody>
            {h.crons.map((c) => (
              <tr key={c.job}>
                <Td className="max-w-[16rem]">
                  <span className="block font-medium">{c.label}</span>
                  <span className="block text-xs text-muted">{c.what} · {c.via} · <code className="font-mono">{c.cron}</code></span>
                </Td>
                <Td>
                  {c.state === "ok" && <Badge tone="success">On time</Badge>}
                  {c.state === "failed" && <Badge tone="danger">Last run failed</Badge>}
                  {c.state === "overdue" && <Badge tone="danger">Overdue {c.overdueByMinutes} min</Badge>}
                  {c.state === "never" && <Badge tone="neutral">No runs yet</Badge>}
                </Td>
                <Td className="whitespace-nowrap">
                  {c.lastStartedAt ? dateTime(c.lastStartedAt) : "never"}
                  {c.lastError && <span className="block max-w-[18rem] truncate text-xs text-danger" title={c.lastError}>{c.lastError}</span>}
                  {!c.lastError && c.lastSummary && <span className="block max-w-[18rem] truncate text-xs text-muted" title={c.lastSummary}>{c.lastSummary}</span>}
                </Td>
                <Td className="whitespace-nowrap">{c.nextExpectedAt ? dateTime(c.nextExpectedAt) : "n/a"}</Td>
                <Td right>{c.failures24h} / {c.runs24h}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Posts late" value={num(q.postsOverdue)} source="Scheduled, more than 10 minutes past due" href="/admin/users" />
        <Stat label="Posts stuck" value={num(q.postsStuck)} source="Publishing for more than 15 minutes" />
        <Stat label="Need the owner" value={num(q.needsAction)} source="Posts waiting for a manual post" />
        <Stat label="Money requests" value={num(q.pendingApprovals)} source={q.oldestApprovalHours !== null ? `Oldest waiting ${q.oldestApprovalHours} h` : "Nothing waiting"} href="/admin/approvals" />
        <Stat label="Webhooks waiting" value={num(q.webhookPending)} source="Deliveries to retry" />
        <Stat label="Webhook failures" value={q.webhookTotal24h ? `${hooks}%` : "n/a"} source={`${num(q.webhookFailed24h)} of ${num(q.webhookTotal24h)} in 24 hours`} />
        <Stat label="Errors, last hour" value={num(h.errors.lastHour)} source="Error log" href="/admin/errors" />
        <Stat label="Errors, 24 hours" value={num(h.errors.last24h)} source="Error log" href="/admin/errors" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Errors per hour" description="Last 24 hours, oldest first.">
          {h.errors.last24h === 0 ? (
            <Empty>No errors in the last 24 hours.</Empty>
          ) : (
            <div role="img" aria-label={`Errors per hour over 24 hours, peak ${maxHour}`} className="flex h-32 items-end gap-0.5">
              {h.errors.perHour.map((x) => (
                <span key={x.hour} title={`${x.hour.slice(11, 13)}:00 UTC: ${x.count}`} className="flex-1 rounded-t bg-danger" style={{ height: `${Math.max(x.count ? 6 : 1, (x.count / maxHour) * 100)}%`, opacity: x.count ? 1 : 0.25 }} />
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Top errors" description="Same source and message, last 24 hours.">
          {h.errors.top.length === 0 ? (
            <Empty>Nothing to show.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 text-[14px]">
              {h.errors.top.map((e) => (
                <li key={`${e.source}${e.message}`} className="flex items-start justify-between gap-3">
                  <span className="min-w-0"><code className="font-mono text-[13px]">{e.source}</code><span className="block truncate text-muted" title={e.message}>{e.message}</span></span>
                  <Badge tone="danger">{e.count}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Database" description="Size from Postgres, kept for 5 minutes.">
          {!h.db ? (
            <Empty>The size could not be read.</Empty>
          ) : (
            <>
              <p className="text-[15px]"><strong>{mb(h.db.sizeBytes)}</strong> of {mb(h.db.limitBytes)} ({Math.round((h.db.sizeBytes / h.db.limitBytes) * 100)}%). Set <code className="font-mono text-[13px]">DB_SIZE_LIMIT_MB</code> to your plan’s limit.</p>
              <Bars rows={h.db.tables.map((t) => ({ label: t.name, value: t.bytes, text: mb(t.bytes) }))} />
            </>
          )}
        </Panel>
        <Panel title="File storage" description="Per bucket, kept for 10 minutes.">
          {!h.storage || h.storage.length === 0 ? (
            <Empty>{h.storage ? "No files stored yet." : "Storage size could not be read."}</Empty>
          ) : (
            <Bars color="var(--color-pulse-violet)" rows={h.storage.map((b) => ({ label: b.bucket, value: b.bytes, text: `${mb(b.bytes)} · ${num(b.objects)} files` }))} />
          )}
        </Panel>
      </div>
    </>
  );
}
