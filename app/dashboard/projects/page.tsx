import { FolderKanban, Plus, Store } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui";
import { ProjectGrid } from "@/components/studio/project-grid";
import { loadProjectCards } from "@/components/studio/queries";
import { prisma } from "@/lib/db";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const projects = business ? await loadProjectCards(business.id) : [];
  // One button per connected store ("Import from Shopify"), or a single "Import from your store" before any is connected.
  const stores = business ? await prisma.storeConnection.findMany({ where: { businessId: business.id }, select: { provider: true } }) : [];
  const importButtons = (stores.length > 0 ? stores.map((s) => ({ href: `/dashboard/stores/${s.provider}`, label: `Import from ${s.provider === "shopify" ? "Shopify" : "WooCommerce"}` })) : [{ href: "/dashboard/stores", label: "Import from your store" }]).map((b) => (
    <Button key={b.href} href={b.href} variant="ghost" leading={<Store aria-hidden className="size-[18px]" />}>
      {b.label}
    </Button>
  ));
  const newButton = (
    <Button href="/dashboard/projects/new" leading={<Plus aria-hidden className="size-[18px]" />}>
      New project
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Projects"
        description="A project is anything you want to promote. Add the details once, then create content from it."
        action={
          projects.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {importButtons}
              {newButton}
            </div>
          ) : undefined
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Create your first project"
          text="Add a product, service, event or offer with a few photos, and BuPulse writes the content for you."
          points={[
            "Works for any business: products, services, events, offers and more",
            "Upload photos and add price and key features",
            "Get captions, hashtags, a video script and ad headlines in your brand voice",
          ]}
          action={<div className="flex flex-wrap gap-2">{newButton}{importButtons}</div>}
        />
      ) : (
        <ProjectGrid projects={projects} />
      )}
    </>
  );
}
