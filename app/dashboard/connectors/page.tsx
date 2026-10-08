import Link from "next/link";
import { ArrowRight, KeyRound, Share2, Webhook } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { ConnectorsSubNav } from "@/components/connectors/sub-nav";
import { Badge, GlassCard } from "@/components/ui";
import { GROUPS, getCatalog } from "@/lib/connectors/catalog";

export const metadata = { title: "Connectors" };

function LinkCard({ href, icon, title, text, badge }: { href: string; icon: React.ReactNode; title: string; text: string; badge?: string }) {
  return (
    <GlassCard as="li" interactive padding="none" className="rounded-card">
      <Link href={href} className="flex h-full items-start gap-3 p-5 no-underline">
        <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-soft text-pulse-blue">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 font-semibold text-text">
            {title}
            {badge && <Badge tone="violet">{badge}</Badge>}
          </span>
          <span className="mt-1 block text-[14px] text-muted">{text}</span>
        </span>
        <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-muted" />
      </Link>
    </GlassCard>
  );
}

export default async function ConnectorsPage() {
  const { user, business } = await getAppContext();
  const items = await getCatalog({ userId: user.id, businessId: business.id });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Connectors" description="Bring in your files, designs and products, and send what happens in BuPulse to the tools you already use." />
      <ConnectorsSubNav current="apps" />

      {GROUPS.map((group) => {
        const groupItems = items.filter((i) => i.group === group.id);
        if (groupItems.length === 0) return null;
        return (
          <section key={group.id} aria-labelledby={`group-${group.id}`} className="flex flex-col gap-3">
            <div className="px-1">
              <h2 id={`group-${group.id}`} className="text-lg font-semibold">
                {group.label}
              </h2>
              <p className="text-[14px] text-muted">{group.text}</p>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
              {groupItems.map((item) => (
                <ConnectorCard key={item.id} item={item} />
              ))}
            </ul>
          </section>
        );
      })}

      <section aria-labelledby="group-more" className="flex flex-col gap-3">
        <div className="px-1">
          <h2 id="group-more" className="text-lg font-semibold">
            More ways to connect
          </h2>
          <p className="text-[14px] text-muted">Social networks are not here: you connect those, to publish posts, on the Channels page.</p>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
          <LinkCard href="/dashboard/connections" icon={<Share2 className="size-5" />} title="Social networks" text="Instagram, Facebook, LinkedIn, TikTok and YouTube accounts you publish to." />
          <LinkCard href="/dashboard/connectors/webhooks" icon={<Webhook className="size-5" />} title="Webhooks" text="Send new leads, content and post results to Zapier, Make or your own system." />
          <LinkCard href="/dashboard/connectors/api" icon={<KeyRound className="size-5" />} title="API keys" text="Let your own tools read your projects, posts and leads." badge="Pro" />
        </ul>
      </section>
    </div>
  );
}
