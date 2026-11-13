import Link from "next/link";
import { CircleCheck, Clock3, Coins, Database, HardDrive, HeartPulse, OctagonAlert, Plug, Send, TriangleAlert, Webhook } from "lucide-react";
import { cn } from "@/lib/cn";
import { CARD, DataList, ExpandCard, PageHeader, StatGrid, StatTile, StatusPill, TodoList, type TodoItem } from "@/components/admin/kit";
import { Bars } from "@/components/admin/charts";
import { Empty, Section } from "@/components/admin/ui";
import { dateTime, num } from "@/lib/admin/format";
import type { HealthStatus, SystemHealth } from "@/lib/admin/health";
import type { CronStatus } from "@/lib/admin/cron";
import type { ServiceAttention } from "@/lib/admin/services";


const STATUS: Record<HealthStatus, { label: string; text: string; icon: typeof CircleCheck; ring: string; badge: string }> = {
  ok: { label: "All good", text: "Every job is on time and nothing is stuck.", icon: CircleCheck, ring: "border-success/30", badge: "bg-[linear-gradient(135deg,#0f9f6e,#34d399)]" },
  warning: { label: "Needs a look", text: "Something needs a look, but customers are most likely fine.", icon: TriangleAlert, ring: "border-[#f59e0b]/40", badge: "bg-[linear-gradient(135deg,#f97316,#fbbf24)]" },
  problem: { label: "Problem", text: "Something is broken or badly late. Start with the list below.", icon: OctagonAlert, ring: "border-danger/40", badge: "bg-[linear-gradient(135deg,#c81e3a,#f43f5e)]" },
};

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB`);

const JOB_PILL: Record<CronStatus["state"], (c: CronStatus) => React.ReactNode> = {
  ok: (c) =>
    c.caughtUp ? (
      <span title={`Its ${dateTime(c.caughtUp.missed)} run was missed (the server was off or busy) and made up at ${dateTime(c.caughtUp.at)}.`}>
        <StatusPill tone="good" dot>Caught up</StatusPill>
      </span>
    ) : (
      <StatusPill tone="good" dot>On time</StatusPill>
    ),
  failed: () => <StatusPill tone="bad" dot>Last run failed</StatusPill>,
  overdue: (c) => <StatusPill tone="bad" dot>Overdue {c.overdueByMinutes} min</StatusPill>,
  never: () => <StatusPill tone="muted" dot>No runs yet</StatusPill>,
};

/** What needs the owner, worst first: the health issues, then services that are failing or switched off. */
export function healthTodos(h: Pick<SystemHealth, "issues">, services: { failing: ServiceAttention[]; off: ServiceAttention[] }): TodoItem[] {
  const issues: TodoItem[] = [...h.issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "problem" ? -1 : 1)).map((i) => ({ key: i.key, text: i.text, href: i.href, tone: i.level === "problem" ? "bad" : "warn", icon: i.level === "problem" ? OctagonAlert : TriangleAlert }));
  const failing: TodoItem[] = services.failing.map((f) => ({ key: `failing:${f.key}`, text: `${f.label} is failing`, sub: f.reason, href: `/admin/services/${f.key}`, tone: "bad", icon: Plug }));
  const off: TodoItem[] = services.off.map((o) => ({ key: `off:${o.key}`, text: `${o.label} is switched off`, sub: o.reason, href: `/admin/services/${o.key}`, tone: "info", icon: Plug }));
  return [...issues.filter((i) => i.tone === "bad"), ...failing, ...issues.filter((i) => i.tone !== "bad"), ...off];
}

/** Admin -> Health: one calm status, what needs you, the key numbers, the jobs, and the details on demand. */
export function HealthView({ h, services }: { h: SystemHealth; services: { failing: ServiceAttention[]; off: ServiceAttention[] } }) {
  const s = STATUS[h.status];
  const q = h.queues;
  const hooks = q.webhookTotal24h ? Math.round((q.webhookFailed24h / q.webhookTotal24h) * 100) : 0;
  const maxHour = Math.max(1, ...h.errors.perHour.map((x) => x.count));
  const todos = healthTodos(h, services);
  const late = h.crons.filter((c) => c.state === "overdue" || c.state === "failed").length;
  return (
    <>
      <PageHeader icon={HeartPulse} tone="slate" title="Health" description={`Is anything down? Checked ${dateTime(h.generatedAt)}. Jobs report when they finish, so one that stops shows up as overdue.`} />

      <section aria-label="Overall status" className={cn("relative flex items-center gap-4 overflow-hidden p-5 sm:p-6", CARD, s.ring)}>
        <span aria-hidden className={cn("inline-flex size-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg", s.badge)}>
          <s.icon className="size-7" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">{s.label}</h2>
          <p className="text-[14px] leading-snug text-muted">{s.text}</p>
        </div>
      </section>

      <Section title="Needs you" description="Anything broken, late or switched off, worst first. Tap one to fix it.">
        <TodoList items={todos} limit={6} columns={2} empty={{ title: "Nothing needs you.", hint: "Every job is on time and every service answers." }} />
      </Section>

      <Section title="Right now" description="Tap a number for the page behind it.">
        <StatGrid cols={4}>
          <StatTile icon={Send} tone="slate" label="Posts late" value={num(q.postsOverdue)} hint="Scheduled, more than 10 minutes past due." alert={q.postsOverdue > 0} />
          <StatTile icon={Clock3} tone="slate" label="Posts stuck" value={num(q.postsStuck)} hint="Publishing for more than 15 minutes." alert={q.postsStuck > 0} />
          <StatTile icon={TriangleAlert} tone="red" label="Errors, last hour" value={num(h.errors.lastHour)} hint={`${num(h.errors.last24h)} in 24 hours.`} href="/admin/errors" alert={h.errors.lastHour >= 10} />
          <StatTile icon={Coins} tone="green" label="Money requests" value={num(q.pendingApprovals)} hint={q.oldestApprovalHours !== null ? `Oldest waiting ${q.oldestApprovalHours} h.` : "Nothing waiting."} href="/admin/approvals" />
        </StatGrid>
        <ExpandCard icon={Webhook} tone="slate" title="More numbers" summary={`${num(q.needsAction)} posts need a manual post · ${num(q.webhookPending)} webhooks waiting`}>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["Need the owner", num(q.needsAction), "Posts waiting for a manual post."],
              ["Webhooks waiting", num(q.webhookPending), "Deliveries to retry."],
              ["Webhook failures", q.webhookTotal24h ? `${hooks}%` : "n/a", `${num(q.webhookFailed24h)} of ${num(q.webhookTotal24h)} in 24 hours.`],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-2xl bg-soft px-4 py-3">
                <dt className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</dt>
                <dd className="text-[18px] font-bold tabular-nums">{value}</dd>
                <dd className="text-[12.5px] text-muted">{hint}</dd>
              </div>
            ))}
          </dl>
        </ExpandCard>
      </Section>

      <Section title="Scheduled jobs" description={late ? `${late} of ${h.crons.length} jobs need a look.` : `All ${h.crons.length} jobs are on time.`}>
        <div className={cn("p-4 sm:p-5", CARD)}>
          <DataList<CronStatus>
            caption="Scheduled jobs"
            rows={[...h.crons].sort((a, b) => Number(a.state === "ok") - Number(b.state === "ok"))}
            rowKey={(c) => c.job}
            columns={[
              {
                key: "job",
                header: "Job",
                primary: true,
                cell: (c) => (
                  <span className="flex flex-col gap-0.5">
                    <span>{c.label}</span>
                    <span className="text-[12px] font-normal text-muted">{c.what}</span>
                  </span>
                ),
              },
              { key: "state", header: "Status", cell: (c) => JOB_PILL[c.state](c) },
              {
                key: "last",
                header: "Last run",
                cell: (c) => (
                  <span className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap">{c.lastStartedAt ? dateTime(c.lastStartedAt) : "Never"}</span>
                    {c.lastError ? <span className="line-clamp-2 max-w-[18rem] text-[12px] text-danger" title={c.lastError}>{c.lastError}</span> : c.lastSummary ? <span className="line-clamp-1 max-w-[18rem] text-[12px] text-muted" title={c.lastSummary}>{c.lastSummary}</span> : null}
                  </span>
                ),
              },
              { key: "next", header: "Next", cell: (c) => (c.nextExpectedAt ? dateTime(c.nextExpectedAt) : "n/a"), hideOnPhone: true },
              { key: "fails", header: "Failed, 24 h", align: "right", cell: (c) => `${c.failures24h} of ${c.runs24h}`, hideOnPhone: true },
            ]}
          />
        </div>
      </Section>

      <Section title="Details" description="Open one when you need it.">
        <div className="grid items-start gap-3 lg:grid-cols-3">
          <ExpandCard icon={TriangleAlert} tone="red" title="Errors, last 24 hours" summary={h.errors.last24h === 0 ? "None." : `${num(h.errors.last24h)} errors, peak ${maxHour} in an hour.`} aside={<Link href="/admin/errors" className="text-[13px] font-semibold text-pulse-blue">All errors</Link>}>
            {h.errors.last24h === 0 ? (
              <Empty>No errors in the last 24 hours.</Empty>
            ) : (
              <div className="flex flex-col gap-4">
                <div role="img" aria-label={`Errors per hour over 24 hours, peak ${maxHour}`} className="flex h-24 items-end gap-0.5">
                  {h.errors.perHour.map((x) => (
                    <span key={x.hour} title={`${x.hour.slice(11, 13)}:00 UTC: ${x.count}`} className="flex-1 rounded-t bg-danger" style={{ height: `${Math.max(x.count ? 6 : 1, (x.count / maxHour) * 100)}%`, opacity: x.count ? 1 : 0.25 }} />
                  ))}
                </div>
                <ul className="flex flex-col gap-2 text-[13px]">
                  {h.errors.top.map((e) => (
                    <li key={`${e.source}${e.message}`} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <code className="font-mono text-[12px]">{e.source}</code>
                        <span className="block truncate text-muted" title={e.message}>{e.message}</span>
                      </span>
                      <StatusPill tone="bad">{e.count}</StatusPill>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ExpandCard>
          <ExpandCard icon={Database} tone="slate" title="Database" summary={h.db ? `${mb(h.db.sizeBytes)} of ${mb(h.db.limitBytes)} (${Math.round((h.db.sizeBytes / h.db.limitBytes) * 100)}%)` : "The size could not be read."}>
            {h.db ? (
              <div className="flex flex-col gap-3">
                <Bars rows={h.db.tables.map((t) => ({ label: t.name, value: t.bytes, text: mb(t.bytes) }))} />
                <p className="text-[12.5px] text-muted">
                  From Postgres, kept 5 minutes. Set <code className="font-mono">DB_SIZE_LIMIT_MB</code> to your plan&apos;s limit.
                </p>
              </div>
            ) : (
              <Empty>The size could not be read.</Empty>
            )}
          </ExpandCard>
          <ExpandCard icon={HardDrive} tone="slate" title="File storage" summary={h.storage ? `${h.storage.length} ${h.storage.length === 1 ? "bucket" : "buckets"}, ${mb(h.storage.reduce((n, b) => n + b.bytes, 0))}` : "Storage size could not be read."}>
            {!h.storage || h.storage.length === 0 ? <Empty>{h.storage ? "No files stored yet." : "Storage size could not be read."}</Empty> : <Bars color="var(--color-pulse-violet)" rows={h.storage.map((b) => ({ label: b.bucket, value: b.bytes, text: `${mb(b.bytes)} · ${num(b.objects)} files` }))} />}
          </ExpandCard>
        </div>
      </Section>
    </>
  );
}
