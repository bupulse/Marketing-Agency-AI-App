import { Lock } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { ApiKeysManager } from "@/components/connectors/api-keys-manager";
import { ConnectorsSubNav } from "@/components/connectors/sub-nav";
import { Badge, Button, GlassCard } from "@/components/ui";
import { businessHasApiAccess } from "@/lib/api/auth";
import { listApiKeys, MAX_API_KEYS } from "@/lib/api/keys";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const { business } = await getAppContext();
  const [allowed, keys] = await Promise.all([businessHasApiAccess(business.id), listApiKeys(business.id)]);
  const active = keys.filter((k) => !k.revokedAt).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="API keys" description="Let your own tools and scripts read your projects, content, posts and leads, and update leads." />
      <ConnectorsSubNav current="api" />
      {!allowed && (
        <GlassCard className="flex flex-col gap-3 rounded-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-2xl bg-soft text-pulse-blue">
              <Lock className="size-5" />
            </span>
            <h2 className="text-lg font-semibold">The API is part of the Pro plan</h2>
            <Badge tone="violet">Pro</Badge>
          </div>
          <p className="text-[15px] text-muted">
            Upgrade to Pro to create API keys.{active > 0 ? ` Your ${active} existing ${active === 1 ? "key is" : "keys are"} paused and start working again if you upgrade.` : ""}
          </p>
          <div>
            <Button href="/dashboard/billing">See plans</Button>
          </div>
        </GlassCard>
      )}
      {allowed && (
        <ApiKeysManager
          max={MAX_API_KEYS}
          keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))}
        />
      )}
    </div>
  );
}
