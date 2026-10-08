import { loadPublicWidget, signedLogoUrl } from "@/lib/widget/config";
import { checkOrigin, hostOf, isLocalBuPulse, LOCAL_FILE_HOST } from "@/lib/widget/origin";
import { chatPageCsp, renderChatPage, unavailablePage } from "@/lib/widget/page";
import { ownHostsFor } from "@/lib/widget/request";
import { turnstileSiteKey } from "@/lib/widget/turnstile";

export const dynamic = "force-dynamic";

function nonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

function html(body: string, status: number, csp: string) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// The chat itself, shown inside the iframe that widget.js creates. Public: no sign-in, and the
// only page of the site that may be framed (by the business's allowed domains, or any site when none are set).
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const url = new URL(request.url);
  const n = nonce();
  const widget = await loadPublicWidget(key);
  if (!widget?.enabled) return html(unavailablePage(n), 404, `default-src 'none'; style-src 'nonce-${n}'; frame-ancestors 'none'`);

  // The browser's own Referer says which site is embedding us; it must be allowed too.
  const referer = request.headers.get("referer");
  const own = ownHostsFor(request);
  const refererHost = hostOf(referer);
  const claimed = url.searchParams.get("origin") ?? refererHost ?? undefined;
  const allowed = checkOrigin({ allowedDomains: widget.allowedDomains, claimedHost: claimed, ownHosts: own });
  const refererOk = !refererHost || checkOrigin({ allowedDomains: widget.allowedDomains, claimedHost: refererHost, ownHosts: own }).ok;
  if (!allowed.ok || !refererOk) return html(unavailablePage(n), 403, `default-src 'none'; style-src 'nonce-${n}'; frame-ancestors 'none'`);

  const logoUrl = await signedLogoUrl(widget.logoPath);
  const siteKey = turnstileSiteKey();
  const mode = url.searchParams.get("mode") === "preview" ? "preview" : url.searchParams.get("mode") === "embed" ? "embed" : "page";
  const csp = chatPageCsp(widget, n, { turnstile: siteKey !== null, imgOrigin: logoUrl ? new URL(logoUrl).origin : null, ownHosts: own, localFile: claimed === LOCAL_FILE_HOST && isLocalBuPulse(own) });
  return html(
    renderChatPage({ widget, nonce: n, logoUrl, turnstileSiteKey: siteKey, mode, origin: claimed ?? "", page: (url.searchParams.get("page") ?? "").slice(0, 500) }),
    200,
    csp,
  );
}
