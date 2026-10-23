import type { Metadata, Viewport } from "next";
import { SupportBaseProvider } from "@/components/support-app/base";
import { supportBase } from "@/lib/support/app-auth";
import { supportHref } from "@/lib/support/app-host";

// The support app (support.bupulse.com, or /support on any other host): its own name, phone-app manifest and icons.
// Every page reads the session, so none is cached, and none is ever indexed.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const base = await supportBase();
  return {
    title: { default: "BuPulse Support", template: "%s · BuPulse Support" },
    applicationName: "BuPulse Support",
    robots: { index: false, follow: false, nocache: true },
    manifest: supportHref(base, "/app.webmanifest"),
    appleWebApp: { capable: true, title: "BuPulse Support", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2f6bff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0f" },
  ],
};

export default async function SupportRootLayout({ children }: LayoutProps<"/support">) {
  return <SupportBaseProvider base={await supportBase()}>{children}</SupportBaseProvider>;
}
