import type { Metadata } from "next";

/** Per-page metadata with matching Open Graph / Twitter tags. `title` is the short page name (the layout adds "· BuPulse"). */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "BuPulse", title: `${title} · BuPulse`, description, url: path },
    twitter: { card: "summary_large_image", title: `${title} · BuPulse`, description },
  };
}
