import type { Metadata } from "next";
import { CreatorShell } from "@/components/creators/portal/shell";
import { requireCreator } from "@/lib/creators/auth";

export const metadata: Metadata = {
  title: { default: "Creator", template: "%s · BuPulse creator" },
  robots: { index: false, follow: false },
};

// The creator's portal (docs/CREATOR_CAMPAIGNS.md): signed-in creators only; a company person without a creator
// profile goes to the dashboard (lib/creators/auth.ts).
export default async function CreatorLayout({ children }: LayoutProps<"/creator">) {
  const { profile } = await requireCreator();
  return <CreatorShell name={profile.name}>{children}</CreatorShell>;
}
