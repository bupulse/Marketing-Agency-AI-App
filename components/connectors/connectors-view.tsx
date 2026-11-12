import { Plug, Share2 } from "lucide-react";
import { FilterChips, KitStyles, PageHeader, SectionCard, SectionGrid } from "@/components/admin/kit";
import { BGroupTitle } from "@/components/app/kit/b-cards";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { ConnectorsSubNav } from "@/components/connectors/sub-nav";
import { GROUPS, type CatalogItem } from "@/lib/connectors/catalog";

/**
 * /dashboard/connectors: the apps as one grid, with chips to show one kind (files, design, store, website), then the
 * other ways to connect as cards. Presentational: the page passes the catalog in.
 */
export function ConnectorsView({
  items,
  group,
  base = "/dashboard/connectors",
  params,
}: {
  items: CatalogItem[];
  group: string;
  base?: string;
  params?: Record<string, string | string[] | undefined>;
}) {
  const groups = GROUPS.filter((g) => items.some((i) => i.group === g.id));
  const current = groups.find((g) => g.id === group);
  const shown = current ? items.filter((i) => i.group === current.id) : [...items].sort((a, b) => groups.findIndex((g) => g.id === a.group) - groups.findIndex((g) => g.id === b.group));
  const connected = items.filter((i) => i.status.state === "connected").length;
  return (
    <>
      <KitStyles />
      <PageHeader icon={Plug} title="Connectors" description="Bring in your files, designs and products, and send what happens in BuPulse to the tools you use." />
      <ConnectorsSubNav current="apps" />

      <section aria-labelledby="apps-title" className="flex flex-col gap-3">
        <BGroupTitle id="apps-title" title="Apps" hint={current ? current.text : `${connected} of ${items.length} connected. Tap a kind to see fewer.`} />
        <FilterChips
          label="Show apps"
          param="group"
          base={base}
          params={params}
          current={current?.id ?? ""}
          options={[{ value: "", label: "All", count: items.length }, ...groups.map((g) => ({ value: g.id, label: g.label, count: items.filter((i) => i.group === g.id).length }))]}
        />
        <ul className="kit-rise grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
          {shown.map((item) => (
            <ConnectorCard key={item.id} item={item} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="group-more" className="flex flex-col gap-3">
        <BGroupTitle id="group-more" title="Social networks" hint="Not here: you connect them on the Channels page, to publish posts. Webhooks and API keys are in the tabs above." />
        <SectionGrid>
          <SectionCard href="/dashboard/connections" icon={Share2} tone="blue" title="Social networks" hint="Instagram, Facebook, LinkedIn, TikTok and YouTube accounts you publish to." row />
        </SectionGrid>
      </section>
    </>
  );
}
