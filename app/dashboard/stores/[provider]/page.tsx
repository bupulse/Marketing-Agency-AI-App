import { notFound, redirect } from "next/navigation";
import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, Button, GlassCard, Input } from "@/components/ui";
import { ProductImport } from "@/components/stores/product-import";
import { SyncPanel } from "@/components/stores/sync-panel";
import { WooManualForm } from "@/components/stores/woo-manual-form";
import { DisconnectStoreButton, PendingButtons } from "@/components/stores/store-actions";
import { startWooConnectAction } from "@/app/dashboard/stores/actions";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/auth/site-url";
import { getConnection, getPending } from "@/lib/stores/connection";
import { relativeSync } from "@/lib/stores/labels";
import { installRedirect, isShopifyEnabled, shopifyConfig } from "@/lib/stores/shopify";
import { isStoreProvider, STORE_NAMES } from "@/lib/stores/types";

export const metadata = { title: "Products from your store" };

const ERRORS: Record<string, string> = {
  invalid_shop: "That does not look like a Shopify address. Use something like your-shop.myshopify.com.",
  invalid_store: "Enter your store's web address, starting with https://. It must be a public website.",
  invalid_request: "The connection could not be verified. Please start again.",
  denied: "You did not allow access, so nothing was connected.",
  rate_limited: "Too many tries. Please wait a few minutes.",
  needs_https: "The one-click connection needs BuPulse to run on https. Use the manual keys below.",
  no_business: "Finish setting up your business first.",
  expired: "That connection request expired or was already used. Start again.",
  error: "Something went wrong while connecting. Please try again.",
};

export default async function StorePage({ params, searchParams }: { params: Promise<{ provider: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const blocked = (await pageGate("connectors")) ?? (await featureGate("storeImport"));
  if (blocked) return blocked;
  const { provider } = await params;
  if (!isStoreProvider(provider)) notFound();
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;
  const connected = typeof query.connected === "string" || typeof query.confirmed === "string" ? "1" : undefined;
  const { business } = await getAppContext();
  if (!business) return null;
  // Shopify opens the App URL with ?shop, ?hmac, ?host and ?timestamp when a merchant installs from the App Store or
  // admin. A request Shopify signed starts the connection straight away (the start route verifies the HMAC again).
  const config = provider === "shopify" ? shopifyConfig() : null;
  if (config) {
    const start = await installRedirect(query, config.apiSecret);
    if (start) redirect(start);
  }
  const name = STORE_NAMES[provider];
  const conn = await getConnection(business.id, provider);
  const pending = provider === "woocommerce" ? await getPending(business.id, "woocommerce") : null;
  const imported = conn ? await prisma.productSync.count({ where: { connectionId: conn.id } }) : 0;
  const notice = error ? (ERRORS[error] ?? ERRORS.error) : null;

  return (
    <>
      <PageHeader title={`Products from ${name}`} description="Pick the products you want to promote. BuPulse copies the name, price, description and photos into your products, each with its own album." />
      {notice && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] text-danger">{notice}</p>}
      {connected && conn && !pending && <p role="status" className="rounded-2xl bg-success-bg px-4 py-3 text-[14px] text-success">Connected to {conn.storeUrl.replace(/^https:\/\//, "")}. Choose your products below.</p>}

      {pending && (
        <GlassCard className="flex flex-col gap-3" role="alertdialog" aria-label="Confirm store connection">
          <h2 className="text-lg font-semibold">Connect {pending.storeUrl.replace(/^https:\/\//, "")}?</h2>
          <p className="text-[14px] text-muted">
            This store asked to give BuPulse read-only access to its products. Only continue if you just started this from BuPulse.
            {conn && conn.storeUrl !== pending.storeUrl ? ` It will replace ${conn.storeUrl.replace(/^https:\/\//, "")}, and products already imported from that store will stop syncing.` : ""}
          </p>
          <PendingButtons pendingId={pending.id} />
        </GlassCard>
      )}

      {conn ? (
        <>
          <GlassCard className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <strong className="truncate">{conn.storeUrl.replace(/^https:\/\//, "")}</strong>
                {conn.status === "ACTIVE" ? <Badge tone="success">Connected</Badge> : <Badge tone="danger">Needs attention</Badge>}
              </div>
              <DisconnectStoreButton provider={provider} />
            </div>
            {conn.status !== "ACTIVE" && (
              <p className="text-[14px] text-danger">
                {provider === "shopify" ? "Shopify no longer lets BuPulse read this store." : "WooCommerce no longer accepts the saved keys."} Disconnect and connect again.
              </p>
            )}
            <SyncPanel provider={provider} imported={imported} lastSync={relativeSync(conn.lastSyncAt)} />
          </GlassCard>
          {conn.status === "ACTIVE" && <ProductImport provider={provider} storeName={name} />}
        </>
      ) : provider === "shopify" ? (
        isShopifyEnabled() ? (
          <GlassCard className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Connect your Shopify store</h2>
            <p className="text-[14px] text-muted">BuPulse asks for read-only access to your products. Nothing in your store is changed.</p>
            <form action="/api/stores/shopify/connect" method="post" className="flex flex-col gap-3 sm:flex-row">
              <Input name="shop" placeholder="your-shop.myshopify.com" aria-label="Your Shopify address" autoCapitalize="none" autoCorrect="off" spellCheck={false} required className="flex-1" />
              <Button type="submit">Connect</Button>
            </form>
            <p className="text-[13px] text-muted">Find the address in Shopify under Settings, Domains: the one ending in .myshopify.com.</p>
          </GlassCard>
        ) : (
          <GlassCard className="flex flex-col gap-2"><h2 className="text-lg font-semibold">Coming soon</h2><p className="text-[14px] text-muted">Shopify import is not switched on yet.</p></GlassCard>
        )
      ) : (
        <>
          <GlassCard className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Connect your WooCommerce store</h2>
            <p className="text-[14px] text-muted">You will be asked in your store to approve read-only access for BuPulse. Nothing in your store is changed.</p>
            <form action={startWooConnectAction} className="flex flex-col gap-3 sm:flex-row">
              <Input name="store" type="url" inputMode="url" placeholder="https://yourstore.com" aria-label="Your store address" autoCapitalize="none" autoCorrect="off" spellCheck={false} required className="flex-1" />
              <Button type="submit">Connect</Button>
            </form>
            {!siteUrl().startsWith("https://") && <p className="text-[13px] text-muted">The one-click way needs BuPulse on https; here, use the manual keys below.</p>}
          </GlassCard>
          <details className="glass rounded-glass p-5">
            <summary className="cursor-pointer text-[15px] font-semibold">Or paste your keys by hand</summary>
            <ol className="mt-3 mb-4 list-decimal space-y-1 pl-5 text-[14px] text-muted">
              <li>In WordPress open WooCommerce, Settings, Advanced, REST API.</li>
              <li>Click Add key. Description: BuPulse. Permissions: Read.</li>
              <li>Click Generate API key, then copy the consumer key and secret here.</li>
            </ol>
            <WooManualForm />
          </details>
        </>
      )}
    </>
  );
}
