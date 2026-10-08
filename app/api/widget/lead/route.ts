import { NextResponse } from "next/server";
import { handleLead } from "@/lib/widget/chat";
import { clientIpHash, ownHostsFor } from "@/lib/widget/request";

// The contact card of the chat widget: saves the visitor's details as a lead.
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const { ip, hash } = await clientIpHash(request);
  const result = await handleLead(raw, {
    ip,
    ipHash: hash,
    originHeader: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    ownHosts: ownHostsFor(request),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", ...result.headers } });
}
