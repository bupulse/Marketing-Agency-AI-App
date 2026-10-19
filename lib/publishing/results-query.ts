import "server-only";
import { prisma } from "@/lib/db";
import { companyFeatures } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { POST_RESULTS_FEATURE, postResults, type PostResults, type ResultsPost, type ResultsSnapshot } from "./results";

/** The connection fields a post's results depend on; add to a post query's `connection.select`. */
export const resultsConnectionSelect = { postingMode: true, accountType: true, status: true, method: true } as const;

/**
 * The results of the published posts among `rows`, keyed by post id: the newest snapshot of each, read in one
 * query for the whole page (never one per post). Empty when the company's plan does not show per-post results.
 * Never throws: cards without results are better than no calendar.
 */
export async function resultsForPosts(businessId: string, rows: (ResultsPost & { id: string })[], now = new Date()): Promise<Map<string, PostResults>> {
  const out = new Map<string, PostResults>();
  const published = rows.filter((r) => r.status === "PUBLISHED");
  if (published.length === 0) return out;
  try {
    if (!(await companyFeatures(businessId)).has(POST_RESULTS_FEATURE)) return out;
    const latest = await prisma.$queryRaw<(ResultsSnapshot & { postId: string })[]>`
      SELECT DISTINCT ON (m."postId") m."postId", m."capturedAt", m."views", m."reach", m."likes", m."comments", m."shares", m."saves"
      FROM "PostMetrics" m JOIN "Post" p ON p."id" = m."postId"
      WHERE m."postId" = ANY(${published.map((r) => r.id)}::text[]) AND p."businessId" = ${businessId}
      ORDER BY m."postId", m."capturedAt" DESC`;
    const byPost = new Map(latest.map((m) => [m.postId, m]));
    for (const r of published) {
      const results = postResults(r, byPost.get(r.id) ?? null, now);
      if (results) out.set(r.id, results);
    }
  } catch (error) {
    await logError(error, { source: "publishing.results", level: "warn", businessId });
    out.clear();
  }
  return out;
}
