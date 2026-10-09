import { notFound } from "next/navigation";
import { PenLine } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { Badge, Button, GlassCard } from "@/components/ui";
import { ContentCard } from "@/components/studio/content-card";
import { DeleteProjectButton } from "@/components/studio/delete-project";
import { WriteContentCta } from "@/components/studio/write-content-cta";
import { DesignStudio } from "@/components/designs/design-studio";
import { isCanvaEnabled } from "@/lib/canva/config";
import { recommendPack } from "@/lib/designs/packs";
import { loadProjectDetail } from "@/components/studio/queries";
import { typeLabel } from "@/components/studio/helpers";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { id } = await params;
  const { business, usage, entitlements } = await getAppContext();
  if (!business) notFound();
  const detail = await loadProjectDetail(business.id, id);
  if (!detail) notFound();
  const { project, contents, photos, designs } = detail;
  const used = usage.used.text;
  const limit = usage.limits.text;

  return (
    <>
      <GlassCard as="header" className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{typeLabel(project.type)}</Badge>
              {project.price && <Badge tone="neutral">{project.price}</Badge>}
              {project.storeSync && <Badge tone="violet">{project.storeSync.connection.provider === "shopify" ? "Synced from Shopify" : "Synced from WooCommerce"}</Badge>}
            </div>
            <h1 className="break-words text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">{project.title}</h1>
            {project.features.length > 0 && (
              <ul aria-label="Key features" className="flex flex-wrap gap-2 text-[13px] text-muted">
                {project.features.map((f, i) => (
                  <li key={`${i}-${f}`} className="rounded-full bg-soft px-3 py-1">
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" href={`/dashboard/projects/${project.id}/edit`} leading={<PenLine aria-hidden className="size-4" />}>
              Edit
            </Button>
            <DeleteProjectButton projectId={project.id} title={project.title} />
          </div>
        </div>
        {photos.length > 0 && (
          <ul aria-label="Photos" className="flex gap-3 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <li key={p.path} className="size-24 shrink-0 overflow-hidden rounded-2xl bg-soft sm:size-28">
                {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL */}
                <img src={p.url} alt={`${project.title}, photo ${i + 1}`} className="size-full object-cover" />
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {contents.length === 0 ? (
        <WriteContentCta projectId={project.id} used={used} limit={limit} />
      ) : (
        <ContentCard projectId={project.id} contents={contents} used={used} limit={limit} photos={photos} />
      )}

      {/* Designs are their own plan feature; the project page keeps its content tools without them. */}
      {entitlements.usable.has("designs") && (
      <DesignStudio
        pack={recommendPack(business)}
        canva={isCanvaEnabled() && entitlements.usable.has("canva")}
        aiPhotos={entitlements.usable.has("aiPhotos")}
        projectId={project.id}
        defaults={{
          headline: project.title,
          subline: project.features[0] ?? "",
          chip: project.price ?? "",
          photoPaths: project.photoPaths,
          // Thumbnails in the same order as photoPaths ("" when a link couldn't be made).
          photoUrls: project.photoPaths.map((path) => photos.find((p) => p.path === path)?.url ?? ""),
          projectType: project.type,
        }}
        designs={designs}
        credits={{ used: usage.used.image, limit: usage.limits.image, resetsAt: usage.resetsAt?.toISOString() ?? null }}
        hasLogo={Boolean(business.logoUrl)}
      />
      )}
    </>
  );
}
