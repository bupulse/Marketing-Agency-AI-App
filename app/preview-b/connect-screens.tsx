// Made-up data for the client preview's connection screens (Channels, Connectors, Stores, Domains, Upgrade).
import type { ReactNode } from "react";
import { AddToPlan } from "@/components/app/add-to-plan";
import { ConnectionsView } from "@/components/connections/connections-view";
import type { AccountInfo, ChannelInfo } from "@/components/connections/types";
import { ConnectorsView } from "@/components/connectors/connectors-view";
import { StoresView } from "@/components/connectors/stores-view";
import { DomainsView } from "@/components/domains/domains-view";
import type { CatalogItem } from "@/lib/connectors/catalog";
import { BUILT_APP_FEATURE_KEYS, type FeatureKey } from "@/lib/features";

type Sp = Record<string, string | string[] | undefined>;

const APPS: CatalogItem[] = [
  { id: "google-drive", name: "Google Drive", group: "files", description: "Bring photos and videos from your Drive into your gallery.", icon: "hard-drive", status: { state: "connected", accountLabel: "aline@example.com" }, connectHref: "/api/connectors/google-drive/start", manageHref: "/dashboard/gallery" },
  { id: "dropbox", name: "Dropbox", group: "files", description: "Bring photos and videos from Dropbox.", icon: "box", status: { state: "not_connected" }, connectHref: "/api/connectors/dropbox/start", manageHref: null },
  { id: "canva", name: "Canva", group: "design", description: "Edit BuPulse designs in your Canva account.", icon: "palette", status: { state: "not_connected" }, connectHref: "/api/canva/connect", manageHref: null },
  { id: "shopify", name: "Shopify", group: "store", description: "Turn your Shopify products into posts.", icon: "shopping-bag", status: { state: "unavailable" }, connectHref: null, manageHref: null },
  { id: "woocommerce", name: "WooCommerce", group: "store", description: "Turn your WordPress shop's products into posts.", icon: "store", status: { state: "not_connected" }, connectHref: "/dashboard/stores/woocommerce", manageHref: null },
  { id: "cloudflare", name: "Cloudflare", group: "website", description: "Add the BuPulse chat to your website in one click.", icon: "cloud", status: { state: "needs_attention", detail: "The saved token stopped working." }, connectHref: "/dashboard/domains", manageHref: null },
] as CatalogItem[];

const CHANNELS: ChannelInfo[] = [
  { network: "instagram", label: "Instagram", note: "Business and Creator accounts", configured: true },
  { network: "facebook", label: "Facebook", note: "Facebook Pages", configured: true },
  { network: "linkedin", label: "LinkedIn", note: "Profiles and Pages", configured: true },
  { network: "tiktok", label: "TikTok", note: "Videos", configured: true },
  { network: "youtube", label: "YouTube", note: "Videos and Shorts", configured: false },
  { network: "twitter", label: "X", note: "Posts, photos and videos", configured: false },
];

const ACCOUNTS: AccountInfo[] = [
  { id: "a1", network: "instagram", displayName: "@kigalifreshbakery", externalAccountId: "1", accountType: "business", avatarUrl: null, status: "ACTIVE", postingMode: "AUTO" },
  { id: "a2", network: "facebook", displayName: "Kigali Fresh Bakery", externalAccountId: "2", accountType: "page", avatarUrl: null, status: "EXPIRING", postingMode: "AUTO" },
];

export function connectionsPreview(sp: Sp): ReactNode {
  return <ConnectionsView tab={sp.show === "apps" ? "apps" : "social"} base="/preview-b/connections" params={sp} channels={CHANNELS} accounts={ACCOUNTS} apps={APPS.filter((a) => a.id !== "cloudflare")} />;
}

export function connectorsPreview(sp: Sp): ReactNode {
  return <ConnectorsView items={APPS} group={typeof sp.group === "string" ? sp.group : ""} base="/preview-b/connectors" params={sp} />;
}

export function storesPreview(): ReactNode {
  return (
    <StoresView
      cards={[
        { id: "shopify", name: "Shopify", off: true, storeUrl: null },
        { id: "woocommerce", name: "WooCommerce", off: false, storeUrl: "https://shop.example.com" },
      ]}
    />
  );
}

export function domainsPreview(sp: Sp): ReactNode {
  const connected = sp.state === "connected";
  return (
    <DomainsView
      connected={connected}
      problem={null}
      tokenUrl="https://dash.cloudflare.com/profile/api-tokens"
      zones={connected ? [{ id: "z1", name: "example.com", chat: "installed" }, { id: "z2", name: "example.rw", chat: "none" }] : []}
      snippet='<script src="https://example.com/widget.js" data-key="demo" async></script>'
    />
  );
}

export function upgradePreview(sp: Sp): ReactNode {
  const feature = (typeof sp.feature === "string" ? sp.feature : "websiteChat") as FeatureKey;
  return <AddToPlan feature={feature} reason="not_in_plan" role="OWNER" inPlan={new Set(BUILT_APP_FEATURE_KEYS.filter((k) => k !== feature))} addOnBilling />;
}
