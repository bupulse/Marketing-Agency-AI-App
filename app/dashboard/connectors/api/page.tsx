import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { KeptDataNote } from "@/components/app/kept-data-note";
import { PageHeader } from "@/components/app/page-header";
import { ApiKeysManager } from "@/components/connectors/api-keys-manager";
import { ConnectorsSubNav } from "@/components/connectors/sub-nav";
import { businessHasApiAccess } from "@/lib/api/auth";
import { listApiKeys, MAX_API_KEYS } from "@/lib/api/keys";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  // The role first, then the plan. Keys a company already has are its own: without the feature they stay read-only
  // (revoke) with a note on how to add it. Only a page with no keys is replaced by "Add to your plan".
  const roleBlocked = await pageGate("webhooks");
  if (roleBlocked) return roleBlocked;
  const { business, entitlements } = await getAppContext();
  const [allowed, keys] = await Promise.all([businessHasApiAccess(business.id), listApiKeys(business.id)]);
  const readOnly = !entitlements.usable.has("apiAccess");
  if (readOnly && keys.length === 0) return featureGate("apiAccess");
  const active = keys.filter((k) => !k.revokedAt).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="API keys" description="Let your own tools and scripts read your projects, content, posts and leads, and update leads." />
      <ConnectorsSubNav current="api" />
      {readOnly && <KeptDataNote feature="apiAccess" label="API access" entitlements={entitlements} what="Your API keys" />}
      {!readOnly && !allowed && (
        // The plan has the API but the subscription is not active (past due, cancelled): the keys are paused, not deleted.
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">
          Your subscription is not active, so your API keys are paused.{active > 0 ? ` Your ${active} existing ${active === 1 ? "key starts" : "keys start"} working again once it is.` : ""}
        </p>
      )}
      <ApiKeysManager
        readOnly={readOnly}
        max={MAX_API_KEYS}
        keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))}
      />
    </div>
  );
}
