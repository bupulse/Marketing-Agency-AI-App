import { Suspense } from "react";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { DesignStudio } from "@/components/designs/design-studio";
import { isCanvaEnabled } from "@/lib/canva/config";
import { recommendPack } from "@/lib/designs/packs";
import { listDesigns } from "@/lib/designs/service";

export const metadata = { title: "Designs" };

export default async function DesignsPage() {
  const { user, business, usage } = await getAppContext();
  const designs = await listDesigns(user.id);

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
        hasLogo={!!business.logoUrl}
        credits={{ used: usage.used.image, limit: usage.limits.image, resetsAt: usage.resetsAt?.toISOString() ?? null }}
      />
    </>
  );
}
