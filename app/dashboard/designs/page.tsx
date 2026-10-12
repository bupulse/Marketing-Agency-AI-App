import { Suspense } from "react";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { DesignStudio } from "@/components/designs/design-studio";
import { isCanvaEnabled } from "@/lib/canva/config";
import { recommendPack } from "@/lib/designs/packs";
import { listDesigns } from "@/lib/designs/service";
import { assetById, signedUrls } from "@/lib/media/service";
import { SubjectPicker } from "@/components/knowledge/subject-picker";
import { resolveSubject, subjectOptions, writingSubject } from "@/lib/knowledge/service";

export const metadata = { title: "Designs" };

export default async function DesignsPage({ searchParams }: { searchParams: Promise<{ photo?: string; for?: string }> }) {
  const blocked = await featureGate("designs");
  if (blocked) return blocked;
  const { user, business, usage, entitlements } = await getAppContext();
  const { photo, for: forId } = await searchParams;
  const designs = await listDesigns(user.id);
  // ?photo=<assetId> from the Gallery: only the business's own photo counts, anything else is ignored.
  const asset = photo && photo.length <= 60 ? await assetById(business.id, photo) : null;
  // ?for=<product or campaign id>: the design starts from it (its name, price and album) and is saved with it.
  const subject = await resolveSubject(business.id, forId);
  const about = subject ? await writingSubject(business.id, subject) : null;
  const urls = about ? await signedUrls(about.photoPaths) : new Map<string, string>();
  const options = await subjectOptions(business.id);

  return (
    <>
      <PageHeader title="Designs" description="Branded images made with your logo, colours and photos. Templates are free; described images use your image credits." />
      <Suspense>
        <CanvaReturnToast />
      </Suspense>
      <SubjectPicker
        base="/dashboard/designs"
        value={subject?.id ?? ""}
        label="Make a design for"
        none="Nothing in particular"
        options={[...options.products.map((p) => ({ id: p.id, name: p.name, group: "Products & services" as const })), ...options.campaigns.map((c) => ({ id: c.id, name: c.name, group: "Campaigns" as const }))]}
      />
      <DesignStudio
        key={subject?.id ?? "none"}
        subjectId={subject?.id}
        album={subject ? `${subject.kind}:${subject.id}` : undefined}
        defaults={
          about
            ? { headline: about.title, subline: about.features[0] ?? "", chip: (about.price ?? "").slice(0, 40), photoPaths: about.photoPaths, photoUrls: about.photoPaths.map((p) => urls.get(p) ?? ""), projectType: about.type }
            : undefined
        }
        pack={recommendPack(business)}
        canva={isCanvaEnabled() && entitlements.usable.has("canva")}
        aiPhotos={entitlements.usable.has("aiPhotos")}
        designs={designs}
        galleryPhoto={asset && asset.url ? { path: asset.path, url: asset.url } : null}
        hasLogo={!!business.logoUrl}
        credits={{ used: usage.used.image, limit: usage.limits.image, resetsAt: usage.resetsAt?.toISOString() ?? null }}
      />
    </>
  );
}
