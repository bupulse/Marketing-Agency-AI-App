import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { KeptDataNote } from "@/components/app/kept-data-note";
import { PageHeader } from "@/components/app/page-header";
import { ConnectorsSubNav } from "@/components/connectors/sub-nav";
import { WebhooksManager } from "@/components/connectors/webhooks-manager";
import { listDeliveries, listEndpoints, MAX_ENDPOINTS } from "@/lib/webhooks/endpoints";

export const metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const roleBlocked = await pageGate("webhooks");
  if (roleBlocked) return roleBlocked;
  const { business, entitlements } = await getAppContext();
  const [endpoints, deliveries] = await Promise.all([listEndpoints(business.id), listDeliveries(business.id, 50)]);
  // Webhooks a company already has are its own: without the feature they stay read-only (switch off, delete) with a
  // note on how to add it. Only an empty page is replaced by "Add to your plan".
  const readOnly = !entitlements.usable.has("webhooks");
  if (readOnly && endpoints.length === 0) return featureGate("webhooks");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Webhooks" description="Send new leads, new content and post results to Zapier, Make or your own system, as they happen. On every plan." />
      <ConnectorsSubNav current="webhooks" />
      {readOnly && <KeptDataNote feature="webhooks" label="webhooks" entitlements={entitlements} what="Your webhooks" />}
      <WebhooksManager
        readOnly={readOnly}
        max={MAX_ENDPOINTS}
        endpoints={endpoints.map(({ pausedByAdminAt, ...e }) => ({ ...e, pausedBySupport: Boolean(pausedByAdminAt), createdAt: e.createdAt.toISOString(), lastSuccessAt: e.lastSuccessAt?.toISOString() ?? null, lastFailureAt: e.lastFailureAt?.toISOString() ?? null }))}
        deliveries={deliveries.map((d) => ({ id: d.id, endpointId: d.endpointId, url: d.endpoint.url, event: d.event, status: d.status, attempts: d.attempts, responseStatus: d.responseStatus, error: d.error, nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString() }))}
      />
    </div>
  );
}
