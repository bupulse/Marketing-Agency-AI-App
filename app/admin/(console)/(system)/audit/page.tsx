import { requireAdmin } from "@/lib/admin/auth";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { Panel } from "@/components/admin/ui";
import { Badge, Button, Input } from "@/components/ui";
import { dateTime, param } from "@/lib/admin/format";
import { diffJson, show } from "@/lib/admin/diff";
import { AdminError, getAuditLog } from "@/lib/admin/service";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const actor = param(sp.actor);
  const action = param(sp.action);
  const target = param(sp.target);
  const since = param(sp.since);
  const until = param(sp.until);
  const cursor = param(sp.cursor);
  let page;
  let bad: string | null = null;
  try {
    page = await getAuditLog({ actor: actor || undefined, action: action || undefined, target: target || undefined, since: since ? `${since}T00:00:00Z` : undefined, until: until ? `${until}T23:59:59Z` : undefined, cursor: cursor || undefined, limit: 50 });
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    bad = e.message;
  }
  const filtered = Boolean(actor || action || target || since || until);
  const next = page?.nextCursor ? `/admin/audit?${new URLSearchParams({ ...(actor && { actor }), ...(action && { action }), ...(target && { target }), ...(since && { since }), ...(until && { until }), cursor: page.nextCursor })}` : null;

  return (
    <>
      <PageHeader title="Audit log" description="Every admin action, from this console and from Jarvis, with what changed. Entries cannot be edited or deleted." />
      <Panel title="Filter">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_9rem_9rem_auto]" role="search">
          <Input name="actor" defaultValue={actor} placeholder="Actor: admin or jarvis:…" aria-label="Actor" />
          <Input name="action" defaultValue={action} placeholder="Action: extend_trial" aria-label="Action" />
          <Input name="target" defaultValue={target} placeholder="Target: user:…" aria-label="Target" />
          <Input name="since" type="date" defaultValue={since} aria-label="From date" />
          <Input name="until" type="date" defaultValue={until} aria-label="To date" />
          <Button type="submit">Filter</Button>
        </form>
      </Panel>
      {bad && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{bad}</p>}
      {page && page.items.length === 0 ? (
        <EmptyState icon={ScrollText} title={filtered ? "No entries match" : "Nothing logged yet"} text="Actions appear here the moment they happen." />
      ) : (
        page && (
          <Panel title={`${page.items.length}${page.nextCursor ? "+" : ""} entries`}>
            <ul className="flex flex-col divide-y divide-line">
              {page.items.map((e) => {
                const rows = diffJson(e.before, e.after);
                const userId = e.target?.startsWith("user:") ? e.target.slice(5) : null;
                return (
                  <li key={e.id} className="py-3 first:pt-0 last:pb-0">
                    <details>
                      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                        <Badge tone={e.actor === "admin" ? "blue" : "violet"}>{e.actor === "admin" ? "You" : "Jarvis"}</Badge>
                        <code className="font-mono text-[13px]">{e.action}</code>
                        <span className="min-w-0 flex-1 truncate text-[14px] text-muted">{e.target ?? ""}</span>
                        <span className="text-xs text-muted">{dateTime(e.createdAt)}</span>
                      </summary>
                      <div className="mt-2 flex flex-col gap-2 text-[13px]">
                        <p className="text-muted">Actor {e.actor}{e.ip ? ` · IP ${e.ip}` : ""}{userId && <> · <Link href={`/admin/users/${userId}`} className="underline">open user</Link></>}</p>
                        {rows.length === 0 ? (
                          <p className="text-muted">No before or after values were recorded.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[420px] text-left">
                              <caption className="sr-only">What changed</caption>
                              <thead><tr><th scope="col" className="pb-1 pr-3 font-medium text-muted">Field</th><th scope="col" className="pb-1 pr-3 font-medium text-muted">Before</th><th scope="col" className="pb-1 font-medium text-muted">After</th></tr></thead>
                              <tbody>
                                {rows.map((r) => (
                                  <tr key={r.path} className="border-t border-line align-top">
                                    <td className="py-1.5 pr-3 font-mono">{r.path}</td>
                                    <td className="break-all py-1.5 pr-3 text-danger">{show(r.before)}</td>
                                    <td className="break-all py-1.5 text-success">{show(r.after)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
            {next && <Button href={next} variant="outline" className="self-start">Older</Button>}
          </Panel>
        )
      )}
    </>
  );
}
