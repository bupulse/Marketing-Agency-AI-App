import Script from "next/script";
import { BackgroundBlobs } from "@/components/motion";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { WhatsAppButton } from "@/components/marketing/whatsapp-button";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-x-clip">
      <BackgroundBlobs />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <WhatsAppButton />
      {/* First-party, cookie-free page-view counter (docs/handovers/phase-8-analytics.md). Marketing pages only. */}
      <Script src="/t.js" strategy="afterInteractive" />
    </div>
  );
}
