import { getSetting } from "@/lib/admin/settings";

// Public, cacheable: the site-wide UI choices the browser needs (Admin -> Settings). No personal data.
export async function GET() {
  const pageLoader = await getSetting("pageLoader");
  return Response.json({ pageLoader }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
}
