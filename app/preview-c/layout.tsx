import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { HostsProvider } from "@/components/platform/hosts";
import { FEATURE_KEYS } from "@/lib/features";
import { hostKind, hostsConfig, requestHost } from "@/lib/platform/app-hosts";
import { previewAllowed } from "@/lib/support/preview";

export const metadata = { title: "Client preview", robots: { index: false, follow: false } };

/**
 * Development only: the client dashboard's redesigned Leads, Contacts, Inbox, Website chat, Link in bio, Automations,
 * Analytics and Creator campaigns screens inside the real dashboard shell, with made-up data, no sign-in and no
 * database (like /admin/preview). Not found in production.
 */
export default async function ClientPreviewLayout({ children }: { children: ReactNode }) {
  if (!previewAllowed()) notFound();
  const hosts = { kind: hostKind(requestHost(await headers())), hosts: hostsConfig() };
  return (
    <HostsProvider {...hosts}>
      <AppShell
        brand={{ logoUrl: null, colors: ["#2f6bff", "#7b5cff", "#0b0b0f"], hasColors: false }}
        displayName="Aline Uwase"
        firstName="Aline"
        email="aline@example.com"
        businessName="Inzozi Juice Bar"
        role="OWNER"
        features={[...FEATURE_KEYS]}
        plan={{ name: "Growth", trialLabel: null, used: 120, max: 400 }}
        inboxUnread={3}
      >
        {children}
      </AppShell>
    </HostsProvider>
  );
}
