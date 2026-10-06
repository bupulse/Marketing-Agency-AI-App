import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { site } from "@/lib/content/site";
import { parseSignedRequest } from "./signed-request";

// Meta "Data Deletion Request Callback". Meta POSTs a form field `signed_request` when a person
// removes BuPulse and asks Facebook to delete their data. We record the request for the team
// to action within 30 days and answer with a status page URL and a confirmation code.
export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const signed = (await request.formData().catch(() => null))?.get("signed_request");
  if (typeof signed !== "string") return NextResponse.json({ error: "Missing signed_request" }, { status: 400 });

  const payload = parseSignedRequest(signed, secret);
  if (!payload) return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 });

  const code = randomBytes(8).toString("hex");
  try {
    await prisma.contactRequest.create({
      data: {
        kind: "meta_data_deletion",
        name: "Meta data deletion callback",
        email: "meta-callback@bupulse.com",
        message: `Meta user_id=${payload.user_id}; code=${code}`,
      },
    });
  } catch (error) {
    console.error("meta data deletion request failed", error);
    return NextResponse.json({ error: "Could not record request" }, { status: 500 });
  }

  return NextResponse.json({ url: `${site.url}/data-deletion?code=${code}`, confirmation_code: code });
}
