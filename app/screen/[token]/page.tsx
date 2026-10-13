import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SalesScreen } from "@/components/screen/sales-screen";
import { screenByToken, touchScreen } from "@/lib/screen/links";

// The sales room TV (lib/screen/): a view-only page opened with a secret link made in Admin ->
// Organisation -> Sales screen. No sign-in; an unknown or revoked link is a 404. The numbers come from ./data.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sales room",
  robots: { index: false, follow: false },
  // The token is in the address: never send it on as a referrer.
  referrer: "no-referrer",
};

export default async function ScreenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await screenByToken(token);
  if (!link) notFound();
  await touchScreen(link);
  return <SalesScreen token={token} name={link.name} />;
}
