import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, GlassCard } from "@/components/ui";
import { prisma } from "@/lib/db";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const { business } = await getAppContext();
  const projects = business
    ? await prisma.project.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" }, take: 50 })
    : [];

  return (
    <>
      <PageHeader
        title="Projects"
        description="A project is anything you want to promote. Add the details once, then create content from it."
      />
      {projects.length === 0 ? (
        <EmptyState
          comingSoon
          icon={FolderKanban}
          title="Your projects will live here"
          text="Create a project for a product, service, event or offer, add photos and details, and BuPulse writes the content for you."
          points={[
            "Works for any business: products, services, events, offers and more",
            "Upload photos and add price and key features",
            "Generate captions, hashtags, video scripts and ad headlines in your brand voice",
          ]}
        />
      ) : (
        <GlassCard as="ul" className="flex flex-col p-3">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3.5 rounded-2xl p-3 hover:bg-soft">
              <span aria-hidden className="size-12 shrink-0 rounded-[14px] bg-brand-gradient" />
              <div className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate text-[15px]">{p.title}</strong>
                <span className="truncate text-[13px] text-muted">{p.price ?? "No price set"}</span>
              </div>
              <Badge tone="blue" className="capitalize">{p.type}</Badge>
            </li>
          ))}
        </GlassCard>
      )}
    </>
  );
}
