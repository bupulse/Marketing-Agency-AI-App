import { recordCron } from "@/lib/admin/cron-run";
import { disabledNetworks } from "@/lib/admin/switch";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { refreshConnectionById } from "@/lib/social/connections";

// Compares without stopping at the first different character.
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 200;

// Called daily by .github/workflows/social-refresh.yml. Refreshes tokens that expire within 7 days
// (Instagram's last 60 days) and marks the connections whose refresh failed.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    await recordCron("social-refresh", async () => {
    // A network switched off in the admin console keeps its tokens as they are; they are refreshed once it is back on.
    const paused = await disabledNetworks();
    const due = await prisma.connection.findMany({
      where: {
        kind: "SOCIAL",
        ...(paused.length ? { provider: { notIn: paused } } : {}),
        postingMode: "AUTO",
        status: { in: ["ACTIVE", "EXPIRING", "ERROR"] },
        accessTokenEncrypted: { not: null },
        expiresAt: { not: null, lt: new Date(Date.now() + WINDOW_MS) },
      },
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: BATCH,
    });
    let refreshed = 0;
    let failed = 0;
    for (const { id } of due) {
      if (await refreshConnectionById(id)) refreshed += 1;
      else failed += 1;
    }
    return { due: due.length, refreshed, failed };
    }),
  );
}
