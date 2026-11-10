import Link from "next/link";
import { ChevronDown, CircleCheck, ScrollText, Search, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { CARD, EmptyState, ExpandCard, FilterChips, PageHeader, StatusPill, type SearchParamsLike } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { Button, Input } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { diffJson, show } from "@/lib/admin/diff";
import { scrubSecrets } from "@/lib/admin/scrub";

/** One log entry that opens to show its details (a native <details>: works on tap and keyboard, no script). */
function Entry({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2 hover:bg-soft/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 [&::-webkit-details-marker]:hidden">
          {summary}
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="flex flex-col gap-2 px-2 pb-3 pt-1 text-[13px]">{children}</div>
      </details>
    </li>
  );
}

function List({ title, children, next }: { title: string; children: React.ReactNode; next: string | null }) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-2 p-3 sm:p-4", CARD)}>
      <h2 className="px-2 pt-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{title}</h2>
      <ul className="flex flex-col divide-y divide-line">{children}</ul>
      {next && (
        <Button href={next} variant="outline" size="sm" className="self-start">
          Older
        </Button>
      )}
    </section>
  );
}

export type ErrorEntry = { id: string; createdAt: Date | string; level: string; source: string; message: string; userId: string | null; context: unknown };

/** Admin -> Errors: level and period as chips, an exact source search, and entries that open for details. */
export function ErrorsView({ items, more, next, f, sp, bad }: { items: ErrorEntry[] | null; more: boolean; next: string | null; f: { level: string; source: string; userId: string; days: string }; sp: SearchParamsLike; bad: string | null }) {
  const filtered = Boolean(f.level || f.source || f.userId);
  return (
    <>
      <PageHeader icon={TriangleAlert} tone="slate" title="Errors" description="What went wrong on the server, newest first. Secrets are removed before anything is saved." />
      <div className="flex flex-col gap-2">
        <FilterChips label="Kind" param="level" base="/admin/errors" params={sp} current={f.level} options={[{ value: "", label: "Errors and warnings" }, { value: "error", label: "Errors" }, { value: "warn", label: "Warnings" }]} />
        <FilterChips label="Period" param="days" base="/admin/errors" params={sp} current={f.days} allValue="7" options={[{ value: "1", label: "Last day" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "all", label: "All time" }]} />
      </div>
      <form role="search" className="flex flex-wrap items-center gap-2">
        {f.level && <input type="hidden" name="level" value={f.level} />}
        {f.days !== "7" && <input type="hidden" name="days" value={f.days} />}
        {f.userId && <input type="hidden" name="userId" value={f.userId} />}
        <Input name="source" defaultValue={f.source} placeholder="Source, exactly (for example publishing:meta)" aria-label="Source" className="min-w-0 max-w-md flex-1" />
        <Button type="submit" size="sm" variant="outline">
          <Search aria-hidden className="size-4" /> Find
        </Button>
        {f.source && (
          <Link href="/admin/errors" className="text-[13px] font-semibold underline">
            Clear
          </Link>
        )}
      </form>
      {f.userId && (
        <p className={notice.info}>
          Only for user {f.userId}.{" "}
          <Link href="/admin/errors" className="underline">
            Show all
          </Link>
        </p>
      )}
      {bad && <p role="alert" className={notice.bad}>{bad}</p>}
      {items && items.length === 0 ? (
        <EmptyState icon={CircleCheck} tone="good" title={filtered ? "No errors match." : "No errors in this period."} hint="Good news, or the filter is too narrow." />
      ) : (
        items && (
          <List title={`${items.length}${more ? "+" : ""} entries`} next={next}>
            {items.map((e) => (
              <Entry
                key={e.id}
                summary={
                  <>
                    <StatusPill tone={e.level === "error" ? "bad" : "warn"} dot>
                      {e.level === "error" ? "Error" : "Warning"}
                    </StatusPill>
                    <code className="font-mono text-[12.5px]">{e.source}</code>
                    <span className="min-w-0 flex-1 basis-full truncate text-[14px] sm:basis-auto">{scrubSecrets(e.message, 300)}</span>
                    <span className="text-[12px] text-muted">{dateTime(e.createdAt)}</span>
                  </>
                }
              >
                <p className="break-words">{scrubSecrets(e.message, 1000)}</p>
                {e.userId && (
                  <p>
                    User:{" "}
                    <Link href={`/admin/users/${e.userId}`} className="underline">
                      {e.userId}
                    </Link>
                  </p>
                )}
                {e.context != null && <pre className="max-h-64 overflow-auto rounded-xl bg-soft p-3 font-mono text-xs">{scrubSecrets(JSON.stringify(e.context, null, 2), 4000)}</pre>}
              </Entry>
            ))}
          </List>
        )
      )}
    </>
  );
}

