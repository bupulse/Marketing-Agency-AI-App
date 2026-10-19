import { Suspense } from "react";
import { cookies } from "next/headers";
import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, GlassCard } from "@/components/ui";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { getCatalog } from "@/lib/connectors/catalog";
import { CanvaCard } from "@/components/settings/canva-card";
import { isCanvaEnabled } from "@/lib/canva/config";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { AccountPicker } from "@/components/connections/account-picker";
import { ChannelList } from "@/components/connections/channel-list";
import { ConnectToast } from "@/components/connections/connect-toast";
import type { AccountInfo, ChannelInfo } from "@/components/connections/types";
import { listConnections } from "@/lib/social/connections";
import { openPending } from "@/lib/social/oauth";
import { isInstagramViaFacebookConfigured } from "@/lib/social/providers/instagram";
import { allProviders, isNetwork } from "@/lib/social/registry";
import { viaComposio } from "@/lib/social/composio/client";
import { isServiceEnabled } from "@/lib/admin/switch";
import { inboxStates } from "@/lib/social/inbox/accounts";

export const metadata = { title: "Channels" };

const NOTES: Record<string, string> = {
  instagram: "Business and Creator accounts",
  facebook: "Facebook Pages",
  linkedin: "Profiles and Pages",
  tiktok: "Videos",
  youtube: "Videos and Shorts",
};

export default async function ConnectionsPage({ searchParams }: PageProps<"/dashboard/connections">) {
  const blocked = (await pageGate("channels")) ?? (await featureGate("calendar"));
  if (blocked) return blocked;
  const { user, actorId, business, entitlements } = await getAppContext();
  const social = business ? await listConnections(business.id) : [];
  // The apps are the connectors' real state (lib/connectors/catalog.ts): Connect where it works, "Coming soon" only
  // where BuPulse's own keys are not set, "Add to your plan" where the plan lacks the feature. Canva has its own card above.
  const apps = business ? (await getCatalog({ userId: actorId, businessId: business.id, features: entitlements.inPlan })).filter((a) => a.id !== "canva" || !isCanvaEnabled()) : [];

  // BuPulse-Socials (Composio) replaces BuPulse's own apps where it is on; switched off in Admin -> Services, those
  // networks fall back to their own apps (or "Coming soon" when those are not set up).
  const composioOn = await isServiceEnabled("composio");
  const channels: ChannelInfo[] = allProviders().map((p) => {
    const composio = composioOn && viaComposio(p.network);
    return {
      network: p.network,
      label: p.rules.label,
      note: NOTES[p.network] ?? "",
      configured: composio || p.isConfigured(),
      viaFacebook: p.network === "instagram" && !composio ? isInstagramViaFacebookConfigured() : undefined,
      viaComposio: composio || undefined,
    };
  });
  // Instagram and Facebook accounts carry the "Answer comments and messages" switch (lib/social/inbox/accounts.ts).
  const inbox = business ? await inboxStates(business.id) : {};
  const accounts: AccountInfo[] = social.map((a) => ({ id: a.id, network: a.network, displayName: a.displayName, externalAccountId: a.externalAccountId, accountType: a.accountType, avatarUrl: a.avatarUrl, status: a.status, postingMode: a.postingMode, inbox: inbox[a.id] }));

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
      <section aria-labelledby="apps-heading" className="flex flex-col gap-3">
        <h2 id="apps-heading" className="px-1 text-lg font-semibold">Apps</h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
          {apps.map((item) => (
            <ConnectorCard key={item.id} item={item} />
          ))}
        </ul>
      </section>
      <GlassCard className="flex flex-wrap items-center gap-3 p-5 text-[15px]">
        <Badge tone="violet">Pro</Badge>
        <p className="min-w-0 flex-1 basis-64 text-muted">
          Advanced: use your own Composio account to connect hundreds more apps. Available on the Pro plan.
        </p>
      </GlassCard>
    </>
  );
}
