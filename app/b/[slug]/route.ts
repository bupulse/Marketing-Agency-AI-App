import { publicSiteUrl } from "@/lib/auth/site-url";
import { bioPageCsp, bioUnavailablePage, renderBioPage } from "@/lib/bio/page";
import { loadPublicBio } from "@/lib/bio/service";
import { buildBioView, platformOf } from "@/lib/bio/view";

export const dynamic = "force-dynamic";

function nonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

// A company's link-in-bio page (docs/guide/features/33-link-in-bio.md). Public: no sign-in and no session work (the
// proxy skips /b/). Drawn per request, so "Open now" is right and a page switched off disappears at once.
export async function GET(request: Request, ctx: RouteContext<"/b/[slug]">) {
  const { slug } = await ctx.params;
  const n = nonce();
  const page = await loadPublicBio(slug.toLowerCase());
  if (!page) {
    return new Response(bioUnavailablePage(n), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": bioPageCsp(n), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  const site = publicSiteUrl();
  const view = buildBioView(page.source, page.settings, { platform: platformOf(request.headers.get("user-agent")) });
  const html = renderBioPage({ view, mode: "live", nonce: n, pageUrl: `${site}/b/${page.slug}`, ogImage: page.ogImage ? `${site}${page.ogImage}` : null, siteUrl: site });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": bioPageCsp(n),
      // The greeting depends on the app the visitor came from, so a shared cache must not keep one for everybody.
      "Cache-Control": "private, no-cache",
      Vary: "User-Agent",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
