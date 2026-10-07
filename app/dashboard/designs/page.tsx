import { Suspense } from "react";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { DesignStudio } from "@/components/designs/design-studio";
import { isCanvaEnabled } from "@/lib/canva/config";
import { recommendPack } from "@/lib/designs/packs";
import { listDesigns } from "@/lib/designs/service";
import { assetById } from "@/lib/media/service";

export const metadata = { title: "Designs" };

export default async function DesignsPage({ searchParams }: { searchParams: Promise<{ photo?: string }> }) {
  const { user, business, usage } = await getAppContext();
  const { photo } = await searchParams;
  const designs = await listDesigns(user.id);
  // ?photo=<assetId> from the Gallery: only the business's own photo counts, anything else is ignored.
  const asset = photo && photo.length <= 60 ? await assetById(business.id, photo) : null;

  return (
    <>
      <PageHeader title="Designs" description="Branded images made with your logo, colours and photos. Templates are free; described images use your image credits." />
      <Suspense>
        <CanvaReturnToast />
      </Suspense>
      <DesignStudio
        pack={recommendPack(business)}
        canva={isCanvaEnabled()}
        designs={designs}
        galleryPhoto={asset && asset.url ? { path: asset.path, url: asset.url } : null}
        hasLogo={!!business.logoUrl}
        credits={{ used: usage.used.image, limit: usage.limits.image, resetsAt: usage.resetsAt?.toISOString() ?? null }}
      />
    </>
  );
}
