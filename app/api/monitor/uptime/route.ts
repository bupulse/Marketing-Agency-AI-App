import { NextResponse, type NextRequest } from "next/server";
import { getCustomKey } from "@/lib/admin/service-keys";
import { bearerMatches, readJsonBody } from "@/lib/monitor/auth";
import { recordUptimeCheck } from "@/lib/monitor/uptime";
import { parseUptimeCheck, UPTIME_MAX_BYTES } from "@/lib/monitor/uptime-rules";

// One outside check of bupulse.com from GitHub Actions (.github/workflows/uptime.yml, every 5 minutes). Its own secret,
// UPTIME_SECRET, because GitHub cannot hold the PC's CRON_SECRET: set in the hosting environment, or as a custom key
// called UPTIME_SECRET in Admin -> Services (no restart needed), and the same value as the GitHub secret UPTIME_SECRET.
async function uptimeSecret(): Promise<string | null> {
  return process.env.UPTIME_SECRET?.trim() || (await getCustomKey("UPTIME_SECRET"))?.trim() || null;
}

// The server PC's own check every 5 minutes (scripts/monitor/pc-self-check.mjs, run by cron-loop.ps1) posts here too,
// with the PC's CRON_SECRET (the heartbeat's bearer), so the record has a point every 5 minutes when GitHub runs late.
export async function POST(request: NextRequest) {
  const secret = await uptimeSecret();
  const pcSecret = process.env.CRON_SECRET?.trim() || null;
  if (!secret && !pcSecret) return NextResponse.json({ error: "UPTIME_SECRET is not set" }, { status: 500 });
  const authorization = request.headers.get("authorization");
  if (!bearerMatches(authorization, secret) && !bearerMatches(authorization, pcSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await readJsonBody(request, UPTIME_MAX_BYTES);
  if (body === null) return NextResponse.json({ error: `Send a JSON body of at most ${UPTIME_MAX_BYTES} bytes.` }, { status: 400 });
  const parsed = parseUptimeCheck(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await recordUptimeCheck(parsed.value);
  return NextResponse.json(
    { ok: true, outageMinutes: result.outage?.minutes ?? null, alerted: result.alerted },
    { headers: { "Cache-Control": "no-store" } },
  );
}
