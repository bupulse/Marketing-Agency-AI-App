import { notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app/app-shell";
import { previewAllowed } from "@/lib/support/preview";
import { BUILT_APP_FEATURE_KEYS } from "@/lib/features";
import { PREVIEW_B_SCREENS } from "../screens";

export const metadata = { title: "Client preview", robots: { index: false, follow: false } };

/**
 * Development only: the redesigned client pages (Business info, Brand, Settings, Billing, Usage, Upgrade, Domains,
 * Channels, Connectors, Stores) with made-up data, inside the real dashboard shell, with no sign-in and no database.
 * /preview-b lists the screens. Not found in production.
 */
export default async function ClientPreviewB({ params, searchParams }: PageProps<"/preview-b/[[...screen]]">) {
  if (!previewAllowed()) notFound();
  const [{ screen }, sp] = await Promise.all([params, searchParams]);
  const key = (screen ?? []).join("/");
  const shell = (children: React.ReactNode) => (
    <AppShell
      brand={{ logoUrl: null, colors: ["#2f6bff", "#7b5cff", "#14b8a6"], hasColors: false }}
      displayName="Aline Uwase"
      firstName="Aline"
      email="aline@example.com"
      businessName="Kigali Fresh Bakery"
      role="OWNER"
      features={BUILT_APP_FEATURE_KEYS}
      plan={{ name: "Growth", trialLabel: null, used: 42, max: 300 }}
    >
      {children}
    </AppShell>
  );
  if (!key) {
    return shell(
      <ul className="flex flex-col gap-2 p-4">
        {Object.keys(PREVIEW_B_SCREENS).map((k) => (
          <li key={k}>
            <Link href={`/preview-b/${k}`}>{k}</Link>
          </li>
        ))}
      </ul>,
    );
  }
  const render = Object.hasOwn(PREVIEW_B_SCREENS, key) ? PREVIEW_B_SCREENS[key] : null;
  if (!render) notFound();
  return shell(await render(sp));
}
