import type { ReactNode } from "react";
import { Boxes, Share2 } from "lucide-react";
import { FilterChips, KitStyles, PageHeader, StatusPill } from "@/components/admin/kit";
import { CARD } from "@/components/admin/kit/tones";
import { BGroupTitle } from "@/components/app/kit/b-cards";
import { ChannelList } from "@/components/connections/channel-list";
import type { AccountInfo, ChannelInfo } from "@/components/connections/types";
import { ConnectorCard } from "@/components/connectors/connector-card";
import type { CatalogItem } from "@/lib/connectors/catalog";

export type ConnectionsTab = "social" | "apps";

/**
 * /dashboard/connections (Channels): two tabs, social accounts (where BuPulse publishes) and apps (photos, designs,
 * products), so one screen shows one kind. `picker` (the account chooser after a network sign-in), the toasts and the
 * Canva card are passed in as they are. Presentational.
 */
export function ConnectionsView({
  tab,
  base = "/dashboard/connections",
  params,
  channels,
  accounts,
  apps,
  picker,
  canva,
  toasts,
}: {
  tab: ConnectionsTab;
  base?: string;
  params?: Record<string, string | string[] | undefined>;
  channels: ChannelInfo[];
  accounts: AccountInfo[];
  apps: CatalogItem[];
  picker?: ReactNode;
  canva?: ReactNode;
  toasts?: ReactNode;
}) {
  const networksOn = new Set(accounts.map((a) => a.network)).size;
  const appsOn = apps.filter((a) => a.status.state === "connected").length;
  const broken = accounts.filter((a) => a.status !== "ACTIVE" && a.postingMode !== "NOTIFY").length;
  return (
    <>
      <KitStyles />
      <PageHeader
        icon={Share2}
        title="Channels"
        description="Connect your social accounts to publish, and your apps to bring in photos and products."
        actions={broken > 0 ? <StatusPill tone="bad" dot>{broken === 1 ? "1 account needs you" : `${broken} accounts need you`}</StatusPill> : undefined}
      />
      {toasts}
      {picker}
      <FilterChips
        label="Show"
        param="show"
        base={base}
        params={params}
        current={tab}
        allValue="social"
        options={[
          { value: "social", label: "Social accounts", icon: Share2, count: networksOn },
          { value: "apps", label: "Apps", icon: Boxes, count: appsOn },
        ]}
      />
      {tab === "social" ? (
        <section aria-labelledby="social-title" className="flex flex-col gap-3">
          <BGroupTitle id="social-title" title="Social accounts" hint={`${networksOn} of ${channels.length} networks connected. BuPulse posts to these at the times you choose.`} />
          <ChannelList channels={channels} accounts={accounts} />
        </section>
      ) : (
        <section aria-labelledby="apps-heading" className="flex flex-col gap-3">
          <BGroupTitle id="apps-heading" title="Apps" hint="Bring photos, designs and products into BuPulse." />
          {canva}
          <ul className="kit-rise grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
            {apps.map((item) => (
              <ConnectorCard key={item.id} item={item} />
            ))}
          </ul>
          <div className={`${CARD} flex flex-wrap items-center gap-3 p-4 text-[14px] sm:p-5`}>
            <StatusPill tone="new">Pro</StatusPill>
            <p className="min-w-0 flex-1 basis-64 text-muted">Advanced: use your own Composio account to connect hundreds more apps. Available on the Pro plan.</p>
          </div>
        </section>
      )}
    </>
  );
}