export type AuditEntry = { id: string; createdAt: Date | string; actor: string; action: string; target: string | null; ip: string | null; before: unknown; after: unknown };

/** Admin -> Audit log: entries that open for what changed; the search is folded away until needed. */
export function AuditView({ items, more, next, f, bad }: { items: AuditEntry[] | null; more: boolean; next: string | null; f: { actor: string; action: string; target: string; since: string; until: string }; bad: string | null }) {
  const filtered = Boolean(f.actor || f.action || f.target || f.since || f.until);
  return (
    <>
      <PageHeader icon={ScrollText} tone="slate" title="Audit log" description="Every admin action, from this console and from Jarvis, with what changed. Entries cannot be edited or deleted." />
      <ExpandCard icon={Search} tone="slate" title="Search the log" summary={filtered ? "Filtered: clear the boxes to see everything." : "By who, what, which record or dates."} defaultOpen={filtered}>
        <form role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input name="actor" defaultValue={f.actor} placeholder="Who: admin or jarvis:…" aria-label="Who did it (actor)" />
          <Input name="action" defaultValue={f.action} placeholder="What: extend_trial" aria-label="What was done (action)" />
          <Input name="target" defaultValue={f.target} placeholder="Record: user:…" aria-label="Which record (target)" />
          <Input name="since" type="date" defaultValue={f.since} aria-label="From date" />
          <Input name="until" type="date" defaultValue={f.until} aria-label="To date" />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm">Search</Button>
            {filtered && (
              <Link href="/admin/audit" className="text-[13px] font-semibold underline">
                Clear
              </Link>
            )}
          </div>
        </form>
      </ExpandCard>
      {bad && <p role="alert" className={notice.bad}>{bad}</p>}
      {items && items.length === 0 ? (
        <EmptyState icon={ScrollText} title={filtered ? "No entries match." : "Nothing logged yet."} hint="Actions appear here the moment they happen." />
      ) : (
        items && (
          <List title={`${items.length}${more ? "+" : ""} entries`} next={next}>
            {items.map((e) => {
              const rows = diffJson(e.before, e.after);
              const userId = e.target?.startsWith("user:") ? e.target.slice(5) : null;
              return (
                <Entry
                  key={e.id}
                  summary={
                    <>
                      <StatusPill tone={e.actor === "admin" ? "info" : "new"} dot>
                        {e.actor === "admin" ? "You" : e.actor.startsWith("jarvis") ? "Jarvis" : e.actor}
                      </StatusPill>
                      <code className="font-mono text-[12.5px]">{e.action}</code>
                      <span className="min-w-0 flex-1 truncate text-[14px] text-muted">{e.target ?? ""}</span>
                      <span className="text-[12px] text-muted">{dateTime(e.createdAt)}</span>
                    </>
                  }
                >
                  <p className="text-muted">
                    Actor {e.actor}
                    {e.ip ? ` · IP ${e.ip}` : ""}
                    {userId && (
                      <>
                        {" · "}
                        <Link href={`/admin/users/${userId}`} className="underline">
                          open user
                        </Link>
                      </>
                    )}
                  </p>
                  {rows.length === 0 ? (
                    <p className="text-muted">No before or after values were recorded.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {rows.map((r) => (
                        <li key={r.path} className="rounded-xl bg-soft px-3 py-2">
                          <span className="block font-mono text-[12px] font-semibold">{r.path}</span>
                          <span className="block break-all text-danger">
                            <span className="sr-only">Before: </span>
                            <span aria-hidden>− </span>
                            {show(r.before)}
                          </span>
                          <span className="block break-all text-success">
                            <span className="sr-only">After: </span>
                            <span aria-hidden>+ </span>
                            {show(r.after)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Entry>
              );
            })}
          </List>
        )
      )}
    </>
  );
}
