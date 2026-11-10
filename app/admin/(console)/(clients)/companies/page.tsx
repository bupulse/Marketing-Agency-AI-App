import { CompaniesView } from "@/components/admin/business/companies-view";
import { listCompanies } from "@/lib/admin/actions/companies";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
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
  const next = nextCursor ? `/admin/companies?${new URLSearchParams({ ...(q && { q }), ...(plan && { plan }), ...(status && { status }), cursor: nextCursor })}` : null;
  return <CompaniesView items={items} plans={plans} q={q} plan={plan} status={status} sp={sp} next={next} bad={bad} />;
}
