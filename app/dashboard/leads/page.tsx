import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { LeadsScreen, alertsSummary } from "@/components/leads/leads-screen";
import { can } from "@/lib/team/roles";
import { blockReason, upgradeHref } from "@/lib/entitlements";
import { PAGE_SIZE, MAX_PAGE_SIZE, parseFilters, type LeadStatusValue } from "@/lib/leads/filters";
import { hasAnyLead, leadSources, listLeads, statusCounts } from "@/lib/leads/service";
import { getNotificationSettings } from "@/lib/leads/settings";
import { whatsappAlertsAvailable } from "@/lib/leads/whatsapp";
import { deviceEndpoints, pushPublicKey } from "@/lib/push/service";

export const metadata = { title: "Leads" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const { business, role, entitlements, actorId } = await getAppContext();
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

  const canSettings = can(role, "settings");
  const settings = chatOn && canSettings ? await getNotificationSettings(business.id) : null;
  // Push needs VAPID keys; WhatsApp needs the admin to offer it (Admin -> Services). Both are set on the alerts page.
  const pushKey = chatOn ? pushPublicKey() : null;
  const [devices, whatsappOn] = await Promise.all([pushKey ? deviceEndpoints(business.id, actorId) : [], settings ? whatsappAlertsAvailable() : false]);
  const [list, counts, sources] = any
    ? await Promise.all([listLeads(business.id, filters, limit), statusCounts(business.id, filters), leadSources(business.id)])
    : [null, null, null];

  return (
    <LeadsScreen
      chatOn={chatOn}
      inPlan={entitlements.inPlan.has("websiteChat")}
      addChatHref={upgradeHref("websiteChat", blockReason(entitlements, "websiteChat"))}
      inbox={
        list && counts && sources
          ? {
              readOnly: !chatOn,
              leads: list.leads.map((l) => ({ ...l, status: l.status as LeadStatusValue, createdAt: l.createdAt.toISOString() })),
              total: list.total,
              hasMore: list.hasMore,
              limit,
              counts,
              sources,
              filters,
              initialOpenId: lead ?? null,
            }
          : null
      }
      alerts={
        settings || (pushKey && chatOn)
          ? { summary: alertsSummary({ instant: settings?.notifyInstant ?? false, daily: settings?.notifyDaily ?? false, whatsapp: whatsappOn && (settings?.notifyWhatsapp ?? false), devices: devices.length }) }
          : null
      }
    />
  );
}
