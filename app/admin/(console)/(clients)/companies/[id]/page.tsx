import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { Client360, clientHeader } from "@/components/admin/client360";
import { CompanyUsers } from "@/components/admin/company-users";
import { DemoPanel } from "@/components/admin/demo-panel";
import { CompanyOffers } from "@/components/admin/company-offers";
import { notice } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { getCompany } from "@/lib/admin/actions/companies";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/service";

export const metadata = { title: "Company" };

const EXTRA_TABS = [{ key: "users", label: "Users" }];

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("clients.view"); // pages render alongside the layout, so check here too
  const { id } = await params;
  const sp = await searchParams;
  let company;
  let h;
  try {
    company = await getCompany(id);
    h = await clientHeader(company.accountUserId);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  const tab = param(sp.tab);
  return (
    <>
      <PageHeader
        title={company.name}
        description={[company.accountEmail, company.subscription?.plan, `${company.users.length} ${company.users.length === 1 ? "user" : "users"}`].filter(Boolean).join(" · ")}
        action={<Badge tone={h.tone}>{h.status}</Badge>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {(!tab || tab === "overview") && <DemoPanel businessId={id} back={`/admin/companies/${id}`} />}
      {(!tab || tab === "overview" || tab === "billing") && <CompanyOffers businessId={id} />}
      <Client360 userId={company.accountUserId} tab={tab} basePath={`/admin/companies/${id}`} extraTabs={EXTRA_TABS} />
      {tab === "users" && <CompanyUsers company={company} />}
    </>
  );
}
