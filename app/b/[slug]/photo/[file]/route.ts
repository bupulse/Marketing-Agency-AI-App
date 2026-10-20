import { bioPhotoPath, downloadBioPhoto } from "@/lib/bio/service";

export const dynamic = "force-dynamic";

// A small copy of the logo or a product photo of a live link-in-bio page (lib/bio/service.ts). Only files on a page
// that is switched on are served. Each copy has its own random name, so browsers and caches may keep it for a day.
export async function GET(_request: Request, ctx: RouteContext<"/b/[slug]/photo/[file]">) {
  const { slug, file } = await ctx.params;
  const path = await bioPhotoPath(slug.toLowerCase(), file);
  const bytes = path ? await downloadBioPhoto(path) : null;
  if (!bytes) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(bytes as BodyInit, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
