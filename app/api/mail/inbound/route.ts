import { NextResponse } from "next/server";
import { logError } from "@/lib/errors";
import { receiveMail } from "@/lib/mail/inbound";
import { MAX_RAW_BYTES } from "@/lib/mail/parse";
import { RECIPIENT_HEADER, SIGNATURE_HEADER, verifyInbound } from "@/lib/mail/signature";

// One incoming email for one recipient, from the Cloudflare Email Worker (workers/mail-inbound). The body is the raw
// MIME message; X-BuPulse-Recipient names the envelope recipient; X-BuPulse-Signature signs both with
// MAIL_INBOUND_SECRET (lib/mail/signature.ts). Machine-to-machine: never a browser session (proxy.ts skips it).
//
// Answers: 200 { status, forwardTo } (forwardTo = confirmed outside addresses the Worker forwards to), 401 bad
// signature, 413 too big, 422 not one of our addresses, 500 on a failure (the Worker then rejects the message with a
// temporary error, so the sending server tries again later and nothing is lost).

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_RAW_BYTES) return NextResponse.json({ error: "too_big" }, { status: 413 });
  const recipient = (request.headers.get(RECIPIENT_HEADER) ?? "").trim().toLowerCase();
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_RAW_BYTES) return NextResponse.json({ error: "too_big" }, { status: 413 });
  const check = await verifyInbound({ secret: process.env.MAIL_INBOUND_SECRET, header: request.headers.get(SIGNATURE_HEADER), recipient, body });
  if (!check.ok) {
    if (check.reason === "no_secret") await logError(new Error("MAIL_INBOUND_SECRET is not set: incoming mail is refused"), { source: "mail.inbound", level: "error" });
    return NextResponse.json({ error: "signature" }, { status: 401 });
  }
  try {
    const result = await receiveMail({ raw: body, recipient });
    if (result.status === "refused") return NextResponse.json({ status: "refused", reason: result.reason }, { status: 422 });
    return NextResponse.json({ status: result.status, forwardTo: result.forwardTo });
  } catch (error) {
    await logError(error, { source: "mail.inbound", level: "error", bytes: body.byteLength });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
