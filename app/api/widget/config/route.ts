import { NextResponse } from "next/server";
import { loadPublicWidget } from "@/lib/widget/config";
import { checkOrigin } from "@/lib/widget/origin";
import { ownHostsFor } from "@/lib/widget/request";
import { widgetStrings } from "@/lib/widget/strings";

const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60, s-maxage=60" };
// The reason is shown in the browser console by widget.js, so an owner testing the snippet sees why nothing appears.
const OFF = (reason: "unknown_key" | "disabled" | "not_allowed") => NextResponse.json({ enabled: false, reason }, { headers: CORS });

// What widget.js needs to draw the launcher. Public data only; called from any website.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const widget = await loadPublicWidget(url.searchParams.get("key") ?? "");
  if (!widget) return OFF("unknown_key");
  if (!widget.enabled) return OFF("disabled");
  const allowed = checkOrigin({
    allowedDomains: widget.allowedDomains,
    claimedHost: url.searchParams.get("origin"),
    ownHosts: ownHostsFor(request),
  });
  if (!allowed.ok) return OFF("not_allowed");
  return NextResponse.json(
    { enabled: true, accent: widget.accent, accentText: widget.accentText, position: widget.position, label: widgetStrings(widget.contentLanguage).open },
    { headers: CORS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}
