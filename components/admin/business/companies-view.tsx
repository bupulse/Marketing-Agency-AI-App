// Admin -> Clients -> Companies: search, filter chips (status, plan) and the list (a table on a computer, cards on a
// phone). Plain data in, so the page and the dev preview render the same thing.
import { Building2, Users } from "lucide-react";
import { DataList, EmptyState, FilterChips, PageHeader, StatusPill, type SearchParamsLike } from "@/components/admin/kit";
import { Button } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { MoreLink, SearchBox, subStatus } from "./shared";

export type CompanyItem = { id: string; name: string; ownerEmail: string | null; plan: string | null; status: string | null; suspended: boolean; seatsUsed: number; lastActiveAt: Date | string | null };

const STATUS_CHIPS = [
  { value: "", label: "Everyone" },
  { value: "ACTIVE", label: "Paying" },
  { value: "TRIALING", label: "On trial" },
  { value: "PENDING_DEMO", label: "Waiting for demo" },
  { value: "PAST_DUE", label: "Payment late" },
  { value: "CANCELED", label: "Cancelled" },
  { value: "EXPIRED", label: "Expired" },
];
export const COMPANY_STATUSES = STATUS_CHIPS.map((c) => c.value).filter(Boolean);

const day = (d: Date | string) => dateTime(d).replace(/, \d\d:\d\d.*/, "");

export function CompaniesView({
  items,
  plans,
  q,
  plan,
  status,
  sp,
  next,
  bad,
  base = "/admin/companies",
}: {
  items: CompanyItem[];
  plans: { key: string; name: string }[];
  q: string;
  plan: string;
  status: string;
  sp: SearchParamsLike;
  next: string | null;
  bad: string | null;
  base?: string;
}) {
  const filtered = Boolean(q || plan || status);
  return (
    <>
      <PageHeader icon={Building2} tone="blue" title="Companies" description="Every company, newest first. Tap one to see its people, plan, usage and the actions you can take." />
      <section aria-label="Find a company" className="flex flex-col gap-3">
        <SearchBox q={q} placeholder="Company or email" keep={{ plan, status }} label="Search companies" />
        <FilterChips label="Show companies by status" param="status" base={base} params={sp} current={status} options={STATUS_CHIPS} />
        {plans.length > 0 && <FilterChips label="Show companies by plan" param="plan" base={base} params={sp} current={plan} options={[{ value: "", label: "Any plan" }, ...plans.map((p) => ({ value: p.key, label: p.name }))]} />}
      </section>
      {bad ? (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{bad}</p>
      ) : (
        <>
          {items.length > 0 && (
            <p className="px-1 text-[13px] text-muted">
              {items.length}
              {next ? "+" : ""} {items.length === 1 ? "company" : "companies"}
              {filtered ? " match" : ""}. Newest first.
            </p>
          )}
          <DataList<CompanyItem>
            caption="Companies"
            rows={items}
            rowKey={(c) => c.id}
            rowHref={(c) => `/admin/companies/${c.id}`}
            columns={[
              { key: "name", header: "Company", cell: (c) => <span className="block max-w-[16rem] truncate">{c.name}</span>, primary: true },
              { key: "owner", header: "Owner", cell: (c) => (c.ownerEmail ? <span className="block max-w-[15rem] truncate">{c.ownerEmail}</span> : <span className="text-muted">None</span>), hideOnPhone: true },
              { key: "status", header: "Status", cell: (c) => <CompanyStatus c={c} /> },
              { key: "plan", header: "Plan", cell: (c) => c.plan ?? <span className="text-muted">None</span> },
              {
                key: "users",
                header: "People",
                align: "right",
                cell: (c) => (
                  <span className="inline-flex items-center gap-1">
                    <Users aria-hidden className="size-3.5 text-muted" />
                    {c.seatsUsed}
                  </span>
                ),
              },
              { key: "seen", header: "Last active", cell: (c) => (c.lastActiveAt ? day(c.lastActiveAt) : <span className="text-muted">Never</span>) },
            ]}
            empty={
              <EmptyState
                icon={Building2}
                title={filtered ? "No company matches." : "No companies yet."}
                hint={filtered ? "Try another search, or tap Everyone above." : "Companies appear here as people sign up."}
                action={filtered ? <Button href={base} variant="outline" size="sm">Clear the filters</Button> : undefined}
              />
            }
          />
          <MoreLink href={next}>Older companies</MoreLink>
        </>
      )}
    </>
  );
}

function CompanyStatus({ c }: { c: CompanyItem }) {
  if (c.suspended) return <StatusPill tone="bad" dot>Suspended</StatusPill>;
  const s = subStatus(c.status);
  return s ? <StatusPill tone={s.tone} dot>{s.label}</StatusPill> : <span className="text-muted">No plan</span>;
}
