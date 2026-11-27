import Script from "next/script";
import { BackgroundBlobs } from "@/components/motion";
import { CtaProvider } from "@/components/marketing/quote/cta";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteBannerBar } from "@/components/marketing/site-banner";
import { WhatsAppButton } from "@/components/marketing/whatsapp-button";
import { visitorCtaMode } from "@/lib/quote/cta-server";
import { getWaitlist } from "@/lib/waitlist-server";
import { getShowingBanner } from "@/lib/site-banner-server";
import { HostsProvider } from "@/components/platform/hosts";
import { hostsConfig } from "@/lib/platform/app-hosts";

// The call to action depends on where the visitor is (lib/quote/cta.ts: "Get a free quote" in Rwanda, the free trial
// elsewhere), decided once here for the header, the page and its pop-up. Reading the region makes these pages render
// per request, like the home and pricing pages already did. While the pre-launch waiting list is on (lib/waitlist.ts)
// every visitor gets the quote pop-up ("Reserve your spot"). The site banner (lib/site-banner.ts, Admin -> Settings ->
// Site banner) sits above the menu while it is switched on and inside its dates.
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [mode, waitlist, banner] = await Promise.all([visitorCtaMode(), getWaitlist(), getShowingBanner()]);
  return (
    <HostsProvider kind="front" hosts={hostsConfig()}>
      <CtaProvider mode={mode} waitlist={waitlist} banner={banner}>
        <div className="relative flex min-h-full flex-1 flex-col overflow-x-clip">
          <BackgroundBlobs />
          {banner ? (
            // The banner stays in view while scrolling (owner, 27 Nov 2026): it and the floating menu stick together.
            <div className="sticky top-0 z-40">
              <SiteBannerBar banner={banner} />
              <SiteHeader />
            </div>
          ) : (
            <SiteHeader />
          )}
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
