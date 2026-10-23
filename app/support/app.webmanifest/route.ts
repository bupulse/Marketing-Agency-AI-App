import { supportBase } from "@/lib/support/app-auth";
import { supportHref } from "@/lib/support/app-host";

// The support app's phone and computer app manifest: its own name, start page and scope, so installing it never
// installs the client dashboard (public/manifest.webmanifest). Icons are BuPulse's own.
export async function GET() {
  const base = await supportBase();
  const start = supportHref(base, "/");
  const manifest = {
    id: start,
    name: "BuPulse Support",
    short_name: "Support",
    description: "Answer BuPulse's support chats and see who is on the site.",
    start_url: start,
    scope: base ? `${base}/` : "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f5f7",
    theme_color: "#2f6bff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
