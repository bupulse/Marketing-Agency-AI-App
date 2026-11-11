// The proxy's whole part in the Ad Brain's screen robot, in one helper so proxy.ts carries a single line
// (`const robot = await screenPassGate(request); if (robot) return robot;`) that is easy to keep when proxy.ts is
// rewritten. Gated three ways (lib/ad-brain/screen-pass.ts):
//   1. LOCAL: only a request made on this computer (host 127.0.0.1 / localhost, no Cloudflare or forwarding headers);
//   2. READ-ONLY: only GET/HEAD, only /dashboard/** and the read API (never admin, cron, auth, server actions);
//   3. COMPANY ACCOUNT ONLY: a genuine 5-minute signed pass; getCurrentUser (lib/ad-brain/screen-user.ts) checks again
//      that it names the BuPulse company account.
// No pass cookie: null, and the proxy goes on exactly as before. A pass that fails any check: 403, never a session.
import { NextResponse, type NextRequest } from "next/server";
import { readScreenPass, SCREEN_PASS_COOKIE, screenPassAllowed, screenPassSecret } from "./screen-pass";

export async function screenPassGate(request: NextRequest): Promise<NextResponse | null> {
  const token = request.cookies.get(SCREEN_PASS_COOKIE)?.value;
  if (!token) return null;
  const h = request.headers;
  const allowed =
    screenPassAllowed({ method: request.method, path: request.nextUrl.pathname, host: h.get("host"), cfConnectingIp: h.get("cf-connecting-ip"), forwardedFor: h.get("x-forwarded-for"), realIp: h.get("x-real-ip") }) &&
    (await readScreenPass(token, screenPassSecret())) !== null;
  if (!allowed) return new NextResponse("Read-only screen pass: refused.", { status: 403, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  // Straight through: no Supabase session refresh, no sign-in gate (getCurrentUser reads the pass itself).
  return NextResponse.next({ request });
}
