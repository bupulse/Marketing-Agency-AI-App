import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { site } from "@/lib/content/site";
import { deleteMetaConnections } from "@/lib/social/meta-callbacks";
import { metaSecrets, verifyMetaRequest } from "./signed-request";

function newCode() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Meta "Data Deletion Request Callback". Meta POSTs a form field `signed_request` when a person removes
// BuPulse and asks Facebook to delete their data. We delete that person's Meta connections and tokens
// right away, keep a record of the request, and answer with a status page URL and a confirmation code.
export async function POST(request: Request) {
  if (!metaSecrets().length) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const signed = (await request.formData().catch(() => null))?.get("signed_request");
  if (typeof signed !== "string") return NextResponse.json({ error: "Missing signed_request" }, { status: 400 });

  const payload = await verifyMetaRequest(signed);
  if (!payload) return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 });

  const code = newCode();
  try {
    const removed = await deleteMetaConnections(payload.user_id);
    await prisma.contactRequest.create({
      data: {
        kind: "meta_data_deletion",
        name: "Meta data deletion callback",
        email: "meta-callback@bupulse.com",
        message: `Meta user_id=${payload.user_id}; code=${code}; connections_removed=${removed}`,
        handled: true,
      },
    });
  } catch (error) {
    await logError(error, { source: "meta.data-deletion" });
    return NextResponse.json({ error: "Could not record request" }, { status: 500 });
  }

  return NextResponse.json({ url: `${site.url}/data-deletion?code=${code}`, confirmation_code: code });
}
