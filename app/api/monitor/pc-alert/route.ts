import { NextResponse, type NextRequest } from "next/server";
import { bearerMatches, readJsonBody } from "@/lib/monitor/auth";
import { sendPcAlert } from "@/lib/monitor/pc-alert";
import { parsePcAlert, PC_ALERT_MAX_BYTES } from "@/lib/monitor/pc-alert-rules";

// The server PC's supervisor (scripts/self-host/windows/supervisor.mjs), when its miner check finds a suspicious program
// or the miner's folder: one Telegram and email message to the owner. Same bearer as the watch and the heartbeat (this
// PC's own CRON_SECRET), so only the PC can post here. The supervisor counts the once-a-day repeat itself.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await readJsonBody(request, PC_ALERT_MAX_BYTES);
  if (body === null) return NextResponse.json({ error: `Send a JSON body of at most ${PC_ALERT_MAX_BYTES} bytes.` }, { status: 400 });
  const parsed = parsePcAlert(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await sendPcAlert(parsed.value);
  return NextResponse.json({ ok: true, sent: result.sent, outcomes: result.outcomes }, { headers: { "Cache-Control": "no-store" } });
}
