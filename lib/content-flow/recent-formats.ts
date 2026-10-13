// The formats each app had on the last days (lib/content-flow/format.ts, the three-days rule), from saved content.
import "server-only";
import { prisma } from "@/lib/db";
import { todayIn } from "./day";
import { recentFormatsOf, type RecentFormats } from "./format";

/** Every subject's content counts: the rule is about the app. Days are the business's local days. */
export async function recentFormats(businessId: string, zone: string, day: string): Promise<RecentFormats> {
  const rows = await prisma.generatedContent.findMany({
    where: { businessId, format: { not: null }, createdAt: { gte: new Date(Date.parse(`${day}T00:00:00Z`) - 4 * 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { network: true, format: true, forDate: true, createdAt: true },
  });
  return recentFormatsOf(rows.map((r) => ({ network: r.network, format: r.format, day: r.forDate ? r.forDate.toISOString().slice(0, 10) : todayIn(zone, r.createdAt) })), day);
}
