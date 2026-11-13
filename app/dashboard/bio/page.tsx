import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { BioScreen } from "@/components/bio/bio-screen";
import { publicSiteUrl, siteUrl } from "@/lib/auth/site-url";
import { loadBioEditor } from "@/lib/bio/service";
import { signedUrls } from "@/lib/media/service";

export const metadata = { title: "Link in bio" };

// Every plan has it (it brings the company leads), like the Knowledge base it is built from: no plan feature to check.
export default async function BioPage() {
  const blocked = await pageGate("settings");
  if (blocked) return blocked;
  const { business, logoUrl, entitlements } = await getAppContext();
  if (!business) return null;
  const editor = await loadBioEditor(business.id, { signedLogoUrl: logoUrl, signPhotos: signedUrls });

  return (
    <BioScreen
      initial={editor.settings}
      saved={editor.saved}
      source={editor.source}
      days={editor.days}
      baseUrl={publicSiteUrl()}
      siteUrl={siteUrl()}
      readOnly={entitlements.block !== null}
    />
  );
}
