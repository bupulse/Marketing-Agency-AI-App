import { NextResponse } from "next/server";
import { logError } from "@/lib/errors";
import { deleteMetaConnections } from "@/lib/social/meta-callbacks";
import { metaSecrets, verifyMetaRequest } from "../data-deletion/signed-request";

// Meta "Deauthorize Callback". Meta POSTs a `signed_request` when a person removes BuPulse in their Facebook or
// Instagram settings. The tokens are already useless, so the connections are removed.
export async function POST(request: Request) {
  if (!metaSecrets().length) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const signed = (await request.formData().catch(() => null))?.get("signed_request");
  if (typeof signed !== "string") return NextResponse.json({ error: "Missing signed_request" }, { status: 400 });

  const payload = await verifyMetaRequest(signed);
  if (!payload) return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 });

  try {
    await deleteMetaConnections(payload.user_id);
  } catch (error) {
    await logError(error, { source: "meta.deauthorize" });
    return NextResponse.json({ error: "Could not remove connections" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
