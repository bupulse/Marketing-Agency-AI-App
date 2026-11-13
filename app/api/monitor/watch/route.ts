import { NextResponse, type NextRequest } from "next/server";
import { bearerMatches, readJsonBody } from "@/lib/monitor/auth";
import { recordWatchReport } from "@/lib/monitor/watch";
import { parseWatchReport, WATCH_MAX_BYTES } from "@/lib/monitor/watch-rules";

// The server PC's supervisor (scripts/self-host/windows/supervisor.mjs) every minute: is https://bupulse.com up from
// outside, and are the local server and the tunnel fine? lib/monitor/watch.ts sends the owner one "down" message after
// 2 minutes and one "back up" message (Telegram and email). Same bearer as the heartbeat (this PC's own CRON_SECRET), so
// only the PC can post here.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await readJsonBody(request, WATCH_MAX_BYTES);
  if (body === null) return NextResponse.json({ error: `Send a JSON body of at most ${WATCH_MAX_BYTES} bytes.` }, { status: 400 });
  const parsed = parseWatchReport(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await recordWatchReport(parsed.value);
  return NextResponse.json({ ok: true, sent: result.sent }, { headers: { "Cache-Control": "no-store" } });
}
