import { NextResponse, type NextRequest } from "next/server";
import { bearerMatches, readJsonBody } from "@/lib/monitor/auth";
import { HEARTBEAT_MAX_BYTES, parseHeartbeat } from "@/lib/monitor/heartbeat-input";
import { recordHeartbeat } from "@/lib/monitor/heartbeat";

// The server PC's report every minute (scripts/self-host/windows/cron-loop.ps1): CPU, memory, disks, restart time and
// the scheduled tasks. Same bearer as the scheduled jobs (this PC's own CRON_SECRET), so only the PC can write here.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await readJsonBody(request, HEARTBEAT_MAX_BYTES);
  if (body === null) return NextResponse.json({ error: `Send a JSON body of at most ${HEARTBEAT_MAX_BYTES} bytes.` }, { status: 400 });
  const parsed = parseHeartbeat(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await recordHeartbeat(parsed.value);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
