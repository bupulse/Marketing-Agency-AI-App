import { NextResponse, type NextRequest } from "next/server";
import { checkActiveUser } from "@/lib/auth/require-user";
import { logError } from "@/lib/errors";
import { issueStudioTicket, openStudioHref, studioBlock } from "@/lib/video-studio/ticket";

// "Open Video Studio ↗" (docs/VIDEO_STUDIO_SPLIT.md): opened in a new tab from the sidebar and the Videos library, and
// by the studio itself when its session ran out (?next=<studio path>). Checks the client may use the studio, writes a
// one-use ticket and sends them to studio.bupulse.com, signed in. When they may not, they land on the Videos library,
// which says why (?studio=off|permission|plan|error).
export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  const back = (reason: string) => NextResponse.redirect(new URL(`/dashboard/video?studio=${reason}`, request.url), 303);

  const check = await checkActiveUser();
  if (check.status === "signed_out") {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(openStudioHref(next ?? undefined))}`, request.url), 303);
  }
  if (check.status !== "ok" || !check.user.businessId) return NextResponse.redirect(new URL("/dashboard", request.url), 303);
  const { user } = check;

  try {
    const blocked = await studioBlock({ role: user.role, companyUserId: user.id });
    if (blocked) return back(blocked);
    const target = await issueStudioTicket({ userId: user.actorId, businessId: user.businessId, next });
    const response = NextResponse.redirect(target, 303);
    // The ticket is in the address: never cache this answer, and do not tell the studio where the client came from.
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  } catch (error) {
    await logError(error, { source: "video-studio.open", userId: user.id, businessId: user.businessId });
    return back("error");
  }
}
