import Link from "next/link";
import { Building2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { Panel, TableWrap, Td, Th } from "@/components/admin/ui";
import { Badge, Button, Input, Select } from "@/components/ui";
import { listCompanies } from "@/lib/admin/actions/companies";
import { requirePermission } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/service";
import { getPlans } from "@/lib/plan-catalog";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("clients.view"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const q = param(sp.q);
  const plan = param(sp.plan);
  const status = param(sp.status);
  const cursor = param(sp.cursor);
  const plans = await getPlans();
  let items: Awaited<ReturnType<typeof listCompanies>>["items"] = [];
  let nextCursor: string | null = null;
  let bad: string | null = null;
  try {
    ({ items, nextCursor } = await listCompanies({ q, plan, status, cursor: cursor || undefined, limit: 25 }));
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    bad = e.message;
  }
  const filtered = Boolean(q || plan || status);
  const next = nextCursor ? `/admin/companies?${new URLSearchParams({ ...(q && { q }), ...(plan && { plan }), ...(status && { status }), cursor: nextCursor })}` : null;

  return (
    <>
      <PageHeader title="Companies" description="Every company, newest first. Open one to see its users, usage and actions." />
      <Panel title="Find a company">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_9rem_auto]" role="search">
          <Input name="q" defaultValue={q} placeholder="Company, or any user's email" aria-label="Search" />
          <Select name="plan" defaultValue={plan} aria-label="Plan">
            <option value="">Any plan</option>{plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </Select>
          <Select name="status" defaultValue={status} aria-label="Subscription status">
            <option value="">Any status</option><option value="PENDING_DEMO">Waiting for demo</option><option value="TRIALING">Trialing</option><option value="ACTIVE">Active</option><option value="PAST_DUE">Past due</option><option value="CANCELED">Canceled</option><option value="EXPIRED">Expired</option>
          </Select>
          <Button type="submit">Search</Button>
        </form>
      </Panel>
      {bad && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{bad}</p>}
      {!bad && items.length === 0 ? (
        <EmptyState icon={Building2} title={filtered ? "No companies match" : "No companies yet"} text={filtered ? "Try a different search or clear the filters." : "Companies appear here as people sign up."} action={filtered ? <Button href="/admin/companies" variant="outline">Clear filters</Button> : undefined} />
      ) : bad ? null : (
        <Panel title={`${items.length}${nextCursor ? "+" : ""} companies`}>
          <TableWrap caption="Companies">
            <thead><tr><Th>Company</Th><Th>Owner</Th><Th>Plan</Th><Th>Status</Th><Th right>Users</Th><Th>Last active</Th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <Td className="max-w-[14rem]"><Link href={`/admin/companies/${c.id}`} className="block truncate font-medium underline">{c.name}</Link></Td>
                  <Td className="max-w-[14rem] truncate">{c.ownerEmail ?? <span className="text-muted">None</span>}</Td>
                  <Td>{c.plan ?? "none"}</Td>
                  <Td>{c.suspended ? <Badge tone="danger">Suspended</Badge> : c.status ? <Badge tone={c.status === "ACTIVE" ? "success" : "neutral"}>{c.status.toLowerCase()}</Badge> : <span className="text-muted">none</span>}</Td>
                  <Td right>{c.seatsUsed}</Td>
                  <Td className="whitespace-nowrap">{c.lastActiveAt ? dateTime(c.lastActiveAt).replace(/, \d\d:\d\d.*/, "") : <span className="text-muted">Never</span>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {next && <Button href={next} variant="outline" className="self-start">Older companies</Button>}
        </Panel>
      )}
    </>
  );
}
