import { currentPlatform } from "@/lib/platform/detect";
import { clientIp, visitorCountry } from "@/lib/platform/headers";

// Post-deploy check (docs/DEPLOY_NETLIFY.md, Checks after the first deploy): what the app reads from the host's
// headers for this request. Off unless PLATFORM_CHECK=1; switch it off again after checking. It only ever answers
// the caller's own address and country.
export async function GET(request: Request) {
  if (process.env.PLATFORM_CHECK !== "1") return new Response("Not found", { status: 404 });
  return Response.json(
    { platform: currentPlatform(), country: visitorCountry(request.headers), ip: clientIp(request.headers) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
