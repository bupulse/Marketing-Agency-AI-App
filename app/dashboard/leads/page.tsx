import { Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { LeadsInbox } from "@/components/leads/leads-inbox";
import { can } from "@/lib/team/roles";
import { NotificationsCard } from "@/components/leads/notifications-card";
import { Button, GlassCard } from "@/components/ui";
import { blockReason, upgradeHref } from "@/lib/entitlements";
import { PAGE_SIZE, MAX_PAGE_SIZE, parseFilters, type LeadStatusValue } from "@/lib/leads/filters";
import { hasAnyLead, leadSources, listLeads, statusCounts } from "@/lib/leads/service";
import { getNotificationSettings } from "@/lib/leads/settings";

export const metadata = { title: "Leads" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const { business, email, role, entitlements } = await getAppContext();
  // Website chat is a plan feature, but the leads a company already has are its own data: without the feature the
  // inbox stays open read-only (look, export, delete) with a note on how to add it. Only an empty inbox is replaced.
  const chatOn = entitlements.usable.has("websiteChat");
  const any = await hasAnyLead(business.id);
  if (!chatOn && !any) return featureGate("websiteChat");
  const params = await searchParams;
  const filters = parseFilters(params);
  const requested = Number(Array.isArray(params.limit) ? params.limit[0] : params.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.ceil(requested), MAX_PAGE_SIZE) : PAGE_SIZE;
  const lead = Array.isArray(params.lead) ? params.lead[0] : params.lead;

  const settings = chatOn ? await getNotificationSettings(business.id) : null;
  const [list, counts, sources] = any
    ? await Promise.all([listLeads(business.id, filters, limit), statusCounts(business.id, filters), leadSources(business.id)])
    : [null, null, null];
  const inPlan = entitlements.inPlan.has("websiteChat");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Leads" description="People who got in touch through your website chat. New ones appear here within seconds." />
      {!chatOn && (
        <GlassCard role="note" className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-[14px]">
            {inPlan
              ? "Website chat is paused for a short while. Your leads stay here to look at, export or delete; status and notes can be changed again once it is back."
              : "Website chat is not part of your plan. Your leads stay here to look at, export or delete; add website chat to collect new ones and work them."}
          </p>
          {!inPlan && (
            <Button href={upgradeHref("websiteChat", blockReason(entitlements, "websiteChat"))} size="sm">
              Add website chat
            </Button>
          )}
        </GlassCard>
      )}
      {list && counts && sources ? (
        <LeadsInbox
          readOnly={!chatOn}
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
      {settings && can(role, "settings") && <NotificationsCard initial={settings} email={email} />}
    </div>
  );
}
