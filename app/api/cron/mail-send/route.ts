import { NextResponse } from "next/server";
import { deliverDue } from "@/lib/mail/send";

// Sends queued B Mail messages whose undo window is over (lib/mail/send.ts). Called with the cron secret by the
// scheduler; the sending request and page loads also call deliverDue, so this is the safety net.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await deliverDue());
}
