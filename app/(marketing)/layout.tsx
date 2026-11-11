import Script from "next/script";
import { BackgroundBlobs } from "@/components/motion";
import { CtaProvider } from "@/components/marketing/quote/cta";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { WhatsAppButton } from "@/components/marketing/whatsapp-button";
import { visitorCtaMode } from "@/lib/quote/cta-server";
import { HostsProvider } from "@/components/platform/hosts";
import { hostsConfig } from "@/lib/platform/app-hosts";

// The call to action depends on where the visitor is (lib/quote/cta.ts: "Get a free quote" in Rwanda, the free trial
// elsewhere), decided once here for the header, the page and its pop-up. Reading the region makes these pages render
// per request, like the home and pricing pages already did.
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const mode = await visitorCtaMode();
  return (
    <HostsProvider kind="front" hosts={hostsConfig()}>
      <CtaProvider mode={mode}>
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
      </CtaProvider>
    </HostsProvider>
  );
}
