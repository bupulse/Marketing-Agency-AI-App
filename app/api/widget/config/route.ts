import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadPublicWidget } from "@/lib/widget/config";
import { checkOrigin, hostOf } from "@/lib/widget/origin";
import { ownHostsFor } from "@/lib/widget/request";
import { shouldRecordSeen, SEEN_THROTTLE_MS } from "@/lib/widget/seen";
import { widgetStrings } from "@/lib/widget/strings";

const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60, s-maxage=60" };
// The reason is shown in the browser console by widget.js, so an owner testing the snippet sees why nothing appears.
// "unavailable" covers the plan (website chat not in it): that is the company's business, not the public's; the owner
// sees the real reason on the Website chat page, and the server log carries it.
const OFF = (reason: "unknown_key" | "disabled" | "unavailable" | "not_allowed") => NextResponse.json({ enabled: false, reason }, { headers: CORS });

// Remembers where the widget loaded, for the "Check installation" button. One conditional UPDATE, and
// at most one write per 10 minutes per business; it never fails the request.
async function recordSeen(businessId: string, originParam: string | null, ownHosts: string[]) {
  const now = new Date();
  const host = hostOf(originParam);
  if (!shouldRecordSeen({ host, ownHosts, lastSeenAt: null, now })) return;
  try {
    await prisma.chatWidget.updateMany({
      where: { businessId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - SEEN_THROTTLE_MS) } }] },
      data: { lastSeenAt: now, lastSeenHost: host },
    });
  } catch {
    // informational only
  }
}

// What widget.js needs to draw the launcher. Public data only; called from any website.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const widget = await loadPublicWidget(url.searchParams.get("key") ?? "");
  if (!widget) return OFF("unknown_key");
  if (!widget.inPlan) {
    console.info(`[widget] config refused for business ${widget.businessId}: website chat is not in the plan`);
    return OFF("unavailable");
  }
  if (!widget.enabled) return OFF("disabled");
  const allowed = checkOrigin({
    allowedDomains: widget.allowedDomains,
    claimedHost: url.searchParams.get("origin"),
    ownHosts: ownHostsFor(request),
  });
  if (!allowed.ok) return OFF("not_allowed");
  await recordSeen(widget.businessId, url.searchParams.get("origin"), ownHostsFor(request));
  return NextResponse.json(
    { enabled: true, accent: widget.accent, accentText: widget.accentText, position: widget.position, label: widgetStrings(widget.contentLanguage).open },
    { headers: CORS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}
