import "server-only";
import { prisma } from "@/lib/db";
import type { ServiceId } from "./service-catalog";

/** Counts one use of a service for today (UTC). Never throws and never blocks the caller's work. */
export async function recordServiceUse(service: ServiceId, ok: boolean, now = new Date()): Promise<void> {
  try {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await prisma.$executeRaw`
      INSERT INTO "ServiceUsage" ("service", "day", "ok", "failed") VALUES (${service}, ${day}, ${ok ? 1 : 0}, ${ok ? 0 : 1})
      ON CONFLICT ("service", "day") DO UPDATE SET "ok" = "ServiceUsage"."ok" + ${ok ? 1 : 0}, "failed" = "ServiceUsage"."failed" + ${ok ? 0 : 1}`;
  } catch {
    // counters are a nicety
  }
}
