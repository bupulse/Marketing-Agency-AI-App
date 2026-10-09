import { requireAdmin } from "@/lib/admin/auth";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { Panel } from "@/components/admin/ui";
import { Badge, Button, Input, Select } from "@/components/ui";
import { dateTime, nowMs, param } from "@/lib/admin/format";
import { AdminError, getErrors } from "@/lib/admin/service";
import { scrubSecrets } from "@/lib/admin/scrub";

export const metadata = { title: "Errors" };

export default async function ErrorsPage({ searchParams }: PageProps<"/admin/errors">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const level = param(sp.level);
  const source = param(sp.source);
  const userId = param(sp.userId);
  const days = param(sp.days) || "7";
  const cursor = param(sp.cursor);
  const since = days === "all" ? undefined : new Date(nowMs() - Number(days) * 86_400_000);
  let page;
  let bad: string | null = null;
  try {
    page = await getErrors({ level: level || undefined, source: source || undefined, userId: userId || undefined, since, cursor: cursor || undefined, limit: 50 });
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    bad = e.message;
  }
  const filtered = Boolean(level || source || userId);
  const next = page?.nextCursor ? `/admin/errors?${new URLSearchParams({ ...(level && { level }), ...(source && { source }), ...(userId && { userId }), days, cursor: page.nextCursor })}` : null;

  return (
    <>
      <PageHeader title="Errors" description="Server-side errors and warnings from the error log, newest first. Secrets are removed before they are saved." />
      <Panel title="Filter">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_9rem_auto]" role="search">
          <Select name="level" defaultValue={level} aria-label="Level"><option value="">All levels</option><option value="error">Errors</option><option value="warn">Warnings</option></Select>
          <Input name="source" defaultValue={source} placeholder="Source, exactly (for example publishing:meta)" aria-label="Source" />
          <Select name="days" defaultValue={days} aria-label="Period"><option value="1">Last day</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></Select>
          <Button type="submit">Filter</Button>
          {userId && <input type="hidden" name="userId" value={userId} />}
        </form>
        {userId && <p className="text-sm text-muted">Only for user {userId}. <Link href="/admin/errors" className="underline">Show all</Link></p>}
      </Panel>
      {bad && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{bad}</p>}
      {page && page.items.length === 0 ? (
        <EmptyState icon={CircleCheck} title={filtered ? "No errors match" : "No errors in this period"} text="Good news, or the filter is too narrow." />
      ) : (
        page && (
          <Panel title={`${page.items.length}${page.nextCursor ? "+" : ""} entries`}>
            <ul className="flex flex-col divide-y divide-line">
              {page.items.map((e) => (
                <li key={e.id} className="py-3 first:pt-0 last:pb-0">
                  <details>
                    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                      <Badge tone={e.level === "error" ? "danger" : "neutral"}>{e.level}</Badge>
                      <code className="font-mono text-[13px]">{e.source}</code>
                      <span className="min-w-0 flex-1 truncate text-[14px]">{scrubSecrets(e.message, 300)}</span>
                      <span className="text-xs text-muted">{dateTime(e.createdAt)}</span>
                    </summary>
                    <div className="mt-2 flex flex-col gap-2 text-[13px]">
                      <p className="break-words">{scrubSecrets(e.message, 1000)}</p>
                      {e.userId && <p>User: <Link href={`/admin/users/${e.userId}`} className="underline">{e.userId}</Link></p>}
                      {e.context != null && <pre className="max-h-64 overflow-auto rounded-xl bg-soft p-3 font-mono text-xs">{scrubSecrets(JSON.stringify(e.context, null, 2), 4000)}</pre>}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            {next && <Button href={next} variant="outline" className="self-start">Older</Button>}
          </Panel>
        )
      )}
    </>
  );
}
