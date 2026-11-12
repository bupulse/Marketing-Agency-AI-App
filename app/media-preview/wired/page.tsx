import { notFound } from "next/navigation";
import { CampaignList } from "@/components/creators/company/campaign-list";
import { ProductGrid } from "@/components/knowledge/product-grid";
import { previewAllowed } from "@/lib/support/preview";
import { WiredPreview } from "./wired-client";
import { CREATOR_CAMPAIGNS, PRODUCTS } from "./wired-data";

export const metadata = { title: "Wired pages preview", robots: { index: false, follow: false } };

/**
 * Development only: the page components wired to the media cards (posts board, opened post, calendar, products,
 * creator campaigns, designs, photo tiles) with made-up rows, no sign-in and no database. ?theme=dark; ?open=<post id>
 * (b1…b8) opens a post. Not found in production.
 */
export default async function WiredPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!previewAllowed()) notFound();
  const sp = await searchParams;
  const theme = sp.theme === "dark" ? "dark" : "light";
  const open = typeof sp.open === "string" ? sp.open : null;
  return (
    <WiredPreview
      theme={theme}
      open={open}
      server={
        <>
          <section id="products" className="flex scroll-mt-6 flex-col gap-4">
            <div>
              <h2 className="text-[22px] font-bold tracking-[-0.02em]">Products (ProductGrid)</h2>
              <p className="text-[14px] text-muted">components/knowledge/product-grid: shelf cards with kind, status, store badge, counts and Needs details.</p>
            </div>
            <ProductGrid products={PRODUCTS} />
          </section>
          <section id="creators" className="flex scroll-mt-6 flex-col gap-4">
            <div>
              <h2 className="text-[22px] font-bold tracking-[-0.02em]">Creator campaigns (CampaignList)</h2>
              <p className="text-[14px] text-muted">components/creators/company/campaign-list: drafts keep Continue and Detailed setup; applicants and hidden badges.</p>
            </div>
            <CampaignList campaigns={CREATOR_CAMPAIGNS} />
          </section>
        </>
      }
    />
  );
}
