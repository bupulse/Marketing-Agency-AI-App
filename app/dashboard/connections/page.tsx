import { Suspense } from "react";
import { cookies } from "next/headers";
import { Plug } from "lucide-react";
import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, Button, GlassCard } from "@/components/ui";
import { CanvaCard } from "@/components/settings/canva-card";
import { isCanvaEnabled } from "@/lib/canva/config";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { prisma } from "@/lib/db";
import { AccountPicker } from "@/components/connections/account-picker";
import { ChannelList } from "@/components/connections/channel-list";
import { ConnectToast } from "@/components/connections/connect-toast";
import type { AccountInfo, ChannelInfo } from "@/components/connections/types";
import { listConnections } from "@/lib/social/connections";
import { openPending } from "@/lib/social/oauth";
import { isInstagramViaFacebookConfigured } from "@/lib/social/providers/instagram";
import { allProviders, isNetwork } from "@/lib/social/registry";

export const metadata = { title: "Channels" };

const APPS = [
  { provider: "canva", name: "Canva", note: "Open and export designs" },
  { provider: "google_drive", name: "Google Drive", note: "Import photos and files" },
  { provider: "dropbox", name: "Dropbox", note: "Import photos and files" },
  { provider: "shopify", name: "Shopify", note: "Import products" },
  { provider: "woocommerce", name: "WooCommerce", note: "Import products" },
  { provider: "cloudflare", name: "Cloudflare", note: "Website and widget setup" },
];

function Group({ title, items, connected }: { title: string; items: typeof APPS; connected: Set<string> }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="px-1 text-lg font-semibold">{title}</h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {items.map((c) => (
          <GlassCard as="li" key={c.provider} className="flex flex-col gap-4 rounded-card p-5">
            <div className="flex items-center gap-3">
              <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white">
                <Plug className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="truncate text-[13px] text-muted">{c.note}</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              {connected.has(c.provider) ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Coming soon</Badge>}
              <Button variant="ghost" size="sm" disabled aria-disabled="true">Connect</Button>
            </div>
          </GlassCard>
        ))}
      </ul>
    </section>
  );
}

const NOTES: Record<string, string> = {
  instagram: "Business, Creator or personal accounts",
  facebook: "Facebook Pages",
  linkedin: "Profiles and Pages",
  tiktok: "Videos",
  youtube: "Videos and Shorts",
};

export default async function ConnectionsPage({ searchParams }: PageProps<"/dashboard/connections">) {
  const blocked = (await pageGate("channels")) ?? (await featureGate("calendar"));
  if (blocked) return blocked;
  const { user, actorId, business } = await getAppContext();
  const social = business ? await listConnections(business.id) : [];
  const apps = business ? await prisma.connection.findMany({ where: { businessId: business.id, kind: "APP" }, select: { provider: true } }) : [];
  const connected = new Set(apps.map((r) => r.provider));

  const channels: ChannelInfo[] = allProviders().map((p) => ({
    network: p.network,
    label: p.rules.label,
    note: NOTES[p.network] ?? "",
    configured: p.isConfigured(),
    viaFacebook: p.network === "instagram" ? isInstagramViaFacebookConfigured() : undefined,
  }));
  const accounts: AccountInfo[] = social.map((a) => ({ id: a.id, network: a.network, displayName: a.displayName, externalAccountId: a.externalAccountId, accountType: a.accountType, avatarUrl: a.avatarUrl, status: a.status, postingMode: a.postingMode }));

  // After OAuth with several accounts, the encrypted cookie holds them until the user picks.
  const pick = (await searchParams).pick;
  const store = await cookies();
  const pending = typeof pick === "string" && isNetwork(pick) ? await openPending((name) => store.get(name)?.value, user.id) : null;
  const picking = pending && pending.network === pick ? pending : null;

  return (
    <>
      <PageHeader
        title="Channels"
        description="Connect your social accounts to publish, and your apps to bring in photos and products."
      />
      <Suspense>
        <ConnectToast />
      </Suspense>
      {picking && (
        <AccountPicker network={picking.network} label={channels.find((c) => c.network === picking.network)?.label ?? ""} accounts={picking.result.accounts} />
      )}
      <section aria-label="Social accounts" className="flex flex-col gap-3">
        <h2 className="px-1 text-lg font-semibold">Social accounts</h2>
        <ChannelList channels={channels} accounts={accounts} />
      </section>
      <Suspense>
        <CanvaReturnToast />
      </Suspense>
      <CanvaCard userId={actorId} next="/dashboard/connections" />
      <Group title="Apps" items={isCanvaEnabled() ? APPS.filter((a) => a.provider !== "canva") : APPS} connected={connected} />
      <GlassCard className="flex flex-wrap items-center gap-3 p-5 text-[15px]">
        <Badge tone="violet">Pro</Badge>
        <p className="min-w-0 flex-1 basis-64 text-muted">
          Advanced: use your own Composio account to connect hundreds more apps. Available on the Pro plan.
        </p>
      </GlassCard>
    </>
  );
}
