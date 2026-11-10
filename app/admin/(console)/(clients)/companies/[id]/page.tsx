import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { Client360, ClientStatusPill, clientHeader } from "@/components/admin/client360";
import { CompanyUsers } from "@/components/admin/company-users";
import { DemoPanel } from "@/components/admin/demo-panel";
import { CompanyOffers } from "@/components/admin/company-offers";
import { PageHeader } from "@/components/admin/kit";
import { Notices } from "@/components/admin/business/shared";
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
  const overview = !tab || tab === "overview";
  return (
    <>
      <PageHeader
        icon={Building2}
        tone="blue"
        title={company.name}
        description={[company.accountEmail, company.subscription?.plan, `${company.users.length} ${company.users.length === 1 ? "user" : "users"}`].filter(Boolean).join(" · ")}
        back={{ href: "/admin/companies", label: "Companies" }}
        actions={<ClientStatusPill status={h.status} />}
      />
      <Notices sp={sp} />
      <Client360
        userId={company.accountUserId}
        tab={tab}
        basePath={`/admin/companies/${id}`}
        extraTabs={EXTRA_TABS}
        lead={
          <>
            {overview && <DemoPanel businessId={id} back={`/admin/companies/${id}`} />}
            {(overview || tab === "billing") && <CompanyOffers businessId={id} />}
          </>
        }
      />
      {tab === "users" && <CompanyUsers company={company} />}
    </>
  );
}
