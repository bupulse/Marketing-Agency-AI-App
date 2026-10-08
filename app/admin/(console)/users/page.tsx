import { requireAdmin } from "@/lib/admin/auth";
import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { Panel, TableWrap, Td, Th } from "@/components/admin/ui";
import { Badge, Button, Input, Select } from "@/components/ui";
import { dateTime, param } from "@/lib/admin/format";
import { AdminError, listUsers } from "@/lib/admin/service";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const q = param(sp.q);
  const plan = param(sp.plan);
  const status = param(sp.status);
  const cursor = param(sp.cursor);
  const suspended = param(sp.suspended);
  let items: Awaited<ReturnType<typeof listUsers>>["items"] = [];
  let nextCursor: string | null = null;
  let bad: string | null = null;
  try {
    ({ items, nextCursor } = await listUsers({ q, plan, status, cursor: cursor || undefined, suspended: suspended === "1" ? true : undefined, limit: 25 }));
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    bad = e.message;
  }
  const filtered = Boolean(q || plan || status || suspended);
  const next = nextCursor ? `/admin/users?${new URLSearchParams({ ...(q && { q }), ...(plan && { plan }), ...(status && { status }), ...(suspended && { suspended }), cursor: nextCursor })}` : null;

  return (
    <>
      <PageHeader title="Users and businesses" description="Every account, newest first. Open one to see usage and take action." />
      <Panel title="Find a user">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_9rem_9rem_auto]" role="search">
          <Input name="q" defaultValue={q} placeholder="Email, name or business" aria-label="Search" />
          <Select name="plan" defaultValue={plan} aria-label="Plan">
            <option value="">Any plan</option><option value="TRIAL">Trial</option><option value="STANDARD">Standard</option><option value="PRO">Pro</option>
          </Select>
          <Select name="status" defaultValue={status} aria-label="Subscription status">
            <option value="">Any status</option><option value="TRIALING">Trialing</option><option value="ACTIVE">Active</option><option value="PAST_DUE">Past due</option><option value="CANCELED">Canceled</option><option value="EXPIRED">Expired</option>
          </Select>
          <Select name="suspended" defaultValue={suspended} aria-label="Suspension">
            <option value="">All accounts</option><option value="1">Suspended only</option>
          </Select>
          <Button type="submit">Search</Button>
        </form>
      </Panel>
      {bad && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{bad}</p>}
      {!bad && items.length === 0 ? (
        <EmptyState icon={Users} title={filtered ? "No users match" : "No users yet"} text={filtered ? "Try a different search or clear the filters." : "Accounts appear here as people sign up."} action={filtered ? <Button href="/admin/users" variant="outline">Clear filters</Button> : undefined} />
      ) : bad ? null : (
        <Panel title={`${items.length}${nextCursor ? "+" : ""} users`}>
          <TableWrap caption="Users">
            <thead><tr><Th>User</Th><Th>Business</Th><Th>Plan</Th><Th>Status</Th><Th>Joined</Th></tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <Td className="max-w-[16rem]"><Link href={`/admin/users/${u.id}`} className="block truncate font-medium underline">{u.email}</Link>{u.name && <span className="block truncate text-xs text-muted">{u.name}</span>}</Td>
                  <Td className="max-w-[12rem] truncate">{u.business?.name ?? <span className="text-muted">Not set up</span>}</Td>
                  <Td>{u.plan ?? "none"} {u.subscriptionStatus && <span className="text-xs text-muted">{u.subscriptionStatus.toLowerCase()}</span>}</Td>
                  <Td>{u.status === "active" ? <Badge tone="success">Active</Badge> : u.status === "suspended" ? <Badge tone="danger">Suspended</Badge> : <Badge tone="neutral">Deleting</Badge>}</Td>
                  <Td className="whitespace-nowrap">{dateTime(u.createdAt).replace(/, \d\d:\d\d.*/, "")}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {next && <Button href={next} variant="outline" className="self-start">Older users</Button>}
        </Panel>
      )}
    </>
  );
}
