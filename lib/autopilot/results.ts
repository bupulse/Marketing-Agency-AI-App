// The business's published posts with their latest metrics, for learning what works (learning.ts). Database reads
// only, no other Autopilot imports, so publishing (best times for approvals) can use it without an import cycle.
import "server-only";
import { prisma } from "@/lib/db";
import type { PostResult } from "./learning";

export async function loadPostResults(businessId: string): Promise<PostResult[]> {
  const posts = await prisma.post.findMany({
    where: { businessId, status: "PUBLISHED", publishedAt: { not: null }, metrics: { some: {} } },
    orderBy: { publishedAt: "desc" },
    take: 300,
    select: { playbookId: true, network: true, publishedAt: true, metrics: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  return posts.flatMap((p) => {
    const m = p.metrics[0];
    return m && p.publishedAt ? [{ playbookId: p.playbookId, network: p.network, publishedAt: p.publishedAt, views: m.views, reach: m.reach, likes: m.likes, comments: m.comments, saves: m.saves, shares: m.shares }] : [];
  });
}
