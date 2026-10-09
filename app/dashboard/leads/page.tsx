import { Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { LeadsInbox } from "@/components/leads/leads-inbox";
import { can } from "@/lib/team/roles";
import { NotificationsCard } from "@/components/leads/notifications-card";
import { Button } from "@/components/ui";
import { PAGE_SIZE, MAX_PAGE_SIZE, parseFilters, type LeadStatusValue } from "@/lib/leads/filters";
import { hasAnyLead, leadSources, listLeads, statusCounts } from "@/lib/leads/service";
import { getNotificationSettings } from "@/lib/leads/settings";

export const metadata = { title: "Leads" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await featureGate("websiteChat");
  if (blocked) return blocked;
  const { business, email, role } = await getAppContext();
  const params = await searchParams;
  const filters = parseFilters(params);
  const requested = Number(Array.isArray(params.limit) ? params.limit[0] : params.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.ceil(requested), MAX_PAGE_SIZE) : PAGE_SIZE;
  const lead = Array.isArray(params.lead) ? params.lead[0] : params.lead;

  const [any, settings] = await Promise.all([hasAnyLead(business.id), getNotificationSettings(business.id)]);
  const [list, counts, sources] = any
    ? await Promise.all([listLeads(business.id, filters, limit), statusCounts(business.id, filters), leadSources(business.id)])
    : [null, null, null];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Leads" description="People who got in touch through your website chat. New ones appear here within seconds." />
      {list && counts && sources ? (
        <LeadsInbox
          leads={list.leads.map((l) => ({ ...l, status: l.status as LeadStatusValue, createdAt: l.createdAt.toISOString() }))}
          total={list.total}
          hasMore={list.hasMore}
          limit={limit}
          counts={counts}
          sources={sources}
          filters={filters}
          initialOpenId={lead ?? null}
        />
      ) : (
        <EmptyState
          icon={Users}
          title="No leads yet"
          text="Leads arrive when a visitor chats with the BuPulse widget on your website and leaves their details. Each one shows up here and in your email."
          points={["Add the chat widget to your website", "It answers from the facts you gave it, then asks for contact details", "You get an email, and can follow up from this page"]}
          action={<Button href="/dashboard/widget">Set up website chat</Button>}
        />
      )}
      {can(role, "settings") && <NotificationsCard initial={settings} email={email} />}
    </div>
  );
}
