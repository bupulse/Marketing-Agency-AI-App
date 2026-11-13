import { notFound } from "next/navigation";
import { previewAllowed } from "@/lib/support/preview";
import { MediaPreview } from "./preview-client";

export const metadata = { title: "Media cards preview", robots: { index: false, follow: false } };

/**
 * Development only: BuPulse's media cards (components/media-cards) with made-up data, no sign-in and no database, for
 * checking the design in a browser. ?theme=dark for dark mode; ?open=post, ?open=carousel or ?open=video opens the post
 * or the player. Not found in production. (Outside /dashboard: the dashboard layout needs a signed-in company.)
 */
export default async function MediaPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!previewAllowed()) notFound();
  const sp = await searchParams;
  const theme = sp.theme === "dark" ? "dark" : "light";
  const open = typeof sp.open === "string" ? sp.open : null;
  return <MediaPreview theme={theme} open={open} />;
}
