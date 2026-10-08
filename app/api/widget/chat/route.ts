import { NextResponse } from "next/server";
import { handleChat } from "@/lib/widget/chat";
import { clientIpHash, ownHostsFor } from "@/lib/widget/request";

// Public chat endpoint of the website widget. See docs/WIDGET.md for the checks it applies.
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const { ip, hash } = await clientIpHash(request);
  const result = await handleChat(raw, {
    ip,
    ipHash: hash,
    originHeader: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    ownHosts: ownHostsFor(request),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", ...result.headers } });
}
