import { NextResponse } from "next/server";
import { handleMessages } from "@/lib/widget/chat";
import { clientIpHash, ownHostsFor } from "@/lib/widget/request";

// Public "any new replies?" endpoint of the website widget: replies a teammate or an automation added to the chat
// after the visitor's last message (docs/INBOX.md). Same origin checks as the chat endpoint.
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const { ip, hash } = await clientIpHash(request);
  const result = await handleMessages(raw, {
    ip,
    ipHash: hash,
    originHeader: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    ownHosts: ownHostsFor(request),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", ...result.headers } });
}
