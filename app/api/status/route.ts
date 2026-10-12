import { prisma } from "@/lib/db";
import { currentBuild } from "@/lib/version";

// Public health check for uptime monitors: is the app up and can it reach the database? It returns no data about
// companies and no configuration, only "ok"/"down", the version and how long the database check took.

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 3_000;

async function ping(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function databaseOk(): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), DB_TIMEOUT_MS);
  });
  const ok = await Promise.race([ping(), timeout]);
  clearTimeout(timer);
  return { ok, ms: Date.now() - started };
}

export async function GET() {
  const db = await databaseOk();
  const { version } = currentBuild();
  return Response.json(
    { status: db.ok ? "ok" : "down", version, database: db.ok ? "ok" : "down", databaseMs: db.ms, time: new Date().toISOString() },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
