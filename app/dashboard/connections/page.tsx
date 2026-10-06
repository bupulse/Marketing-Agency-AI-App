import { Plug } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, Button, GlassCard } from "@/components/ui";
import { prisma } from "@/lib/db";

export const metadata = { title: "Connections" };

const SOCIAL = [
  { provider: "instagram", name: "Instagram", note: "Business or Creator accounts" },
  { provider: "facebook", name: "Facebook", note: "Pages" },
  { provider: "tiktok", name: "TikTok", note: "Videos" },
  { provider: "linkedin", name: "LinkedIn", note: "Pages and profiles" },
  { provider: "youtube", name: "YouTube", note: "Videos and Shorts" },
];

const APPS = [
  { provider: "google_drive", name: "Google Drive", note: "Import photos and files" },
  { provider: "dropbox", name: "Dropbox", note: "Import photos and files" },
  { provider: "canva", name: "Canva", note: "Open and export designs" },
  { provider: "shopify", name: "Shopify", note: "Import products" },
  { provider: "woocommerce", name: "WooCommerce", note: "Import products" },
  { provider: "cloudflare", name: "Cloudflare", note: "Website and widget setup" },
];

function Group({ title, items, connected }: { title: string; items: typeof SOCIAL; connected: Set<string> }) {
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

export default async function ConnectionsPage() {
  const { business } = await getAppContext();
  const rows = business
    ? await prisma.connection.findMany({ where: { businessId: business.id }, select: { provider: true } })
    : [];
  const connected = new Set(rows.map((r) => r.provider));

  return (
    <>
      <PageHeader
        title="Connections"
        description="Connect your social accounts to publish, and your apps to bring in photos and products."
      />
      <Group title="Social accounts" items={SOCIAL} connected={connected} />
      <Group title="Apps" items={APPS} connected={connected} />
      <GlassCard className="flex flex-wrap items-center gap-3 p-5 text-[15px]">
        <Badge tone="violet">Pro</Badge>
        <p className="min-w-0 flex-1 basis-64 text-muted">
          Advanced: use your own Composio account to connect hundreds more apps. Available on the Pro plan.
        </p>
      </GlassCard>
    </>
  );
}
