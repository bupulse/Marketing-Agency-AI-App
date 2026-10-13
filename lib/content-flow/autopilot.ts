// Autopilot uses the same angle rotation as "Create today's content" (docs/CONTENT.md): each post about a product or
// campaign gets the least recently used angle for its day, remembered with the Studio runs' angles.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { pickAngle, type AngleChoice, type AngleHistory } from "./angles";
import { angleHistory, recordAngle } from "./service";

export type AngleGroup = { groupId: string; day: string; faq?: unknown; project?: { id: string; subject?: "product" | "campaign"; price: string | null; createdAt: Date } };

/** The angle of every group about a product or campaign, in day order, each day's choice counted for the next ones. */
export async function planAutopilotAngles(businessId: string, groups: AngleGroup[], now: Date): Promise<Map<string, AngleChoice>> {
  const out = new Map<string, AngleChoice>();
  const withProject = groups.filter((g) => g.project).sort((a, b) => a.day.localeCompare(b.day));
  if (withProject.length === 0) return out;
  try {
    const reviews = await prisma.testimonial.count({ where: { businessId, canPublish: true } });
    const histories = new Map<string, AngleHistory>();
    for (const g of withProject) {
      const p = g.project!;
      const key = `${p.subject ?? "product"}:${p.id}`;
      if (!histories.has(key)) histories.set(key, await angleHistory(businessId, key, g.day));
      const history = histories.get(key)!;
      const facts = { hasPrice: !!p.price, hasNews: p.subject === "campaign" || now.getTime() - p.createdAt.getTime() < 30 * 24 * 60 * 60 * 1000, reviews, faqs: g.faq ? 1 : 0 };
      const choice = pickAngle({ subjectKey: key, day: g.day, history, facts });
      history.push({ day: g.day, ...choice });
      out.set(g.groupId, choice);
      await recordAngle(businessId, key, g.day, choice, "autopilot");
    }
  } catch (error) {
    // Angles only add variety: Autopilot writes without them rather than not at all.
    await logError(error, { source: "autopilot.angles", level: "warn", businessId });
  }
  return out;
}
